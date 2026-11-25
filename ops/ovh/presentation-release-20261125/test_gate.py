"""Pure receipt/privacy gates; no SSH, Docker, native execution or private inputs."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import capture
import container_gate
import native_hashes
import verify
from container_gate import PRESENTATION_CHECKS, BUILD_CHAIN_CHECKS


class GateTests(unittest.TestCase):
    def receipt(self):
        return {'format': 'presentation-container-v1', 'all_checks_passed': True,
            'presentation_checks': dict.fromkeys(PRESENTATION_CHECKS, True),
            'build_chain_checks': dict.fromkeys(BUILD_CHAIN_CHECKS, True)}

    def test_actual_build_chain_and_each_presentation_check_are_required(self):
        verify.validate_container_report(self.receipt())
        for group, checks in [('presentation_checks', PRESENTATION_CHECKS), ('build_chain_checks', BUILD_CHAIN_CHECKS)]:
            for name in checks:
                value = self.receipt(); value[group][name] = False
                with self.subTest(group=group, name=name), self.assertRaises(ValueError):
                    verify.validate_container_report(value)
            value = self.receipt(); del value[group]
            with self.assertRaises(ValueError): verify.validate_container_report(value)
        value = self.receipt(); value['build_fixtures_updated'] = True
        with self.assertRaises(ValueError): verify.validate_container_report(value)

    def test_failure_receipt_cannot_export_private_logs_or_source(self):
        secret = 'PRIVATE_SOURCE_MUST_NOT_LEAVE'
        value = {'format': 'integrated-setup-build-chain-v1', **dict.fromkeys(BUILD_CHAIN_CHECKS, False),
            'original_inputs_unchanged': True, 'failure_phase': 'feature_stop', 'failure_code': 'feature_stop_failed',
            'source': secret, 'stderr': secret}
        with tempfile.TemporaryDirectory() as directory, patch.object(container_gate, 'OUT', Path(directory)):
            root = Path(directory)
            (root / 'build-chain-report.json').write_text(json.dumps(value))
            container_gate.failure_metadata('actual_build_chain')
            report = verify.safe_failure_report(root / 'failure-report.json')
            self.assertEqual(report['build_chain']['failure_phase'], 'feature_stop')
            self.assertNotIn(secret, json.dumps(report))
            path = root / 'failure-report.json'
            path.write_text(json.dumps({'gate': 'resource_synthetic', 'source': secret, 'message': secret}))
            self.assertEqual(verify.safe_failure_report(path), {'gate': 'resource_synthetic'})
        value['failure_phase'] = secret; value['failure_code'] = secret
        self.assertIsNone(container_gate.safe_build_chain(value)['failure_phase'])
        self.assertIsNone(container_gate.safe_build_chain(value)['failure_code'])

    def test_public_receipt_binds_frozen_build_dependencies_and_helpers_but_not_marker(self):
        hashes = verify.public_hashes()
        for name in [
            'ops/ovh/presentation-release-20261125/baseline.json',
            'ops/ovh/resource-presentation-20261125/resource-presentation.mjs',
            'ops/ovh/secondary-zoom-20261125/zoom.mjs',
            'ops/ovh/integrated-setup-release-20261125/verify-build-chain.mjs',
            'ops/ovh/integrated-setup-result-20261125/patch.mjs',
            'ops/ovh/integrated-setup-result-20261125/canonical.mjs',
            'ops/ovh/native-batching-verify-20261124/native_input_contract.py',
        ]:
            self.assertIn(name, hashes)
        self.assertNotIn('ops/ovh/presentation-release-20261125/release.json', hashes)

    def test_native_capture_program_exports_only_fixed_hash_fields(self):
        secret = 'CODE_INPUT_SENTINEL_NOT_FOR_CI'
        synthetic = ('def load_owned_inputs():\n'
            '    return {"synthetic_code": "' + secret + '"}, {"source_hashes": {"ga_workers/a.py": "' + 'a' * 64 + '"}}, {}\n')
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'contract.py'; source.write_text(synthetic)
            with patch.object(native_hashes, 'CONTRACT', source), patch.object(native_hashes, 'CONTRACT_SHA', hashlib.sha256(synthetic.encode()).hexdigest()):
                program = native_hashes.public_program()
            output = io.StringIO()
            with contextlib.redirect_stdout(output): exec(program, {})
            value = json.loads(output.getvalue())
            self.assertEqual(set(value), {'format', 'worker_hashes', 'code_inputs_sha256'})
            self.assertNotIn(secret, output.getvalue())
            self.assertEqual(value['worker_hashes'], {'ga_workers/a.py': 'a' * 64})
            with patch.object(native_hashes, 'CONTRACT', source), self.assertRaises(ValueError):
                native_hashes.public_program()

    def test_native_hash_receiver_rejects_private_extra_fields_and_invalid_hashes(self):
        baseline = json.loads((HERE / 'baseline.json').read_bytes())
        value = {'format': 'presentation-native-hashes-v1', 'worker_hashes': baseline['worker_hashes'],
            'code_inputs_sha256': baseline['code_inputs_sha256']}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'hashes.json'; path.write_text(json.dumps(value))
            self.assertEqual(capture.read_native_hashes(path), value)
            value['source'] = 'PRIVATE_SENTINEL'; path.write_text(json.dumps(value))
            with self.assertRaises(capture.CaptureError): capture.read_native_hashes(path)
            del value['source']; value['code_inputs_sha256'] = 'not-a-hash'; path.write_text(json.dumps(value))
            with self.assertRaises(capture.CaptureError): capture.read_native_hashes(path)


if __name__ == '__main__':
    unittest.main()
