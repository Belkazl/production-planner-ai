import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch as mock_patch

import native_input_contract as inputs
import verify_native as verification


def source_fields():
    fields = {key: 'opaque-owned-code' for key in inputs.CODE_KEYS}
    fields.update(PP_RUNTIME_SRC_COUNT='1', PP_RUNTIME_SRC_01='YWJj', PP_PY_GA_SOURCE_SHA256='a' * 64)
    return fields


def example_plan(material=False):
    sizes = [10, 5, 10, 5]
    starts = [0, 0, 15 if material else 10, 15 if material else 10]
    rows, batches = [], []
    for index, (quantity, start) in enumerate(zip(sizes, starts), 1):
        equipment = 'BIG' if quantity == 10 else 'SMALL'
        rows.append({'order': 'SYNTHETIC_ORDER', 'operation_id': 'WORK', 'batch': index,
            'batch_quantity': quantity, 'equipment_ids': [equipment], 'start_min': start,
            'end_min': start + 10, 'materials': [{'id': 'SYNTHETIC_MATERIAL', 'quantity': quantity}] if material else []})
        batches.append({'order': 'SYNTHETIC_ORDER', 'quantity': quantity})
    return {'valid': True, 'duration_minutes': max(starts) + 10, 'operations': rows, 'batches': batches}


class HarnessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).resolve().parents[1] / 'batch-size-search-20261124' / 'batch_size_diagnostics.py'
        spec = importlib.util.spec_from_file_location('native_test_diagnostics', path)
        cls.diagnostics = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.diagnostics)

    def test_input_allowlist_excludes_credentials_and_unused_source_fields(self):
        raw = source_fields()
        raw.update(DATABASE_URL='private-db-value', PP_WORKER_INTERNAL_TOKEN='private-token',
                   OVH_SSH_PRIVATE_KEY='private-key', PP_UNUSED_CODE='not-selected', PP_RUNTIME_SRC_02='not-selected')
        selected = inputs.select_code_fields(raw)
        encoded = json.dumps(selected)
        for value in ('private-db-value', 'private-token', 'private-key', 'not-selected'):
            self.assertNotIn(value, encoded)
        self.assertEqual(set(selected), inputs.CODE_KEYS | {'PP_RUNTIME_SRC_COUNT', 'PP_RUNTIME_SRC_01', 'PP_PY_GA_SOURCE_SHA256'})

    def test_input_rejects_unresolved_missing_unbounded_and_wrong_shape(self):
        bads = []
        raw = source_fields(); raw['PP_GENERIC_CORE_B64'] = '${{service.value}}'; bads.append(raw)
        raw = source_fields(); del raw['PP_CAPACITY_BATCHING_PATCH_CODE']; bads.append(raw)
        raw = source_fields(); raw['PP_RUNTIME_SRC_COUNT'] = '65'; bads.append(raw)
        raw = source_fields(); raw['PP_RUNTIME_SRC_01'] = 'not base64'; bads.append(raw)
        raw = source_fields(); raw['PP_PY_GA_SOURCE_SHA256'] = 'invalid'; bads.append(raw)
        raw = source_fields(); raw['unrelated'] = {'secret': 1}; bads.append(raw)
        for raw in bads:
            with self.assertRaises(inputs.InputContractError):
                inputs.select_code_fields(raw)

    def test_compiler_pin_matches_existing_public_exact_builder(self):
        path = Path('/workspace/scratch/005b44eb59b5/cutlets_solver_validation/ga_python_workers/ga_workers/compile_legacy_ga.py')
        if not path.is_file():
            self.skipTest('local public worker clone absent')
        data = path.read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), inputs.COMPILE_SHA)
        self.assertEqual(inputs.compiler_keys(data), inputs.CODE_KEYS)

    def test_mixed_witness_valid_and_capacity_max_reference_distinct(self):
        result = verification.check_witness(example_plan(), verification.witness_model(), self.diagnostics)
        self.assertEqual(result['duration_minutes'], 20)
        self.assertTrue(result['reached_lower_bound'])
        self.assertEqual(result['batch_sizes'], [5, 5, 10, 10])
        self.assertTrue(result['mixed_sizes'])

    def test_material_case_requires_delivery_and_exact_consumption(self):
        model = verification.witness_model(True)
        self.assertEqual(verification.check_witness(example_plan(True), model, self.diagnostics)['duration_minutes'], 25)
        early = example_plan(True)
        early['operations'][2]['start_min'] = 10; early['operations'][2]['end_min'] = 20
        early['operations'][3]['start_min'] = 10; early['operations'][3]['end_min'] = 20
        early['duration_minutes'] = 20
        with self.assertRaisesRegex(verification.VerificationError, 'material_stock_prefix'):
            verification.check_witness(early, model, self.diagnostics)
        wrong = example_plan(True); wrong['operations'][0]['materials'][0]['quantity'] = 1
        with self.assertRaisesRegex(verification.VerificationError, 'material_consumption_amount'):
            verification.check_witness(wrong, model, self.diagnostics)

    def test_witness_rejects_overlap_volume_capacity_duration_and_fake_kpi(self):
        cases = []
        p = example_plan(); p['operations'][2]['start_min'] = 5; p['operations'][2]['end_min'] = 15; cases.append(p)
        p = example_plan(); p['batches'][0]['quantity'] = 9; cases.append(p)
        p = example_plan(); p['operations'][0]['equipment_ids'] = ['SMALL']; cases.append(p)
        p = example_plan(); p['operations'][0]['end_min'] = 9; cases.append(p)
        p = example_plan(); p['duration_minutes'] = 19; cases.append(p)
        for p in cases:
            with self.assertRaises(verification.VerificationError):
                verification.check_witness(p, verification.witness_model(), self.diagnostics)

    def test_state_metadata_does_not_export_values_or_unknown_keys(self):
        namespace = {'_PP_JOINT_BATCH_STATE': {'best_genome': {'private': [1, 2, 3]}, 'private_token': 'never-output'},
                     'DATABASE_URL': 'never-output', 'CURRENT_MODEL': {'private': True}}
        out = json.dumps(verification.state_metadata(namespace))
        self.assertIn('_PP_JOINT_BATCH_STATE', out)
        self.assertIn('best_genome', out)
        for forbidden in ('never-output', 'private_token', 'CURRENT_MODEL', 'DATABASE_URL'):
            self.assertNotIn(forbidden, out)

    def test_early_compiled_metadata_keeps_names_without_source_or_defaults(self):
        code = "def _ppjb_native(model, gene='private_batch_secret'):\n    return 'private-source-value'\ndef unrelated():\n    return 99\n"
        result = verification.compiled_function_metadata(code)
        self.assertEqual(result['functions'], [{'name': '_ppjb_native', 'parameters': ['model', 'gene'], 'first_line': 1, 'parameters_truncated': False}])
        encoded = json.dumps(result)
        self.assertNotIn('private_batch_secret', encoded)
        self.assertNotIn('private-source-value', encoded)

    def test_whole_run_observer_preserves_native_objects_arguments_and_validation_copy(self):
        model = verification.witness_model()
        original_plan = example_plan()
        seen = []
        adapter = types.SimpleNamespace()
        def factory():
            namespace = {}
            def decoder(candidate_model, order_ids):
                seen.append((candidate_model, order_ids))
                return original_plan
            def validate(candidate_model, sim):
                sim['validator_modified_copy'] = True
                return []
            def optimize(*args, **kwargs):
                for _ in range(70):
                    value = namespace['_pp_schedule_sequence'](candidate_model=model, order_ids=['SYNTHETIC_ORDER'])
                    self.assertIs(value, original_plan)
                return {**copy.deepcopy(original_plan), 'resume_state': {'version': 1}}
            namespace.update(_pp_schedule_sequence=decoder, _pp_validate_generic=validate, optimize=optimize)
            return namespace
        adapter._namespace = factory
        adapter.run = lambda payload, progress: adapter._namespace()['optimize']()
        result, report = verification.observed_run(adapter, self.diagnostics, model, {})
        self.assertIs(adapter._namespace, factory)
        self.assertEqual(report['decoder_calls'], 70)
        self.assertEqual(report['native_raw_valid'], 70)
        self.assertEqual(report['distinct_partition_vectors'], 1)
        self.assertEqual(report['partitions'], [[5.0, 5.0, 10.0, 10.0]])
        self.assertTrue(all(item[0] is model for item in seen))
        self.assertNotIn('validator_modified_copy', original_plan)
        self.assertTrue(report['result']['reached_lower_bound'])

    def test_rootless_command_has_no_host_root_or_service_socket_mounts(self):
        command = verification.bwrap_base('/usr/bin/bwrap', '/usr/bin/python3')
        for required in ('--unshare-user', '--unshare-net', '--unshare-pid', '--clearenv', '--die-with-parent'):
            self.assertIn(required, command)
        for forbidden in ('/home', '/run', '/var', '--bind', 'sudo', 'docker'):
            self.assertNotIn(forbidden, command)
        self.assertIn('--tmpfs', command)
        self.assertEqual(command[command.index('--tmpfs') + 1], '/tmp')
        self.assertNotIn('/', command)

    def test_missing_or_denied_rootless_isolation_never_reads_private_inputs(self):
        with mock_patch.object(verification.os, 'geteuid', return_value=1000), \
             mock_patch.object(verification.shutil, 'which', return_value=None), \
             mock_patch.object(verification, 'load_owned_inputs') as loader:
            with self.assertRaisesRegex(verification.VerificationError, 'rootless_bwrap_unavailable'):
                verification.run_host_local()
            loader.assert_not_called()
        system_binary = types.SimpleNamespace(st_uid=0, st_mode=0o100755)
        with mock_patch.object(verification.os, 'geteuid', return_value=1000), \
             mock_patch.object(verification.shutil, 'which', return_value='/usr/bin/bwrap'), \
             mock_patch.object(verification.Path, 'stat', return_value=system_binary), \
             mock_patch.object(verification, 'verify_rootless_isolation', side_effect=verification.VerificationError('rootless_namespace_unavailable')), \
             mock_patch.object(verification, 'load_owned_inputs') as loader:
            with self.assertRaisesRegex(verification.VerificationError, 'rootless_namespace_unavailable'):
                verification.run_host_local()
            loader.assert_not_called()


if __name__ == '__main__':
    unittest.main()
