"""Pure receipt/privacy regressions; no private native execution or Docker."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import verify
from diagnostics import summarize_report, public_error_codes, public_source_labels, safe_anchor_counts
from container_gate import APP_CHECKS, WORKER_CHECKS


class GateTests(unittest.TestCase):
    def receipt(self):
        return {'format': 'integrated-setup-container-v1', 'all_checks_passed': True,
                'native_eleven_verified': True, 'native_case_count': 11,
                'legacy_build_before_passed': False, 'legacy_build_after_passed': True, 'build_fixtures_updated': True,
                'worker_checks': dict.fromkeys(WORKER_CHECKS, True), 'app_checks': dict.fromkeys(APP_CHECKS, True)}

    def test_new_cases_cannot_replace_the_eleven_existing_native_cases(self):
        verify.validate_container_report(self.receipt())
        for key, value in (('native_eleven_verified', False), ('native_case_count', 4), ('native_case_count', True)):
            report = self.receipt(); report[key] = value
            with self.assertRaises(ValueError):
                verify.validate_container_report(report)
        report = self.receipt(); report['app_checks']['scoped_stop_isolated'] = False
        with self.assertRaises(ValueError):
            verify.validate_container_report(report)
        report = self.receipt(); report['legacy_build_after_passed'] = False
        with self.assertRaises(ValueError):
            verify.validate_container_report(report)

    def test_safe_trace_metadata_drops_arbitrary_names_and_messages(self):
        secret = 'SENSITIVE_SOURCE_SENTINEL'
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'failure.json'
            path.write_text(json.dumps({'gate': 'canonical_patch', 'message': secret,
                'exception_classes': ['TypeError', secret], 'public_frames': [
                    {'file': 'patch.mjs', 'line': 12, 'source': secret},
                    {'file': secret + '.py', 'line': 99}]}))
            report = verify.safe_failure_report(path)
            self.assertEqual(report['exception_classes'], ['TypeError'])
            self.assertEqual(report['public_frames'], [{'file': 'patch.mjs', 'line': 12}])
            self.assertNotIn(secret, json.dumps(report))

    def test_synthetic_case_evidence_only_emits_fixed_labels_and_bounded_aggregates(self):
        secret = 'SENSITIVE_NATIVE_SENTINEL'
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'worker-report.json'
            path.write_text(json.dumps({'cases': {'setup_sequence': {'valid': False, 'phase': 'native_case',
                'error_type': 'CheckError', 'error_code': 'makespan_metric', 'error': secret,
                'duration_minutes': 45, 'operations': [{'order': secret}],
                'score_durations': [45, 60, secret, 10**15], 'cause_types': ['ValueError', secret]},
                secret: {'valid': False}}, 'source': secret}))
            report = summarize_report(path, HERE.parent)
            self.assertNotIn(secret, json.dumps(report))
            case = report['cases']['setup_sequence']
            self.assertEqual(case['error_code'], 'makespan_metric')
            self.assertEqual(case['score_durations'], [45, 60])
            self.assertNotIn('operations', case)

    def test_public_provenance_binds_baseline_but_not_release_marker(self):
        hashes = verify.public_hashes()
        self.assertIn('ops/ovh/integrated-setup-release-20261125/baseline.json', hashes)
        self.assertNotIn('ops/ovh/integrated-setup-release-20261125/release.json', hashes)

    def test_source_labels_are_explicit_public_literals_and_counts_drop_private_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            module = root / 'integrated-setup-result-20261125/patch.mjs'
            module.parent.mkdir()
            module.write_text("export const INTEGRATED_SETUP_SOURCE_LABELS = Object.freeze(['upstream_public_checkpoint','aps_native_post']);")
            self.assertEqual(public_source_labels(root), {'upstream_public_checkpoint', 'aps_native_post'})
            self.assertIn('INTEGRATED_SETUP_SOURCE_DRIFT_upstream_public_checkpoint', public_error_codes(root))
            rows = safe_anchor_counts([
                {'label': 'upstream_public_checkpoint', 'expected': 1, 'count': 0, 'source': 'PRIVATE_SENTINEL'},
                {'label': 'PRIVATE_SENTINEL', 'expected': 1, 'count': 0},
                {'label': 'aps_native_post', 'expected': True, 'count': 1},
                {'label': 'aps_native_post', 'expected': 1, 'count': 100001},
            ], root)
            self.assertEqual(rows, [{'label': 'upstream_public_checkpoint', 'expected': 1, 'count': 0}])
            self.assertNotIn('PRIVATE_SENTINEL', json.dumps(rows))
            self.assertEqual(safe_anchor_counts(rows * 27, root), [])
            module.write_text("export const INTEGRATED_SETUP_SOURCE_LABELS = Object.freeze(['upstream_public_checkpoint', ...PRIVATE_VARIABLE]);")
            self.assertEqual(public_source_labels(root), set())


if __name__ == '__main__':
    unittest.main()
