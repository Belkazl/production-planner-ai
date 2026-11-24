import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import tarfile
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

    def synthetic_bundle(self):
        compiler = ('DATA_KEYS = ' + repr(sorted(inputs.CODE_KEYS)) + '\n').encode()
        files = {'ga_workers/' + name: b'# public synthetic module\n' for name in
                 ('__init__.py', 'full_runtime_adapter.py', 'constraints.py',
                  'continuation.py', 'batch_size_diagnostics.py')}
        files['ga_workers/compile_legacy_ga.py'] = compiler
        digest = hashlib.sha256(compiler).hexdigest()
        fields = source_fields()
        manifest = {'format': 'ephemeral-native-code-inputs-v1', 'compiler_sha256': digest,
                    'code_field_names': sorted(fields),
                    'source_hashes': {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}}
        stream = io.BytesIO()
        inputs.write_private_bundle(stream, fields, manifest, files)
        return stream.getvalue(), digest

    def write_bundle(self, root, data):
        path = root / 'private.bundle'
        path.write_bytes(data)
        path.chmod(0o600)
        target = root / 'unpacked'
        target.mkdir(mode=0o700)
        return path, target

    def test_private_bundle_roundtrip_exact_pinned_inputs_and_files(self):
        bundle, digest = self.synthetic_bundle()
        self.assertNotIn(b'DATABASE_URL', bundle)
        with tempfile.TemporaryDirectory() as temporary, mock_patch.object(verification, 'COMPILE_SHA', digest):
            path, target = self.write_bundle(Path(temporary), bundle)
            fields, manifest = verification.unpack_private_bundle(path, target)
            self.assertEqual(fields, source_fields())
            self.assertEqual(manifest['compiler_sha256'], digest)
            self.assertEqual((target / 'code-inputs.json').stat().st_mode & 0o777, 0o600)
            self.assertEqual((target / 'ga_workers').stat().st_mode & 0o777, 0o700)

    def test_bundle_rejects_path_link_duplicate_size_and_compiler_drift(self):
        for kind in ('traversal', 'symlink', 'duplicate', 'size'):
            stream = io.BytesIO()
            with tarfile.open(fileobj=stream, mode='w', format=tarfile.USTAR_FORMAT) as archive:
                item = tarfile.TarInfo('../private' if kind == 'traversal' else 'manifest.json')
                if kind == 'symlink':
                    item.type = tarfile.SYMTYPE; item.linkname = '/etc/private'
                if kind == 'size':
                    item.size = 65537
                archive.addfile(item, io.BytesIO(b'x' * item.size))
                if kind == 'duplicate':
                    archive.addfile(item, io.BytesIO())
            with tempfile.TemporaryDirectory() as temporary:
                path, target = self.write_bundle(Path(temporary), stream.getvalue())
                with self.assertRaises(verification.VerificationError):
                    verification.unpack_private_bundle(path, target)
                self.assertEqual(list(target.iterdir()), [])
        bundle, _ = self.synthetic_bundle()
        with tempfile.TemporaryDirectory() as temporary:
            path, target = self.write_bundle(Path(temporary), bundle)
            with self.assertRaisesRegex(verification.VerificationError, 'bundle_manifest_contract'):
                verification.unpack_private_bundle(path, target)

    def test_bundle_rejects_extra_environment_fields_before_writing(self):
        bundle, digest = self.synthetic_bundle()
        with tarfile.open(fileobj=io.BytesIO(bundle), mode='r:') as archive:
            members = {member.name: archive.extractfile(member).read() for member in archive}
        fields = json.loads(members['code-inputs.json'])
        fields['DATABASE_URL'] = 'never-forward-this-value'
        members['code-inputs.json'] = json.dumps(fields).encode()
        manifest = json.loads(members['manifest.json'])
        manifest['code_inputs_sha256'] = hashlib.sha256(members['code-inputs.json']).hexdigest()
        members['manifest.json'] = json.dumps(manifest).encode()
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode='w', format=tarfile.USTAR_FORMAT) as archive:
            for name, data in members.items():
                item = tarfile.TarInfo(name); item.size = len(data)
                archive.addfile(item, io.BytesIO(data))
        with tempfile.TemporaryDirectory() as temporary, mock_patch.object(verification, 'COMPILE_SHA', digest):
            path, target = self.write_bundle(Path(temporary), stream.getvalue())
            with self.assertRaisesRegex(verification.VerificationError, 'bundle_extra_input_field'):
                verification.unpack_private_bundle(path, target)
            self.assertEqual(list(target.iterdir()), [])

    def test_runner_container_has_no_network_secrets_or_host_service_mounts(self):
        command = verification.docker_command('/usr/bin/docker', 'sha256:' + 'a' * 64,
            Path('/tmp/private-test'), Path('/tmp/public-harness'), 'pp-native-verify-' + 'b' * 32)
        for required in ('--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
                         '--pids-limit=128', '--memory=1g', '--tmpfs'):
            self.assertIn(required, command)
        encoded = ' '.join(command)
        for forbidden in ('docker.sock', 'DATABASE_URL', 'GITHUB_TOKEN', 'SSH_PRIVATE_KEY',
                          'source=/,', 'source=/home,', 'source=/run,', 'source=/var,', 'sudo'):
            self.assertNotIn(forbidden, encoded)
        self.assertEqual(command.count('--mount'), 4)
        self.assertEqual(sum(',readonly' in part for part in command), 3)
        self.assertNotIn('--privileged', command)

    def test_unavailable_runner_runtime_does_not_unpack_private_inputs(self):
        with mock_patch.object(verification.os, 'geteuid', return_value=1000), \
             mock_patch.object(verification.shutil, 'which', return_value=None), \
             mock_patch.object(verification, 'unpack_private_bundle') as unpack:
            with self.assertRaisesRegex(verification.VerificationError, 'runner_container_runtime_unavailable'):
                verification.run_ephemeral(Path('/private.bundle'), 'sha256:' + 'a' * 64)
            unpack.assert_not_called()

    def test_public_report_omits_source_positions_recursively(self):
        result = verification.public_report({'functions': [{'name': 'native', 'first_line': 101,
            'nested': {'line': 102, 'parameters': ['model']}}], 'duration_minutes': 20})
        self.assertEqual(result, {'functions': [{'name': 'native', 'nested': {'parameters': ['model']}}],
                                  'duration_minutes': 20})

    def test_invalid_native_assignment_is_reported_without_weakening_checker(self):
        plan = example_plan()
        plan['operations'][0]['equipment_ids'] = ['SMALL']
        adapter = types.SimpleNamespace()
        adapter._namespace = lambda: {'_pp_schedule_sequence': lambda *a, **k: plan,
            'optimize': lambda *a, **k: plan}
        adapter.run = lambda payload, progress: {**copy.deepcopy(plan), 'resume_state': {'version': 1}}
        native, report = verification.observed_run(adapter, self.diagnostics, verification.witness_model(), {})
        self.assertFalse(report['result']['independent_valid'])
        self.assertEqual(report['result']['error_code'], 'native_duration_or_capacity')
        self.assertEqual(report['final_schedule']['operations'][0]['equipment_ids'], ['SMALL'])
        self.assertEqual(report['final_schedule']['operations'][0]['batch_quantity'], 10)
        self.assertIn('resume_state', native)

    def test_all_cases_continue_after_independent_failure_and_preserve_errors(self):
        plan = {**example_plan(), 'resume_state': {'version': 1}}
        failed = {'result': {'independent_valid': False, 'reached_lower_bound': False,
                            'error_code': 'native_duration_or_capacity'}, 'partitions': [[5, 5, 10, 10]]}
        passed = {'result': {'independent_valid': True, 'reached_lower_bound': True}, 'partitions': [[5, 5, 10, 10]]}
        report = {'cases': {}}
        with mock_patch.object(verification, 'synthetic_native_contract', return_value={}), \
             mock_patch.object(verification, 'native_baseline', side_effect=verification.VerificationError('test_baseline_failure')), \
             mock_patch.object(verification, 'observed_run', side_effect=[(plan, copy.deepcopy(failed)),
                 (plan, copy.deepcopy(passed)), (plan, copy.deepcopy(failed))]) as observed:
            verification.run_witness_cases(object(), self.diagnostics, report, {})
        self.assertEqual(observed.call_count, 3)
        self.assertEqual(set(report['cases']), {'plain', 'material_delivery', 'continue_fresh_namespace'})
        self.assertEqual(report['status'], 'native_minibatch_regression')
        self.assertEqual(report['cases']['plain']['result']['error_code'], 'native_duration_or_capacity')
        self.assertEqual(report['phase'], 'complete')

    def test_synthetic_summaries_exclude_foreign_values_and_ast_body_literals(self):
        model = verification.witness_model()
        model['orders'].append({'id': 'foreign-customer-value', 'quantity': 123456})
        model['equipment'][0]['description'] = 'private-equipment-description'
        plan = example_plan()
        plan['operations'].append({'order': 'foreign-customer-value', 'operation_id': 'WORK', 'start_min': 987654})
        report = {'model': verification.synthetic_model_summary(model), 'plan': verification.synthetic_schedule_summary(plan)}
        encoded = json.dumps(report)
        for secret in ('foreign-customer-value', 'private-equipment-description', '987654', '123456'):
            self.assertNotIn(secret, encoded)
        source = "def _pp_expand_capacity_batches(model, ids, locks):\n    cap = _pp_order_batch_capacity(model, current_order)\n    secret = 'private-source-value'\n    for index, size in enumerate(sizes):\n        pass\n    return model, ids, {}\n"
        summary = verification.expansion_ast_metadata(source)
        self.assertEqual(summary[0]['capacity_arguments'], [['model', 'current_order']])
        self.assertEqual(summary[0]['enumerate_arguments'], [['sizes']])
        self.assertNotIn('private-source-value', json.dumps(summary))


if __name__ == '__main__':
    unittest.main()
