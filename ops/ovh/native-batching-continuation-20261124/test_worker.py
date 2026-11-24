import copy
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import types
import unittest

HERE = Path(__file__).resolve().parent
PACKAGE = "joint_continuation_test_package"
package = types.ModuleType(PACKAGE)
package.__path__ = [str(HERE)]
sys.modules[PACKAGE] = package


def module(name, path):
    spec = importlib.util.spec_from_file_location(PACKAGE + "." + name, path)
    loaded = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = loaded
    spec.loader.exec_module(loaded)
    return loaded


fixture_root = os.environ.get("LIFTORBIT_CONTINUATION_FIXTURE_ROOT")
legacy_path = Path(fixture_root) / "continuation.py" if fixture_root else HERE / "fixtures/continuation_v1.py"
legacy = module("continuation", legacy_path)
joint = module("joint_continuation", HERE / "joint_continuation.py")
patcher = module("patch_worker", HERE / "patch_worker.py")


def model():
    return {"orders": [{"id": "A", "quantity": 30}, {"id": "B", "quantity": 10}],
            "equipment": [{"id": "BIG", "capacity": 10}, {"id": "SMALL", "capacity": 5}],
            "employees": [], "materials": [], "setup_rules": [], "shifts": {}}


def genome():
    return {"version": 1, "order_sequence": ["B", "A"], "partitions": [
        {"order_id": "B", "sizes": [5, 5]},
        {"order_id": "A", "sizes": [10, 5, 10, 5]}]}


def result():
    return {"valid": True, "partial": False, "order_sequence": ["B", "A"],
            "duration_minutes": 30.0, "optimization_run": 2, "total_generations": 48}


def engine(exported=None, reject_load=False):
    loaded = []
    state = {"version": joint.JOINT_SCHEMA}
    def load(value):
        if reject_load:
            raise ValueError("synthetic pin identity mismatch")
        loaded.append(copy.deepcopy(value))
        state["seed"] = copy.deepcopy(value)
    def export(final):
        return copy.deepcopy(exported) if final.get("matched_incumbent", True) else None
    state.update(load_incumbent=load, export_incumbent=export)
    ga = {joint.STATE_KEY: state, "_PP_GENERIC_STATE": {"unrelated": "preserved"}}
    return ga, loaded


def portable():
    ga, _ = engine(genome())
    return joint.export_joint_resume_state(result(), model(), "duration", [], ga)


def adapter_fixture(native_v2=True):
    source = """import copy
from pathlib import Path
from .continuation import load_resume_state, export_resume_state, ContinuationError
SOURCE = Path('/tmp/production_planner.py')

def _live_scheduler_preview(sim, model, objective, ga, pins, checkpoint=False):
    if not isinstance(sim,dict) or not isinstance(sim.get('ctx'),dict):
        return None
    plan=dict(sim)
    model_ids=[str(row['id']) for row in model['orders']]
    rows=sim.get('operations') or []
    if checkpoint:
        cache=ga.get('_PP_GENERIC_STATE') or {}
        stored=cache.get('best_order')
        if isinstance(stored,list) and len(stored)==len(model_ids) and set(map(str,stored))==set(model_ids):
            seq=list(map(str,stored))
        else:
            seq=[];seen=set()
            for row in sorted(rows,key=lambda x:(float(x.get('start_min') or 0),
                                                 float(x.get('end_min') or 0))):
                oid=str(row.get('order'))
                if oid not in seen:seq.append(oid);seen.add(oid)
        if len(seq)!=len(model_ids) or set(seq)!=set(model_ids):
            return plan
        plan['order_sequence']=seq
        plan['resume_state']=export_resume_state(plan,model,objective,pins)
    return plan

def run(payload,progress):
    ga=_namespace()
    normalized=payload['model']
    opts=payload['options']
    objective=opts.get('objective') or 'duration'
    pins=[]
    continuing=True
CONTINUE_BODY
    def captured_progress_best(model_arg,sim_arg,objective_arg):
        out=original_progress_best(model_arg,sim_arg,objective_arg)
        try:
            now_check=time.monotonic()
            if now_check-state['best_checked_at']>=1.5 or not state.get('verified_checkpoint'):
                state['best_checked_at']=now_check
                live=_live_scheduler_preview(sim_arg,normalized,objective_arg,ga,pins,checkpoint=True)
                if live is not None:
                    old=state.get('verified_checkpoint')
                    if (old is None or objective_arg!='duration' or
                        float(live['duration_minutes'])<=float(old['duration_minutes'])+1e-8):
                        state['best_preview']=live
                        state['best_seq']=int(state.get('best_seq') or 0)+1
                        if live.get('_pp_verified_checkpoint_v1'):
                            state['verified_checkpoint']=live
        except Exception:pass
        return out
    result=ga['optimize'](gens,population,seed,continuing,objective)
    _assert_owned(result,normalized)
    result['resume_state']=export_resume_state(result,normalized,objective,pins)
    return result
"""
    if native_v2:
        repo = HERE.parents[2]
        text = (repo / "ops/ovh/ga-continue-native-v2-20261119/patch.mjs").read_text()
        body = json.loads(re.search(r'^const newPy=(".*");$', text, re.M).group(1))
    else:
        body = """    if continuing:
        try:
            if opts.get('resume_state'):
                load_resume_state(opts.get('resume_state'),normalized,objective,pins,ga)
            else:
                load_resume_plan(opts.get('resume_plan'),normalized,objective,pins,ga)
        except ContinuationError as ex:raise FullGAError(str(ex)) from ex"""
    return source.replace("CONTINUE_BODY", body)


class ContinuationTests(unittest.TestCase):
    def test_actual_public_v1_fixture_retains_hash_and_pin_guards(self):
        text = legacy_path.read_text()
        for guard in ("state.get('model_hash') != fingerprint(model)",
                      "state.get('pin_hash') != fingerprint(pins or [])",
                      "state.get('objective') != objective"):
            self.assertIn(guard, text)

    def test_joint_roundtrip_preserves_ordered_genome_and_recomputes_score(self):
        saved = portable()
        self.assertEqual(saved["version"], 2)
        self.assertEqual(saved["joint_schema"], joint.JOINT_SCHEMA)
        self.assertEqual(saved["model_hash"], legacy.fingerprint(model()))
        self.assertEqual(saved["pin_hash"], legacy.fingerprint([]))
        self.assertEqual(saved["batch_genome"], genome())
        ga, loaded = engine()
        sequence = joint.load_joint_resume_state(saved, model(), "duration", [], ga)
        self.assertEqual(sequence, ["B", "A"])
        self.assertEqual(loaded, [genome()])
        self.assertEqual(ga["_PP_GENERIC_STATE"]["best_duration"], 1e9)
        self.assertEqual(ga["_PP_GENERIC_STATE"]["run"], 2)
        self.assertEqual(ga["_PP_GENERIC_STATE"]["total_trials"], 48)
        self.assertEqual(ga["_PP_GENERIC_STATE"]["unrelated"], "preserved")
        saved["batch_genome"]["partitions"][1]["sizes"].reverse()
        self.assertEqual(loaded[0]["partitions"][1]["sizes"], [10, 5, 10, 5])

    def test_changed_model_pins_and_objective_fail_before_native_seed_or_cache_writes(self):
        saved = portable()
        changed = model(); changed["equipment"][0]["capacity"] = 9
        for active_model, objective, pins, code in [
            (changed, "duration", [], "continuation_model_changed"),
            (model(), "cycles", [], "continuation_objective_changed"),
        ]:
            ga, loaded = engine()
            before = copy.deepcopy(ga["_PP_GENERIC_STATE"])
            with self.assertRaisesRegex(legacy.ContinuationError, code):
                joint.load_joint_resume_state(saved, active_model, objective, pins, ga)
            self.assertEqual(loaded, [])
            self.assertEqual(ga["_PP_GENERIC_STATE"], before)

    def test_new_pin_reseeds_original_ordered_partition_without_rebinding_hash_or_fitness(self):
        saved = portable(); original = copy.deepcopy(saved)
        pins = [{"order": "A", "operation_id": "WORK", "batch": 2, "batch_quantity": 5,
                 "start_min": 0, "end_min": 10, "equipment_ids": ["SMALL"]}]
        ga, loaded = engine()
        self.assertEqual(joint.load_joint_resume_state(saved, model(), "duration", pins, ga), ["B", "A"])
        self.assertEqual(loaded, [genome()])
        self.assertEqual(saved, original)
        self.assertNotEqual(saved['pin_hash'], legacy.fingerprint(pins))
        self.assertEqual(ga['_PP_GENERIC_STATE']['best_duration'], 1e9)
        self.assertEqual(ga['_PP_GENERIC_STATE']['run'], 1)
        self.assertEqual(ga['_PP_GENERIC_STATE']['total_trials'], 0)
        self.assertEqual(ga[joint.STATE_KEY]['continuation_seed_provenance'], {
            'mode': 'changed_pins_revalidated', 'model_hash': saved['model_hash'], 'pin_hash': saved['pin_hash']})

        rejected, loaded = engine(reject_load=True)
        with self.assertRaisesRegex(legacy.ContinuationError, 'joint_seed_rejected'):
            joint.load_joint_resume_state(saved, model(), "duration", pins, rejected)
        self.assertEqual(loaded, [])
        self.assertEqual(rejected['_PP_GENERIC_STATE'], {'unrelated': 'preserved'})
        self.assertNotIn('continuation_seed_provenance', rejected[joint.STATE_KEY])
        for field, value in [('model_hash', '0' * 64), ('objective', 'cycles'), ('pin_hash', 'invalid')]:
            stale = dict(saved, **{field: value}); fresh, loaded = engine()
            with self.assertRaises(legacy.ContinuationError):
                joint.load_joint_resume_state(stale, model(), 'duration', pins, fresh)
            self.assertEqual(loaded, [])

    def test_invalid_genome_never_changes_real_cache_or_native_seed(self):
        mutations = [
            lambda g: g.update(version=2),
            lambda g: g.update(order_sequence=["A", "B"]),
            lambda g: g["partitions"].reverse(),
            lambda g: g["partitions"][0].update(order_id="FOREIGN"),
            lambda g: g["partitions"][0].update(sizes=[10, 10]),
            lambda g: g["partitions"][0].update(sizes=[0, 10]),
            lambda g: g["partitions"][0].update(sizes=[True, 9]),
            lambda g: g["partitions"][0].update(sizes=[float("nan")]),
            lambda g: g["partitions"][0].update(sizes=[10 / 129] * 129),
            lambda g: g.update(operations=[]),
        ]
        for mutate in mutations:
            saved = portable(); mutate(saved["batch_genome"])
            ga, loaded = engine()
            with self.assertRaises(legacy.ContinuationError):
                joint.load_joint_resume_state(saved, model(), "duration", [], ga)
            self.assertEqual(loaded, [])
            self.assertEqual(ga["_PP_GENERIC_STATE"], {"unrelated": "preserved"})

    def test_state_schema_size_and_score_are_checked(self):
        cases = []
        x = portable(); x["joint_schema"] = "unknown"; cases.append(x)
        x = portable(); x["context"] = {}; cases.append(x)
        x = portable(); x["model_hash"] = "x" * 65536; cases.append(x)
        x = portable(); x["best_duration_minutes"] = -1; cases.append(x)
        x = portable(); x["completed_runs"] = True; cases.append(x)
        x = portable(); x["total_trials"] = 100000001; cases.append(x)
        for saved in cases:
            ga, loaded = engine()
            with self.assertRaises(legacy.ContinuationError):
                joint.load_joint_resume_state(saved, model(), "duration", [], ga)
            self.assertEqual(loaded, [])

    def test_native_rejection_preserves_cache_and_original_exception_cause(self):
        ga, loaded = engine(reject_load=True)
        with self.assertRaisesRegex(legacy.ContinuationError, "continuation_joint_seed_rejected") as captured:
            joint.load_joint_resume_state(portable(), model(), "duration", [], ga)
        self.assertIsInstance(captured.exception.__cause__, ValueError)
        self.assertEqual(loaded, [])
        self.assertEqual(ga["_PP_GENERIC_STATE"], {"unrelated": "preserved"})

    def test_actual_old_load_path_falls_back_without_laundering_rejected_batch_genes(self):
        saved = portable()
        saved["model_hash"] = "0" * 64
        ga, loaded = engine()
        hint = {"order_sequence": ["A", "B"], "duration_minutes": 1,
                "untrusted_native_genome": genome(), "model_hash": "forged"}
        self.assertEqual(joint.load_joint_resume_state(saved, model(), "duration", [], ga,
                                                      resume_plan=hint), ["A", "B"])
        self.assertEqual(loaded, [])
        self.assertEqual(saved["model_hash"], "0" * 64)
        self.assertEqual(ga["_PP_GENERIC_STATE"]["best_duration"], 1e9)
        self.assertEqual(ga["_PP_GENERIC_STATE"]["run"], 1)
        self.assertEqual(ga["_PP_GENERIC_STATE"]["total_trials"], 0)
        self.assertNotIn("seed", ga[joint.STATE_KEY])
        with self.assertRaisesRegex(legacy.ContinuationError, "continuation_order_seed_missing_or_invalid"):
            joint.load_joint_resume_state(saved, model(), "duration", [], engine()[0],
                                          resume_plan={"order_sequence": ["FOREIGN", "B"]})

    def test_selected_partition_is_a_fresh_native_validated_seed_without_client_fitness(self):
        selected = genome()
        selected['partitions'][1]['sizes'] = [5, 10, 5, 10]
        plan = {'order_sequence': selected['order_sequence'], 'batch_genome': selected,
                'duration_minutes': 0, 'optimization_run': 123, 'total_generations': 999,
                'model_hash': 'forged', 'pin_hash': 'forged'}
        ga, loaded = engine()
        self.assertEqual(joint.load_joint_resume_plan(plan, model(), 'duration', [], ga), ['B', 'A'])
        self.assertEqual(loaded, [selected])
        self.assertEqual(ga['_PP_GENERIC_STATE']['best_duration'], 1e9)
        self.assertEqual(ga['_PP_GENERIC_STATE']['run'], 1)
        self.assertEqual(ga['_PP_GENERIC_STATE']['total_trials'], 0)
        self.assertEqual(ga[joint.STATE_KEY]['continuation_seed_provenance']['mode'], 'selected_partition_revalidated')
        ga, loaded = engine()
        stale = portable(); stale['model_hash'] = '0' * 64
        self.assertEqual(joint.load_joint_resume_state(stale, model(), 'duration', [], ga, resume_plan=plan), ['B', 'A'])
        self.assertEqual(loaded, [selected])
        self.assertEqual(stale['model_hash'], '0' * 64)

        for mutation in ('volume', 'foreign', 'order', 'native_pin'):
            rejected_plan = copy.deepcopy(plan)
            rejected, loaded = engine(reject_load=mutation == 'native_pin')
            if mutation == 'volume': rejected_plan['batch_genome']['partitions'][0]['sizes'] = [5]
            if mutation == 'foreign': rejected_plan['batch_genome']['partitions'][0]['order_id'] = 'FOREIGN'
            if mutation == 'order': rejected_plan['order_sequence'] = ['A', 'B']
            with self.assertRaises(legacy.ContinuationError):
                joint.load_joint_resume_plan(rejected_plan, model(), 'duration', [], rejected)
            self.assertEqual(loaded, [])
            self.assertEqual(rejected['_PP_GENERIC_STATE'], {'unrelated': 'preserved'})

    def test_missing_native_engine_and_unmatched_final_use_explicit_legacy_behavior(self):
        ga = {"_PP_GENERIC_STATE": {}}
        with self.assertRaisesRegex(legacy.ContinuationError, "continuation_joint_engine_unavailable"):
            joint.load_joint_resume_state(portable(), model(), "duration", [], ga)
        expected = legacy.export_resume_state(result(), model(), "duration", [])
        self.assertEqual(joint.export_joint_resume_state(result(), model(), "duration", [], ga), expected)
        ga, _ = engine(genome())
        earlier = dict(result(), matched_incumbent=False)
        self.assertEqual(joint.export_joint_resume_state(earlier, model(), "duration", [], ga), expected)

    def test_checkpoint_export_cannot_inherit_latest_unrelated_genome(self):
        final = result()
        ga, _ = engine(genome())
        original = copy.deepcopy(final)
        saved = joint.export_joint_resume_state(final, model(), "duration", [], ga)
        self.assertEqual(final, original)
        self.assertNotIn("load_incumbent", json.dumps(saved))
        self.assertNotIn("export_incumbent", json.dumps(saved))
        self.assertNotIn("operations", saved)
        mismatched = genome(); mismatched["order_sequence"].reverse()
        ga, _ = engine(mismatched)
        with self.assertRaises(legacy.ContinuationError):
            joint.export_joint_resume_state(final, model(), "duration", [], ga)
        with self.assertRaisesRegex(legacy.ContinuationError, "continuation_result_not_valid"):
            joint.export_joint_resume_state(dict(final, partial=True), model(), "duration", [], ga)

    def test_legacy_v1_is_order_only_and_does_not_call_joint_import(self):
        saved = legacy.export_resume_state(result(), model(), "duration", [])
        ga, loaded = engine(genome())
        self.assertEqual(joint.load_joint_resume_state(saved, model(), "duration", [], ga), ["B", "A"])
        self.assertEqual(loaded, [])
        self.assertEqual(ga["_PP_GENERIC_STATE"]["best_duration"], 30.0)


class PatchTests(unittest.TestCase):
    def test_exact_nov19_and_legacy_load_paths_patch_without_replacing_guards(self):
        for old in (adapter_fixture(True), adapter_fixture(False)):
            updated = patcher.patch(old)
            compile(updated, "<patched-adapter>", "exec")
            self.assertEqual(patcher.patch(updated), updated)
            self.assertEqual(updated.count(",ga=ga)"), 2)
            self.assertIn("_assert_owned(result,normalized)", updated)
            if patcher.OLD_GUARD in old:
                self.assertIn(patcher.NEW_GUARD, updated)
                self.assertNotIn(patcher.OLD_GUARD, updated)
            self.assertIn("from .continuation import fingerprint" if "portable={" in old else "load_resume_plan", updated)

    def test_first_verified_joint_checkpoint_upgrades_equal_duration_without_waiting(self):
        updated = patcher.patch(adapter_fixture(False))
        names = {"_pp_joint_preview_evaluating", "_pp_joint_checkpoint_needs_genome",
                 "_live_scheduler_preview", "captured_progress_best"}
        nodes = [node for node in ast.walk(ast.parse(updated)) if isinstance(node, ast.FunctionDef)
                 and node.name in names]
        ga, _ = engine(genome())
        ga[joint.STATE_KEY].update(evaluating=False, feasible=1)
        ga['_PP_GENERIC_STATE']['best_order'] = ['A', 'B']
        earlier = dict(result(), resume_state={"version": 1}, _pp_verified_checkpoint_v1=True)
        state = {"verified_checkpoint": earlier, "best_preview": earlier, "best_checked_at": 0.0}
        context = {"ga": ga, "pins": [], "normalized": model(), "state": state,
                   "time": types.SimpleNamespace(monotonic=lambda: 0.1),
                   "export_resume_state": joint.export_joint_resume_state,
                   "original_progress_best": lambda *_: "original-return"}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), "<public-preview-fixture>", "exec"), context)
        sim = dict(result(), ctx={}, _pp_verified_checkpoint_v1=True, operations=[
            {'order': 'A', 'start_min': 0, 'end_min': 10}, {'order': 'B', 'start_min': 10, 'end_min': 20}])
        self.assertEqual(context["captured_progress_best"](model(), sim, "duration"), "original-return")
        self.assertEqual(state["verified_checkpoint"]["resume_state"]["version"], 2)
        self.assertEqual(state["verified_checkpoint"]["resume_state"]["batch_genome"], genome())
        self.assertEqual(state['verified_checkpoint']['order_sequence'], ['B', 'A'],
                         'evaluated order wins over both the previous cache and chronological rows')
        self.assertEqual(state['verified_checkpoint']['operations'], sim['operations'])
        self.assertEqual(state["verified_checkpoint"]["duration_minutes"], 30)
        seq = state["best_seq"]
        context["captured_progress_best"](model(), sim, "duration")
        self.assertEqual(state["best_seq"], seq, "normal throttle resumes after the v2 promotion")

        mixed = genome(); mixed['partitions'][1]['sizes'] = [5, 10, 5, 10]
        ga[joint.STATE_KEY]['export_incumbent'] = lambda _plan: copy.deepcopy(mixed)
        improved = dict(sim, duration_minutes=25)
        context['captured_progress_best'](model(), improved, 'duration')
        self.assertEqual(state['best_seq'], seq + 1, 'a better mixed incumbent must not be lost inside the throttle')
        self.assertEqual(state['verified_checkpoint']['resume_state']['batch_genome'], mixed)
        self.assertEqual(state['verified_checkpoint']['duration_minutes'], 25)
        improved_again = dict(improved, duration_minutes=24)
        context['captured_progress_best'](model(), improved_again, 'duration')
        self.assertEqual(state['verified_checkpoint']['duration_minutes'], 24,
                         'a verified improvement with the same genotype must also replace its prior score')
        seq = state['best_seq']
        context['captured_progress_best'](model(), improved_again, 'duration')
        self.assertEqual(state['best_seq'], seq, 'duplicate best callbacks stay throttled')

        state.update(verified_checkpoint=dict(earlier, duration_minutes=20), best_preview=earlier,
                     best_checked_at=0.0)
        context["captured_progress_best"](model(), sim, "duration")
        self.assertEqual(state["verified_checkpoint"]["duration_minutes"], 20,
                         "promotion cannot discard an earlier shorter verified checkpoint")
        ga.pop(joint.STATE_KEY)
        legacy_plan = context['_live_scheduler_preview'](sim, model(), 'duration', ga, [], checkpoint=True)
        self.assertEqual(legacy_plan['order_sequence'], ['A', 'B'], 'the nonjoint ordering fallback is unchanged')

    def test_decode_in_progress_cannot_publish_or_force_a_checkpoint(self):
        namespace = {}
        exec(patcher.PREVIEW_HELPERS, namespace)
        ga, _ = engine(genome())
        ga[joint.STATE_KEY].update(evaluating=True, feasible=1)
        self.assertTrue(namespace["_pp_joint_preview_evaluating"](ga))
        self.assertFalse(namespace["_pp_joint_checkpoint_needs_genome"](ga, {"resume_state": {"version": 1}}))
        updated = patcher.patch(adapter_fixture(False))
        preview = next(node for node in ast.parse(updated).body if isinstance(node, ast.FunctionDef)
                       and node.name == "_live_scheduler_preview")
        namespace["export_resume_state"] = lambda *_args, **_kwargs: self.fail("unverified preview exported")
        exec(compile(ast.Module(body=[preview], type_ignores=[]), "<public-preview-fixture>", "exec"), namespace)
        self.assertIsNone(namespace["_live_scheduler_preview"](dict(result(), ctx={}), model(), "duration", ga, []))
        self.assertFalse(namespace["_pp_joint_preview_evaluating"]({}))

    def test_patch_rejects_unknown_guards_scopes_and_partial_installs(self):
        old = adapter_fixture(True)
        for changed in (old.replace(patcher.OLD_GUARD, "native_state.get('version') < 1"),
                        old.replace("_assert_owned(result,normalized)", "pass"),
                        old.replace("normalized,objective,pins,ga)", "normalized,objective,[],ga)")):
            with self.assertRaises(RuntimeError):
                patcher.patch(changed)
        updated = patcher.patch(old)
        with self.assertRaises(RuntimeError):
            patcher.patch(updated.replace(",ga=ga)", ")", 1))

    def test_optional_actual_adapter_patch_is_exact_and_parseable(self):
        if not fixture_root:
            self.skipTest("actual worker fixture root not provided")
        path = Path(fixture_root) / "full_runtime_adapter.py"
        updated = patcher.patch(path.read_text())
        compile(updated, "<actual-adapter-continuation>", "exec")
        self.assertEqual(patcher.patch(updated), updated)


if __name__ == "__main__":
    unittest.main(verbosity=2)
