"""Release rejection and rollback checks using public hashes and local stub services."""
import copy
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import capture
import deploy_contract
import release_guard as guard
from container_gate import APP_CHECKS, WORKER_CHECKS


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


class ReleaseTests(unittest.TestCase):
    def report(self, fixtures=False):
        baseline = guard.baseline()
        before = {name: baseline['app_hashes'].get(name, digest('original-' + name)) for name in capture.APP_FILES}
        changed = set(capture.WRITE_FILES) | (set(capture.BUILD_TEST_FILES) if fixtures else set())
        return {'format': 'integrated-setup-acceptance-v1', 'status': 'integrated_setup_pass',
            'release_gate_complete': True, 'production_writes': False,
            'native_eleven_verified': True, 'native_case_count': 11,
            'app_before': before, 'app_after': {name: digest('accepted-' + name) if name in changed else sha for name, sha in before.items()},
            'protected_hashes': baseline['protected_hashes'], 'worker_hashes': baseline['worker_hashes'],
            'code_inputs_sha256': baseline['code_inputs_sha256'], 'runtime_image': 'sha256:' + 'c' * 64,
            'public_sources': guard.public_hashes(), 'legacy_build_before_passed': not fixtures,
            'legacy_build_after_passed': True, 'build_fixtures_updated': fixtures,
            'worker_checks': dict.fromkeys(WORKER_CHECKS, True), 'app_checks': dict.fromkeys(APP_CHECKS, True)}

    def marker(self, fixtures=False):
        report = self.report(fixtures)
        return guard.marker_from_report(report, 'a' * 40, 12345), report

    def test_acceptance_requires_native_eleven_actual_app_and_build_success(self):
        marker, report = self.marker()
        guard.validate_report(marker, report)
        for key, value in [('status', 'capture_only'), ('release_gate_complete', False),
                           ('production_writes', True), ('native_eleven_verified', False),
                           ('native_case_count', 4), ('native_case_count', True),
                           ('legacy_build_after_passed', False)]:
            wrong = copy.deepcopy(report); wrong[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                guard.validate_report(marker, wrong)
        for group, names in [('worker_checks', WORKER_CHECKS), ('app_checks', APP_CHECKS)]:
            for name in names:
                wrong = copy.deepcopy(report); wrong[group][name] = False
                with self.subTest(group=group, name=name), self.assertRaises(ValueError):
                    guard.validate_report(marker, wrong)

    def test_marker_allows_only_three_runtime_files_or_required_two_fixtures(self):
        for fixtures in (False, True):
            marker, report = self.marker(fixtures)
            guard.validate_marker(marker)
            wrong = copy.deepcopy(marker)
            wrong['app_after']['ga-python-state-store.mjs'] = digest('unexpected-runtime-change')
            with self.assertRaises(ValueError): guard.validate_marker(wrong)
        marker, _ = self.marker(True)
        marker['app_after'][capture.BUILD_TEST_FILES[0]] = marker['app_before'][capture.BUILD_TEST_FILES[0]]
        with self.assertRaises(ValueError): guard.validate_marker(marker)
        marker, _ = self.marker(False)
        marker['build_fixtures_updated'] = True
        with self.assertRaises(ValueError): guard.validate_marker(marker)

    def test_marker_rejects_native_auth_baseline_and_public_tool_drift(self):
        marker, _ = self.marker()
        for key in ('worker_hashes', 'protected_hashes', 'public_sources', 'app_before'):
            wrong = copy.deepcopy(marker)
            name = next(iter(wrong[key])); wrong[key][name] = digest('changed-source')
            with self.subTest(key=key), self.assertRaises(ValueError): guard.validate_marker(wrong)
        wrong = copy.deepcopy(marker); wrong['code_inputs_sha256'] = digest('changed-native-core')
        with self.assertRaises(ValueError): guard.validate_marker(wrong)

    def test_receipt_and_workflow_are_bound_to_one_successful_exact_candidate(self):
        marker, report = self.marker()
        line = b'2026-11-25T10:20:30.000Z INTEGRATED_SETUP_VERIFICATION ' + json.dumps(report).encode() + b'\n'
        self.assertEqual(guard.report_from_log(line), report)
        for log in (line + line, b'no receipt\n', b'x' * (8 * 1024 * 1024 + 1)):
            with self.assertRaises(ValueError): guard.report_from_log(log)
        run = {'id': 12345, 'status': 'completed', 'conclusion': 'success', 'head_sha': 'a' * 40,
               'head_branch': guard.BRANCH, 'path': guard.WORKFLOW, 'repository': {'full_name': guard.REPOSITORY}}
        guard.validate_run(marker, run)
        for key, value in [('head_sha', 'b' * 40), ('head_branch', 'main'), ('conclusion', 'failure'),
                           ('status', 'in_progress'), ('path', 'another-workflow.yml'), ('id', 456)]:
            wrong = copy.deepcopy(run); wrong[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): guard.validate_run(marker, wrong)

    def test_host_manifest_never_permits_worker_or_auth_writes_or_partial_fixture_update(self):
        marker, _ = self.marker(True)
        rows = [('WRITE' if marker['app_before'][name] != marker['app_after'][name] else 'PRESERVE',
                 'app/' + name, marker['app_before'][name], marker['app_after'][name]) for name in capture.APP_FILES]
        rows += [('PRESERVE', 'app/' + name, sha, sha) for name, sha in marker['protected_hashes'].items()]
        rows += [('PRESERVE', 'ga/' + name.removeprefix('ga_workers/'), sha, sha) for name, sha in marker['worker_hashes'].items()]
        encode = lambda entries: ''.join('\t'.join(row) + '\n' for row in entries).encode()
        self.assertEqual(deploy_contract.manifest_rows(encode(rows)), [list(row) for row in rows])
        for target in ('app/auth-runtime.js', 'ga/full_runtime_adapter.py', 'app/tests/python-ga-state.test.mjs'):
            altered = [(('PRESERVE' if role == 'WRITE' else 'WRITE'), name, old, old if role == 'WRITE' else digest('wrong'))
                       if name == target else (role, name, old, new) for role, name, old, new in rows]
            with self.subTest(target=target), self.assertRaises(ValueError): deploy_contract.manifest_rows(encode(altered))
        with self.assertRaises(ValueError): deploy_contract.manifest_rows(encode(rows + [rows[0]]))

    def test_rollback_retries_startup_health_and_preserves_original_failure(self):
        script = (HERE / 'release.sh').read_text()
        functions = '\n'.join(re.search(r'^' + name + r'\(\)\{\n.*?^\}', script, re.M | re.S).group(0)
                              for name in ('wait_for_service_smoke', 'rollback'))
        for restore_fails, healthy_after in ((False, 3), (False, 100), (True, 3)):
            with self.subTest(restore_fails=restore_fails, healthy_after=healthy_after), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); (root / 'backup/app').mkdir(parents=True)
                (root / 'backup/app/python-ga-upstream.mjs').write_text('old')
                (root / 'current.mjs').write_text('new')
                (root / 'manifest.tsv').write_text('WRITE\tapp/python-ga-upstream.mjs\told\tnew\n')
                program = '''set -euo pipefail
root="$1"; backup="$root/backup"; manifest="$root/manifest.tsv"
deployment_phase=update_services
smoke_attempts=0; healthy_after="$2"; restore_fails="$3"
write_target(){ printf '%s/current.mjs' "$root"; }
verify_sources(){ test "$(cat "$root/current.mjs")" = old; }
sleep(){ :; }
cp(){ if test "$restore_fails" = true; then return 7; fi; command cp "$@"; }
sudo(){
  case "${3-}" in
    update) printf update > "$root/update-called"; return 0;;
    smoke) smoke_attempts=$((smoke_attempts + 1)); test "$smoke_attempts" -ge "$healthy_after";;
    *) return 9;;
  esac
}
''' + functions + '\nrollback 23\n'
                result = subprocess.run(['bash', '-s', '--', directory, str(healthy_after), str(restore_fails).lower()],
                                        input=program, text=True, capture_output=True, timeout=5)
                self.assertEqual(result.returncode, 23, result.stderr)
                if restore_fails:
                    self.assertFalse((root / 'update-called').exists())
                    self.assertIn('ROLLBACK_RESTORE_EXIT 1', result.stdout)
                else:
                    self.assertEqual((root / 'current.mjs').read_text(), 'old')
                    self.assertTrue((root / 'update-called').exists())
                    label = 'ROLLBACK_HEALTH_PASS' if healthy_after <= 36 else 'ROLLBACK_HEALTH_UNCONFIRMED'
                    self.assertIn(label, result.stdout)


if __name__ == '__main__':
    unittest.main()
