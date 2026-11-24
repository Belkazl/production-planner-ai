import copy
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

def _live_scheduler_preview(preview,model,objective,ga,pins):
    preview['resume_state']=export_resume_state(preview,model,objective,pins)
    return preview

def run(payload,progress):
    ga=_namespace()
    normalized=payload['model']
    opts=payload['options']
    objective=opts.get('objective') or 'duration'
    pins=[]
    continuing=True
CONTINUE_BODY
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
            (model(), "duration", [{"order": "A", "batch": 1}], "continuation_manual_locks_changed")
        ]:
            ga, loaded = engine()
            before = copy.deepcopy(ga["_PP_GENERIC_STATE"])
            with self.assertRaisesRegex(legacy.ContinuationError, code):
                joint.load_joint_resume_state(saved, active_model, objective, pins, ga)
            self.assertEqual(loaded, [])
            self.assertEqual(ga["_PP_GENERIC_STATE"], before)

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
                "batch_genome": genome(), "model_hash": "forged"}
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
