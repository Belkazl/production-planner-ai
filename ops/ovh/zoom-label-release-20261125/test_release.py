"""Exact receipt, single UI write allowlist and rollback tests with local stubs."""
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
from container_gate import ZOOM_LABEL_CHECKS, BUILD_CHAIN_CHECKS


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


class ReleaseTests(unittest.TestCase):
    def report(self):
        baseline = guard.baseline()
        before = baseline['app_hashes']
        return {'format': 'zoom-label-acceptance-v1', 'status': 'zoom_label_pass',
            'release_gate_complete': True, 'production_writes': False, 'app_before': before,
            'app_after': {name: digest('accepted-ui-append') if name in capture.WRITE_FILES else sha for name, sha in before.items()},
            'protected_hashes': baseline['protected_hashes'], 'worker_hashes': baseline['worker_hashes'],
            'code_inputs_sha256': baseline['code_inputs_sha256'], 'runtime_image': 'sha256:' + 'c' * 64,
            'public_sources': guard.public_hashes(), 'zoom_label_checks': dict.fromkeys(ZOOM_LABEL_CHECKS, True),
            'build_chain_checks': dict.fromkeys(BUILD_CHAIN_CHECKS, True)}

    def marker(self):
        report = self.report()
        return guard.marker_from_report(report, 'a' * 40, 12345), report

    def test_acceptance_requires_exact_presentation_and_build_gates(self):
        marker, report = self.marker()
        guard.validate_report(marker, report)
        for key, value in [('status', 'capture_only'), ('release_gate_complete', False), ('production_writes', True)]:
            wrong = copy.deepcopy(report); wrong[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): guard.validate_report(marker, wrong)
        for group, checks in [('zoom_label_checks', ZOOM_LABEL_CHECKS), ('build_chain_checks', BUILD_CHAIN_CHECKS)]:
            for name in checks:
                wrong = copy.deepcopy(report); wrong[group][name] = False
                with self.subTest(group=group, name=name), self.assertRaises(ValueError): guard.validate_report(marker, wrong)

    def test_marker_allows_exactly_one_ui_file_and_no_fixture_or_optimizer_change(self):
        self.assertEqual(capture.WRITE_FILES, ('restart-optimizer-ui.js',))
        marker, _ = self.marker()
        guard.validate_marker(marker)
        for name in capture.APP_FILES:
            wrong = copy.deepcopy(marker)
            wrong['app_after'][name] = marker['app_before'][name] if name in capture.WRITE_FILES else digest('unexpected-change')
            with self.subTest(name=name), self.assertRaises(ValueError): guard.validate_marker(wrong)

    def test_marker_rejects_native_auth_baseline_and_public_helper_drift(self):
        marker, _ = self.marker()
        for key in ('worker_hashes', 'protected_hashes', 'public_sources', 'app_before'):
            wrong = copy.deepcopy(marker); name = next(iter(wrong[key])); wrong[key][name] = digest('changed')
            with self.subTest(key=key), self.assertRaises(ValueError): guard.validate_marker(wrong)
        wrong = copy.deepcopy(marker); wrong['code_inputs_sha256'] = digest('changed-native')
        with self.assertRaises(ValueError): guard.validate_marker(wrong)

    def test_receipt_and_run_are_bound_to_one_successful_exact_candidate(self):
        marker, report = self.marker()
        line = b'2026-11-25T10:20:30.000Z ZOOM_LABEL_RELEASE_VERIFICATION ' + json.dumps(report).encode() + b'\n'
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

    def test_remote_manifest_rejects_every_additional_write(self):
        marker, _ = self.marker()
        rows = [('WRITE' if name in capture.WRITE_FILES else 'PRESERVE', 'app/' + name,
            marker['app_before'][name], marker['app_after'][name]) for name in capture.APP_FILES]
        rows += [('PRESERVE', 'app/' + name, sha, sha) for name, sha in marker['protected_hashes'].items()]
        rows += [('PRESERVE', 'ga/' + name.removeprefix('ga_workers/'), sha, sha) for name, sha in marker['worker_hashes'].items()]
        encode = lambda entries: ''.join('\t'.join(row) + '\n' for row in entries).encode()
        self.assertEqual(deploy_contract.manifest_rows(encode(rows)), [list(row) for row in rows])
        for target in [row[1] for row in rows]:
            altered = [(('PRESERVE' if role == 'WRITE' else 'WRITE'), name, old, old if role == 'WRITE' else digest('wrong'))
                if name == target else (role, name, old, new) for role, name, old, new in rows]
            with self.subTest(target=target), self.assertRaises(ValueError): deploy_contract.manifest_rows(encode(altered))
        with self.assertRaises(ValueError): deploy_contract.manifest_rows(encode(rows + [rows[0]]))

    def test_release_uses_ordinary_ssh_and_only_existing_smoke_update_helper_operations(self):
        script = (HERE / 'release.sh').read_text()
        privileged = re.findall(r'^.*sudo.*$', script, re.M)
        self.assertTrue(privileged)
        self.assertTrue(all(re.search(r'sudo -n /usr/local/sbin/liftorbit-ops (?:smoke|update)\b', line) for line in privileged))
        self.assertNotIn('sudo docker', script)
        self.assertNotIn('systemctl', script)
        self.assertIn('test "$DEPLOY_USER" = liftorbit-ci', script)
        self.assertIn('python3 -B -I "$package/release_guard.py" --marker "$marker"', script)
        self.assertNotIn('app/python-ga-upstream.mjs|', script)

    def test_rollback_restores_ui_retries_health_and_preserves_failure_exit(self):
        script = (HERE / 'release.sh').read_text()
        functions = '\n'.join(re.search(r'^' + name + r'\(\)\{\n.*?^\}', script, re.M | re.S).group(0)
            for name in ('wait_for_service_smoke', 'rollback'))
        for restore_fails, healthy_after in ((False, 3), (False, 100), (True, 3)):
            with self.subTest(restore_fails=restore_fails, healthy_after=healthy_after), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); (root / 'backup/app').mkdir(parents=True)
                (root / 'backup/app/restart-optimizer-ui.js').write_text('old')
                (root / 'current.js').write_text('new')
                (root / 'manifest.tsv').write_text('WRITE\tapp/restart-optimizer-ui.js\told\tnew\n')
                program = '''set -euo pipefail
root="$1"; backup="$root/backup"; manifest="$root/manifest.tsv"
deployment_phase=update_services
smoke_attempts=0; healthy_after="$2"; restore_fails="$3"
write_target(){ printf '%s/current.js' "$root"; }
verify_sources(){ test "$(cat "$root/current.js")" = old; }
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
                    self.assertEqual((root / 'current.js').read_text(), 'old')
                    self.assertTrue((root / 'update-called').exists())
                    self.assertIn('ROLLBACK_HEALTH_PASS' if healthy_after <= 36 else 'ROLLBACK_HEALTH_UNCONFIRMED', result.stdout)


if __name__ == '__main__':
    unittest.main()
