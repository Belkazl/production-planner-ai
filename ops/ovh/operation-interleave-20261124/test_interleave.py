"""Public contract tests; these do not pretend to execute the private GA core."""
import copy
import importlib.util
import itertools
import json
import os
from pathlib import Path
import unittest

from operation_interleave import install_operation_interleave, _slot, _safe_reason, DIAGNOSTIC_KEY, VERSION
from patch import patch, CALL, IMPORT, FINAL, LEGACY_FINAL, FINAL_ANCHOR


def model(durations=None, quantities=None):
    durations = durations or [[1, 1] for _ in range(3)]
    quantities = quantities or [1] * len(durations)
    return {"scheduler_mode": "resource", "start": "2026-11-24T08:00:00", "quantity_unit": "items", "objective": "duration",
            "equipment": [{"id": "machine-" + str(i), "name": "Machine " + str(i), "kind": "workstation", "capacity": 1, "capacity_unit": "items"} for i in range(2)],
            "employees": [], "materials": [], "setup_rules": [],
            "orders": [{"id": "job-" + str(i), "quantity": quantities[i], "unit": "items", "technical_process_id": "process-" + str(i)} for i in range(len(durations))],
            "technical_processes": [{"id": "process-" + str(i), "operations": [{"id": "step-" + str(j), "sequence": j + 1, "duration_min": duration, "resource_requirements": [{"resource_type": "equipment", "match_mode": "any", "resource_ref": "kind:workstation", "quantity": 1}]} for j, duration in enumerate(values)]} for i, values in enumerate(durations)]}


def fixture_native_decoder(m, sequence):
    """A feasible whole-order decoder to exercise the public wrapper contract."""
    orders = {str(order["id"]): order for order in m["orders"]}
    processes = {process["id"]: process for process in m["technical_processes"]}
    busy = {machine["id"]: [] for machine in m["equipment"]}
    rows, batches = [], []
    for oid in sequence:
        order = orders[str(oid)]
        for batch in range(1, order["quantity"] + 1):
            ready, group = 0, []
            for operation in processes[order["technical_process_id"]]["operations"]:
                duration = operation["duration_min"]
                slots = [(_slot(calendar, ready, duration), sum(b - a for a, b in calendar), machine) for machine, calendar in busy.items()]
                start, _, machine = min(slots)
                end = start + duration
                busy[machine].append((start, end))
                row = {"order": oid, "operation_id": operation["id"], "sequence": operation["sequence"], "duration_min": duration,
                       "equipment_ids": [machine], "employee_ids": [], "materials": [], "batch": batch, "batch_id": str(oid) + "." + str(batch), "batch_quantity": 1, "batch_capacity": 1, "batch_count": order["quantity"], "start_min": start, "end_min": end}
                rows.append(row)
                group.append(row)
                ready = end
            batches.append({"order": oid, "batch": batch, "quantity": 1, "capacity": 1, "start_min": group[0]["start_min"], "end_min": group[-1]["end_min"]})
    duration = max(row["end_min"] for row in rows)
    waiting = sum(batch["end_min"] - sum(row["duration_min"] for row in rows if row["order"] == batch["order"] and row["batch"] == batch["batch"]) for batch in batches)
    return {"valid": True, "operations": rows, "batches": batches, "ctx": {"start": m["start"]}, "duration_minutes": duration, "fitness": duration,
            "machine_idle_minutes": len(busy) * duration - sum(row["duration_min"] for row in rows), "operator_wait_minutes": waiting,
            "resource_busy": busy, "order_sequence": list(sequence), "setup_operations": [], "optimization_run": 7, "total_generations": 123, "resume_state": {"keep": "native"}, "algorithm": "native_fixture"}


def independent_validation(m, sim):
    errors = []
    resources, chains = {}, {}
    for row in sim["operations"]:
        if row["start_min"] < 0 or abs(row["end_min"] - row["start_min"] - row["duration_min"]) > 1e-7:
            errors.append("invalid_interval")
        resources.setdefault(row["equipment_ids"][0], []).append(row)
        chains.setdefault((row["order"], row["batch"]), []).append(row)
    for rows in resources.values():
        rows.sort(key=lambda row: row["start_min"])
        if any(a["end_min"] > b["start_min"] + 1e-7 for a, b in zip(rows, rows[1:])):
            errors.append("overlap")
    for rows in chains.values():
        rows.sort(key=lambda row: row["sequence"])
        if any(a["end_min"] > b["start_min"] + 1e-7 for a, b in zip(rows, rows[1:])):
            errors.append("precedence")
    if sim["duration_minutes"] != max(row["end_min"] for row in sim["operations"]):
        errors.append("duration")
    return errors


class InterleaveTests(unittest.TestCase):
    def run_schedule(self, m, sequence=None, validator=independent_validation):
        sequence = sequence or [order["id"] for order in m["orders"]]
        before = fixture_native_decoder(m, sequence)
        untouched = copy.deepcopy(before)
        calls = []
        def validate(model_arg, sim):
            calls.append(sim)
            return validator(model_arg, sim)
        ga = {"_pp_schedule_sequence": lambda *_: before, "_pp_validate_generic": validate}
        self.assertTrue(install_operation_interleave(ga, m))
        result = ga["_pp_schedule_sequence"](m, sequence)
        self.assertEqual(before, untouched)
        return before, result, calls

    def test_three_orders_all_permutations_reach_lower_bound_natively(self):
        m = model()
        for sequence in itertools.permutations(order["id"] for order in m["orders"]):
            before, result, calls = self.run_schedule(m, sequence)
            self.assertEqual(before["duration_minutes"], 4)
            self.assertEqual(result["duration_minutes"], 3)
            self.assertEqual(len(result["operations"]), 6)
            self.assertTrue(calls)
            self.assertEqual(independent_validation(m, result), [])
            self.assertEqual(sum(row["duration_min"] for row in result["operations"]), 6)
            for field in ("algorithm", "optimization_run", "total_generations", "resume_state", "order_sequence", "ctx"):
                self.assertEqual(result[field], before[field])
            keys = lambda row: (row["order"], row["batch"], row["operation_id"])
            assignments = lambda sim: {keys(row): (row["duration_min"], row["equipment_ids"], row["batch_quantity"]) for row in sim["operations"]}
            self.assertEqual(assignments(before), assignments(result))

    def test_four_orders_do_not_regress_an_already_optimal_plan(self):
        m = model([[1, 1]] * 4)
        before, result, calls = self.run_schedule(m)
        self.assertEqual(before["duration_minutes"], 4)
        self.assertIs(result, before)
        self.assertEqual(independent_validation(m, result), [])
        self.assertEqual(calls, [])

    def test_four_orders_with_unequal_work_improve_without_specific_ids(self):
        m = model([[1, 1], [1, 1], [1, 1], [2, 1]])
        before, result, calls = self.run_schedule(m)
        self.assertEqual(before["duration_minutes"], 6)
        self.assertEqual(result["duration_minutes"], 5)
        self.assertTrue(calls)
        self.assertEqual(independent_validation(m, result), [])

    def test_large_models_are_left_on_original_decoder(self):
        ga = {"_pp_schedule_sequence": fixture_native_decoder, "_pp_validate_generic": independent_validation}
        self.assertFalse(install_operation_interleave(ga, model([[1, 1]] * 33)))
        self.assertIs(ga["_pp_schedule_sequence"], fixture_native_decoder)

    def test_arbitrary_durations_and_more_than_two_operations_remain_feasible(self):
        for durations in ([[3, 1], [1, 2], [2, 3], [1, 1]], [[1, 3, 2], [2, 1], [4], [1, 2, 1]], [[0.5, 0.75], [0.25, 0.5], [0.75, 0.25]]):
            m = model(durations)
            before, result, _ = self.run_schedule(m)
            self.assertLessEqual(result["duration_minutes"], before["duration_minutes"])
            self.assertEqual(independent_validation(m, result), [])
            self.assertEqual(sum(row["duration_min"] for row in result["operations"]), sum(map(sum, durations)))

    def test_unit_batches_keep_all_quantity_and_precedence(self):
        m = model([[1, 1]], quantities=[3])
        before, result, calls = self.run_schedule(m)
        self.assertEqual(before["duration_minutes"], 4)
        self.assertEqual(result["duration_minutes"], 3)
        self.assertEqual(len(result["batches"]), 3)
        self.assertEqual(independent_validation(m, result), [])

    def test_constraints_and_nonunary_capacity_never_install(self):
        changes = [lambda m: m["equipment"][0].update(capacity=2), lambda m: m.update(materials=[{"id": "stock"}]), lambda m: m.update(employees=[{"id": "person"}]), lambda m: m.update(shifts={"day": [["08:00", "17:00"]]}), lambda m: m.update(setup_rules=[{"id": "change"}]), lambda m: m["orders"][0].update(release_min=3), lambda m: m["orders"][0].update(due_min=3), lambda m: m["technical_processes"][0]["operations"][0].update(dependencies=["other"]), lambda m: m["technical_processes"][0]["operations"][0].update(duration_per_unit=2)]
        for change in changes:
            m = model(); change(m)
            original = lambda *_: None
            ga = {"_pp_schedule_sequence": original, "_pp_validate_generic": independent_validation}
            self.assertFalse(install_operation_interleave(ga, m))
            self.assertIs(ga["_pp_schedule_sequence"], original)
        for kwargs in ({"pins": [{"order": "any"}]}, {"objective": "wait"}, {"objective": "idle"}, {"objective": "balanced"}, {"objective": "cycles"}):
            ga = {"_pp_schedule_sequence": fixture_native_decoder, "_pp_validate_generic": independent_validation}
            self.assertFalse(install_operation_interleave(ga, model(), **kwargs))

    def test_unknown_runtime_contracts_return_original_object(self):
        mutations = [lambda sim: sim.pop("ctx"), lambda sim: sim["operations"].pop(), lambda sim: sim.update(fitness=1000), lambda sim: sim.update(machine_idle_minutes=1234), lambda sim: sim.update(operator_wait_minutes=1234), lambda sim: sim["operations"][0].update(manual_locked=True), lambda sim: sim["operations"][0].update(duration_min=2), lambda sim: sim.update(generic_operations=[])]
        m = model(); sequence = [order["id"] for order in m["orders"]]
        for mutate in mutations:
            base = fixture_native_decoder(m, sequence); mutate(base); before = copy.deepcopy(base)
            ga = {"_pp_schedule_sequence": lambda *_: base, "_pp_validate_generic": independent_validation}
            self.assertTrue(install_operation_interleave(ga, m))
            self.assertIs(ga["_pp_schedule_sequence"](m, sequence), base)
            self.assertEqual(base, before)

    def test_native_validator_rejection_or_exception_preserves_original(self):
        for validator in (lambda *_: ["native_constraint"], lambda *_: (_ for _ in ()).throw(RuntimeError("native_error"))):
            before, result, calls = self.run_schedule(model(), validator=validator)
            self.assertIs(result, before)
            self.assertTrue(calls)

    def test_decoder_errors_and_cancellation_are_not_swallowed(self):
        m = model(); sequence = [order["id"] for order in m["orders"]]
        for exception in (RuntimeError("native_failure"), KeyboardInterrupt()):
            def original(*_): raise exception
            ga = {"_pp_schedule_sequence": original, "_pp_validate_generic": independent_validation}
            self.assertTrue(install_operation_interleave(ga, m))
            with self.assertRaises(type(exception)):
                ga["_pp_schedule_sequence"](m, sequence)
        def cancel(*_): raise KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt):
            self.run_schedule(m, validator=cancel)

    def test_installation_is_idempotent(self):
        ga = {"_pp_schedule_sequence": fixture_native_decoder, "_pp_validate_generic": independent_validation}
        self.assertTrue(install_operation_interleave(ga, model()))
        first = ga["_pp_schedule_sequence"]
        self.assertTrue(install_operation_interleave(ga, model()))
        self.assertIs(ga["_pp_schedule_sequence"], first)

    def test_cache_never_reuses_a_plan_context_or_changed_model(self):
        m = model(); sequence = [order["id"] for order in m["orders"]]
        outputs = []
        def native(*_):
            result = fixture_native_decoder(m, sequence)
            result["ctx"]["call"] = len(outputs)
            result["optimization_run"] = len(outputs)
            outputs.append(result)
            return result
        ga = {"_pp_schedule_sequence": native, "_pp_validate_generic": independent_validation}
        self.assertTrue(install_operation_interleave(ga, m))
        first = ga["_pp_schedule_sequence"](m, sequence)
        first["operations"][0]["end_min"] = 123
        second = ga["_pp_schedule_sequence"](m, sequence)
        self.assertEqual(second["duration_minutes"], 3)
        self.assertEqual(second["ctx"]["call"], 1)
        self.assertEqual(second["optimization_run"], 1)
        self.assertEqual(independent_validation(m, second), [])
        m["orders"][0]["release_min"] = 5
        self.assertIs(ga["_pp_schedule_sequence"](m, sequence), outputs[-1])

    def test_native_validator_must_not_mutate_schedule(self):
        def mutating_validator(_, sim):
            sim["operations"][0]["equipment_ids"] = ["machine-1"]
            return []
        before, result, calls = self.run_schedule(model(), validator=mutating_validator)
        self.assertIs(before, result)
        self.assertTrue(calls)

    def test_guarded_adapter_patch(self):
        source = """from pathlib import Path
import copy
SOURCE = Path('/tmp/production_planner.py')
def _namespace(): pass
def run(payload,progress):
    objective=opts.get('objective') or 'duration'
    if pins:
        try: pins=make_constrained_scheduler(ga,pins,normalized)
        except Exception: raise
    result=ga['optimize'](gens,population,seed,continuing,objective)
    _assert_owned(result,normalized)
    result['resume_state']=None
"""
        result = patch(source)
        self.assertEqual(patch(result), result)
        self.assertLess(result.index(CALL), result.index("try: pins=make_constrained_scheduler"))
        self.assertLess(result.index(FINAL_ANCHOR), result.index(FINAL))
        self.assertEqual(result.replace(IMPORT + "\n", "", 1).replace(CALL, "", 1).replace(FINAL, "", 1), source)
        self.assertEqual(patch(result.replace(FINAL, "", 1)), result)
        self.assertEqual(patch(result.replace(FINAL, LEGACY_FINAL, 1)), result)
        with self.assertRaisesRegex(RuntimeError, "DRIFT"):
            patch(source.replace("    if pins:", "    if something_else:"))

    def test_final_diagnostics_are_bounded_per_run_and_snapshot_without_mutation(self):
        m = model(); sequence = [order['id'] for order in m['orders']]
        first = {'_pp_schedule_sequence': fixture_native_decoder, '_pp_validate_generic': independent_validation}
        second = {'_pp_schedule_sequence': fixture_native_decoder, '_pp_validate_generic': independent_validation}
        self.assertTrue(install_operation_interleave(first, m))
        self.assertTrue(install_operation_interleave(second, m))
        first['_pp_schedule_sequence'](m, sequence)
        self.assertIsNot(first[DIAGNOSTIC_KEY], second[DIAGNOSTIC_KEY])
        self.assertEqual(first[DIAGNOSTIC_KEY], {'version': VERSION, 'eligible': True, 'improved_candidates': 1, 'fallback_reason': None, 'model_field_mismatches': []})
        self.assertEqual(second[DIAGNOSTIC_KEY]['improved_candidates'], 0)
        scope = {'copy': copy}; exec('def attach(ga,result):\n' + FINAL + '    return result\n', scope)
        original = {'algorithm': 'native', 'optimization_run': 9, 'total_generations': 200}
        snapshot = scope['attach'](first, original)
        self.assertNotIn('operation_interleave', original)
        self.assertEqual(snapshot['optimization_run'], 9)
        first[DIAGNOSTIC_KEY]['improved_candidates'] = 2
        self.assertEqual(snapshot['operation_interleave']['improved_candidates'], 1)
        self.assertEqual(set(snapshot['operation_interleave']), {'version', 'eligible', 'improved_candidates', 'fallback_reason', 'model_field_mismatches'})

    def test_diagnostics_report_only_first_known_code_without_sensitive_values(self):
        m = model(); sequence = [order['id'] for order in m['orders']]
        base = fixture_native_decoder(m, sequence); base['fitness'] = 999
        before = copy.deepcopy(base)
        ga = {'_pp_schedule_sequence': lambda *_: base, '_pp_validate_generic': independent_validation}
        self.assertTrue(install_operation_interleave(ga, m))
        self.assertIs(ga['_pp_schedule_sequence'](m, sequence), base)
        self.assertEqual(base, before)
        self.assertEqual(ga[DIAGNOSTIC_KEY]['fallback_reason'], 'non_duration_fitness')
        m['orders'][0]['release_min'] = 5
        ga['_pp_schedule_sequence'](m, sequence)
        self.assertEqual(ga[DIAGNOSTIC_KEY]['fallback_reason'], 'non_duration_fitness')
        bad = model(); bad['private-account-token-field'] = 'DO_NOT_EXPOSE'
        other = {'_pp_schedule_sequence': fixture_native_decoder, '_pp_validate_generic': independent_validation}
        self.assertFalse(install_operation_interleave(other, bad))
        self.assertEqual(other[DIAGNOSTIC_KEY], {'version': VERSION, 'eligible': False, 'improved_candidates': 0, 'fallback_reason': 'unsupported_fields@model:other', 'model_field_mismatches': [{'scope': 'model', 'fields': [], 'other': True, 'truncated': False}]})
        serial = json.dumps(other[DIAGNOSTIC_KEY])
        self.assertNotIn('private-account', serial); self.assertNotIn('DO_NOT_EXPOSE', serial)

    def test_field_diagnostics_locate_all_scopes_without_relaxing_eligibility(self):
        cases = [
            ('model', lambda m: m, '_meta'),
            ('equipment', lambda m: m['equipment'][0], 'capabilities'),
            ('process', lambda m: m['technical_processes'][0], 'revision'),
            ('operation', lambda m: m['technical_processes'][0]['operations'][0], 'timing_profile'),
            ('requirement', lambda m: m['technical_processes'][0]['operations'][0]['resource_requirements'][0], 'capacity'),
            ('order', lambda m: m['orders'][0], 'area'),
        ]
        for scope, target, field in cases:
            m = model(); target(m)[field] = {'PRIVATE_VALUE': 'must_not_appear'}
            before = copy.deepcopy(m)
            ga = {'_pp_schedule_sequence': fixture_native_decoder, '_pp_validate_generic': independent_validation}
            self.assertFalse(install_operation_interleave(ga, m))
            self.assertEqual(ga[DIAGNOSTIC_KEY]['fallback_reason'], 'unsupported_fields@' + scope + ':' + field)
            self.assertIs(ga['_pp_schedule_sequence'], fixture_native_decoder)
            self.assertEqual(m, before)
            self.assertNotIn('PRIVATE_VALUE', json.dumps(ga[DIAGNOSTIC_KEY]))

    def test_field_diagnostics_are_bounded_and_reject_unlisted_names(self):
        m = model(); m.update({'_meta': {}, 'revision': 1, 'constraints': [], 'SECRET_UNKNOWN_KEY': 'SECRET_VALUE'})
        ga = {'_pp_schedule_sequence': fixture_native_decoder, '_pp_validate_generic': independent_validation}
        self.assertFalse(install_operation_interleave(ga, m))
        reason = ga[DIAGNOSTIC_KEY]['fallback_reason']
        self.assertEqual(reason, 'unsupported_fields@model:_meta,constraints,revision,other')
        self.assertEqual(_safe_reason(reason), reason)
        for malicious in ('unsupported_fields@model:SECRET_UNKNOWN_KEY', 'unsupported_fields@SECRET_SCOPE:_meta', 'unsupported_fields@model:_meta:SECRET_VALUE'):
            self.assertEqual(_safe_reason(malicious), 'runtime_contract_unsupported')

    def test_all_model_scopes_report_only_aggregated_safe_shapes(self):
        m = model(); m['_meta'] = {}; m['constraints'] = []
        m['equipment'][0]['capabilities'] = {}; m['equipment'][1]['capabilities'] = {'SECRET_INNER_KEY': 'SECRET_INNER_VALUE'}
        for process in m['technical_processes']:
            process['revision'] = 0
            process['operations'][0]['timing_profile'] = []
            process['operations'][1]['timing_profile'] = None
            for operation in process['operations']:
                operation['resource_requirements'][0]['capacity'] = 0
        for order in m['orders']:
            order['area'] = 1
        original = copy.deepcopy(m)
        ga = {'_pp_schedule_sequence': fixture_native_decoder, '_pp_validate_generic': independent_validation}
        self.assertFalse(install_operation_interleave(ga, m))
        self.assertEqual(m, original)
        shapes = ga[DIAGNOSTIC_KEY]['model_field_mismatches']
        self.assertEqual(len(shapes), 6)
        scopes = {item['scope']: item for item in shapes}
        self.assertEqual(scopes['equipment']['fields'], [{'key': 'capabilities', 'kind': 'object', 'empty': False, 'zero': False}])
        self.assertEqual(scopes['operation']['fields'], [{'key': 'timing_profile', 'kind': 'mixed', 'empty': True, 'zero': False}])
        self.assertEqual(scopes['process']['fields'], [{'key': 'revision', 'kind': 'number', 'empty': False, 'zero': True}])
        self.assertTrue(all(not item['truncated'] for item in shapes))
        serialized = json.dumps(shapes)
        for secret in ('SECRET_INNER_KEY', 'SECRET_INNER_VALUE', 'job-0', 'machine-0'):
            self.assertNotIn(secret, serialized)

    def test_shape_diagnostics_have_fixed_field_and_record_bounds(self):
        m = model()
        for key in ('_meta', '_assistant_reply', '_ai_error', 'createdAt', 'updatedAt', 'created_at', 'updated_at', 'version', 'schema_version', 'model_version'):
            m[key] = None
        m['orders'] = [copy.deepcopy(m['orders'][0]) for _ in range(300)]
        ga = {'_pp_schedule_sequence': fixture_native_decoder, '_pp_validate_generic': independent_validation}
        self.assertFalse(install_operation_interleave(ga, m))
        shapes = ga[DIAGNOSTIC_KEY]['model_field_mismatches']
        self.assertLessEqual(len(shapes), 6)
        self.assertTrue(all(len(item['fields']) <= 8 for item in shapes))
        scopes = {item['scope']: item for item in shapes}
        self.assertTrue(scopes['model']['truncated'])
        self.assertTrue(scopes['order']['truncated'])

    def test_exported_live_ga_contract_when_private_fixture_is_available(self):
        folder = Path('/tmp/liftorbit-text-import-test')
        if not all((folder / name).is_file() for name in ('live-model.json', 'live-progress.json')):
            self.skipTest('optional private exported model is not installed')
        m = json.loads((folder / 'live-model.json').read_text())["model"]
        base = json.loads((folder / 'live-progress.json').read_text())["result"]
        base["ctx"] = {"start": m["start"]}
        base["fitness"] = base["duration_minutes"]
        ga = {"_pp_schedule_sequence": lambda *_: base, "_pp_validate_generic": independent_validation}
        self.assertTrue(install_operation_interleave(ga, m))
        result = ga["_pp_schedule_sequence"](m, base["order_sequence"])
        self.assertEqual(result["duration_minutes"], 3)
        self.assertEqual(len(result["operations"]), 6)
        self.assertEqual(independent_validation(m, result), [])
        for field in ("algorithm", "optimization_run", "total_generations", "resume_state"):
            self.assertEqual(result[field], base[field])

    def test_existing_public_pin_verifier_accepts_retimed_candidate(self):
        path = Path(os.environ.get('PP_NATIVE_CONSTRAINTS', '/workspace/scratch/005b44eb59b5/cutlets_solver_validation/ga_python_workers/ga_workers/constraints.py'))
        if not path.is_file():
            self.skipTest('optional existing public constraints module is not installed')
        spec = importlib.util.spec_from_file_location('original_constraints', path)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        m = model(); before, result, calls = self.run_schedule(m)
        native_helpers = {'_pp_materials': lambda _: [], '_pp_validate_generic': independent_validation}
        self.assertTrue(module._verify(m, result, [], native_helpers))


if __name__ == "__main__":
    unittest.main(verbosity=2)
