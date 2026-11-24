import ast
import copy
import io
import json
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path
import types
import unittest
from unittest.mock import patch as mock_patch

import batch_size_diagnostics as diagnostics
import patch as adapter_patch


def model():
    return {"start": "2026-10-05T08:00:00", "orders": [{"id": "private-order", "quantity": 10, "batch_quantity": 5}],
            "materials": [{"id": "private-material", "initial_stock": 3,
                           "deliveries": [{"at": "2026-10-05T08:05:00", "quantity": 7}]}]}


def plan(at=5, quantities=(5, 5)):
    return {"duration_minutes": at + 2, "operations": [
        {"order": "private-order", "start_min": at, "end_min": at + 2,
         "materials": [{"id": "private-material", "quantity": 10}]}],
        "batches": [{"order": "private-order", "quantity": value} for value in quantities]}


def fixture_adapter():
    return """import copy
from pathlib import Path
SOURCE = Path('/tmp/production_planner.py')
def _namespace():
    return {}
def run(payload,progress):
    ga = _namespace()
    normalized = payload['model']
    opts = payload['options']
    pins = []
    objective=opts.get('objective') or 'duration'
    if pins:
        try: pins=make_constrained_scheduler(ga,pins,normalized)
        except Exception: raise
    result=ga['optimize'](gens,population,seed,continuing,objective)
    _assert_owned(result,normalized)
    result['resume_state']=export_resume_state(result,normalized,objective,pins)
    return result
"""


class DiagnosticsTests(unittest.TestCase):
    def test_observation_returns_same_objects_preserves_arguments_and_model(self):
        m = model()
        p = plan()
        before = copy.deepcopy(m)
        calls = []
        def native(*args, **kwargs):
            calls.append((args, kwargs))
            return p
        ga = {"_pp_schedule_sequence": native, "unrelated": object()}
        self.assertTrue(diagnostics.install_batch_size_diagnostics(ga, m))
        order_ids = ["private-order"]
        out = ga["_pp_schedule_sequence"](m, order_ids, extra="untouched")
        self.assertIs(out, p)
        self.assertIs(calls[0][0][0], m)
        self.assertIs(calls[0][0][1], order_ids)
        self.assertEqual(calls[0][1], {"extra": "untouched"})
        self.assertEqual(m, before)
        d = diagnostics.finalize_batch_size_diagnostics(ga, p, m)
        self.assertEqual(d["mode"], "diagnostic_only")
        self.assertEqual(d["first_raw_material_prefix"]["status"], "valid")
        self.assertNotIn("private-order", json.dumps(d))
        self.assertNotIn("private-material", json.dumps(d))

    def test_exceptions_and_cancellation_keep_identity(self):
        for exception in (RuntimeError("native private message"), KeyboardInterrupt()):
            def native(*args, **kwargs):
                raise exception
            ga = {"_pp_schedule_sequence": native}
            diagnostics.install_batch_size_diagnostics(ga, model())
            with self.assertRaises(type(exception)) as caught:
                ga["_pp_schedule_sequence"](model(), [1])
            self.assertIs(caught.exception, exception)
            self.assertEqual(ga[diagnostics.KEY]["scheduler_calls_observed"], 0)

    def test_sampling_stops_after_sixteen_without_more_inspection(self):
        m, p = model(), plan()
        calls = []
        def native(*args, **kwargs):
            calls.append(1)
            return p
        ga = {"_pp_schedule_sequence": native}
        diagnostics.install_batch_size_diagnostics(ga, m)
        for _ in range(16):
            ga["_pp_schedule_sequence"](m, [1])
        with mock_patch.object(diagnostics, "_schedule_sample", side_effect=AssertionError("must not inspect")):
            for _ in range(40):
                self.assertIs(ga["_pp_schedule_sequence"](m, [1]), p)
        self.assertEqual(len(calls), 56)
        self.assertEqual(len(ga[diagnostics.KEY]["scheduler_samples"]), 16)
        self.assertNotIn("observation_error", ga[diagnostics.KEY])

    def test_input_sizes_counts_and_partitions_observed_independently(self):
        m = model()
        current = [plan()]
        def native(*args, **kwargs):
            return current[0]
        ga = {"_pp_schedule_sequence": native}
        diagnostics.install_batch_size_diagnostics(ga, m)
        ga["_pp_schedule_sequence"](m, ["private-order"])
        changed = copy.deepcopy(m)
        changed["orders"][0]["batch_quantity"] = 2.5
        current[0] = plan(5, (2.5, 2.5, 2.5, 2.5))
        ga["_pp_schedule_sequence"](candidate_model=changed, order_ids=["private-order"])
        d = ga[diagnostics.KEY]
        self.assertEqual(d["distinct_input_batch_vectors"], 2)
        self.assertTrue(d["input_batch_fields_changed_from_model"])
        self.assertEqual(d["distinct_partition_vectors"], 2)
        self.assertEqual(d["distinct_count_vectors"], 2)
        self.assertEqual(d["scheduler_samples"][1]["minimum_batch_quantity"], 2.5)

    def test_function_contract_aliases_references_and_identifier_constants_only(self):
        scope = {}
        exec("def _pp_split_batches(model, n=123456):\n    return model.get('batch_quantity'), 'credential=never-output', 'https://private.example', 987654321, 'private_batch_secret'\ndef _pp_optimize_generic(model, /, count=3, *args, option=None, **kwargs):\n    return _pp_split_batches(model, count)\n", scope)
        scope["_pp_saved_batching"] = scope["_pp_split_batches"]
        meta = diagnostics._native_functions(scope)
        rows = {row["binding"]: row for row in meta["functions"]}
        split = rows["_pp_split_batches"]
        self.assertIn("_pp_saved_batching", split["aliases"])
        self.assertEqual(split["batch_parameter_names"], ["batch_quantity"])
        self.assertEqual(rows["_pp_optimize_generic"]["references"][0]["binding"], "_pp_split_batches")
        kinds = {row["name"]: row["kind"] for row in rows["_pp_optimize_generic"]["parameters"]}
        self.assertEqual(kinds, {"model": "positional_only", "count": "positional", "args": "varargs", "option": "keyword_only", "kwargs": "varkw"})
        text = json.dumps(meta)
        for secret in ("credential", "private.example", "987654321", "123456", "private_batch_secret"):
            self.assertNotIn(secret, text)

    def test_wrapped_native_closures_are_followed_but_data_is_not_exported(self):
        scope = {}
        exec("def original_native(candidate_model, order_ids):\n    return candidate_model.get('mini_batch_count')\n", scope)
        def wrap(original):
            private_data = {"credential": "never-output"}
            def observed(*args, **kwargs):
                _ = private_data
                return original(*args, **kwargs)
            return observed
        ga = {"_pp_schedule_sequence": wrap(wrap(scope["original_native"]))}
        meta = diagnostics._native_functions(ga)
        self.assertTrue(any(row["implementation"] == "original_native" and row["closure_depth"] == 2
                            and "mini_batch_count" in row["batch_parameter_names"] for row in meta["functions"]))
        self.assertNotIn("never-output", json.dumps(meta))
        self.assertNotIn("credential", json.dumps(meta))

    def test_recursive_closure_and_function_count_are_bounded(self):
        def wrap(original):
            def wrapped(*args):
                return original(*args)
            return wrapped
        def native(*args):
            return None
        target = native
        for _ in range(20):
            target = wrap(target)
        ga = {"_pp_schedule_sequence": target}
        ga.update({"_pp_batch_" + str(i): native for i in range(100)})
        meta = diagnostics._native_functions(ga)
        self.assertLessEqual(len(meta["functions"]), diagnostics.MAX_FUNCTIONS)
        self.assertLessEqual(max(row["closure_depth"] for row in meta["functions"]), 3)
        self.assertTrue(meta["functions_truncated"])

    def test_material_prefix_distinguishes_raw_shortage_from_final_and_same_time_delivery(self):
        m = model()
        self.assertEqual(diagnostics.material_prefix_summary(m, plan(0))["status"], "invalid")
        self.assertEqual(diagnostics.material_prefix_summary(m, plan(5))["status"], "valid")
        ga = {"_pp_schedule_sequence": lambda *a, **k: plan(0)}
        diagnostics.install_batch_size_diagnostics(ga, m)
        ga["_pp_schedule_sequence"](m, [1])
        final = plan(5)
        before = copy.deepcopy(final)
        report = diagnostics.finalize_batch_size_diagnostics(ga, final, m)
        self.assertEqual(report["first_raw_material_prefix"]["status"], "invalid")
        self.assertEqual(report["final_plan"]["material_prefix"]["status"], "valid")
        self.assertEqual(final, before)
        report["scheduler_samples"].append({"edited": True})
        self.assertEqual(len(ga[diagnostics.KEY]["scheduler_samples"]), 1)

    def test_malformed_observation_never_changes_native_return_or_leaks_errors(self):
        for p in (None, 7, {"operations": "private text", "batches": [{}]}, plan()):
            ga = {"_pp_schedule_sequence": lambda *a, **k: p}
            diagnostics.install_batch_size_diagnostics(ga, model())
            self.assertIs(ga["_pp_schedule_sequence"]("not a model", object()), p)
            report = diagnostics.finalize_batch_size_diagnostics(ga, p, {})
            self.assertNotIn("private text", json.dumps(report))

    def test_no_stdout_per_run_isolation_and_idempotence(self):
        output = io.StringIO()
        with redirect_stdout(output), redirect_stderr(output):
            first, second = {}, {}
            for ga in (first, second):
                ga["_pp_schedule_sequence"] = lambda *a, **k: plan()
                self.assertTrue(diagnostics.install_batch_size_diagnostics(ga, model()))
                installed = ga["_pp_schedule_sequence"]
                self.assertFalse(diagnostics.install_batch_size_diagnostics(ga, model()))
                self.assertIs(ga["_pp_schedule_sequence"], installed)
            first["_pp_schedule_sequence"](model(), [1])
        self.assertEqual(output.getvalue(), "")
        self.assertEqual(second[diagnostics.KEY]["scheduler_calls_observed"], 0)
        self.assertIsNot(first[diagnostics.KEY], second[diagnostics.KEY])

    def test_adapter_exact_reversal_idempotence_and_missing_partial_duplicate_guards(self):
        source = fixture_adapter()
        patched = adapter_patch.patch(source)
        ast.parse(patched)
        self.assertEqual(adapter_patch.patch(patched), patched)
        reverse = patched
        for part in (adapter_patch.IMPORT + "\n", adapter_patch.CALL, adapter_patch.FINAL):
            reverse = reverse.replace(part, "", 1)
        self.assertEqual(reverse, source)
        self.assertLess(patched.index(adapter_patch.CALL), patched.index(adapter_patch.ANCHOR))
        for bad in (source.replace(adapter_patch.ANCHOR, "    pass"),
                    source + adapter_patch.ANCHOR,
                    patched.replace(adapter_patch.CALL, "", 1),
                    patched + adapter_patch.FINAL):
            with self.assertRaises(RuntimeError):
                adapter_patch.patch(bad)

    def test_actual_readonly_snapshot_prefixes_when_available(self):
        directory = Path('/tmp/liftorbit-units-utilization-20261124')
        paths = [directory / name for name in ('live-model.json', 'live-plan.json', 'final-plan.json')]
        if not all(path.is_file() for path in paths):
            self.skipTest('local account snapshots unavailable; never committed')
        m, raw, final = (json.loads(path.read_text()) for path in paths)
        self.assertEqual(diagnostics.material_prefix_summary(m, raw)["negative_stock_material_count"], 6)
        self.assertEqual(diagnostics.material_prefix_summary(m, final)["status"], "valid")


if __name__ == '__main__':
    unittest.main()
