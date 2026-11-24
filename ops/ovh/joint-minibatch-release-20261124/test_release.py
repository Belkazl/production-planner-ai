"""Pure release guards: no SSH, API, native engine or deployment execution."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import urllib.request

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import release_guard as guard
import stage


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def marker():
    names = ('__init__.py', 'compile_legacy_ga.py', 'full_runtime_adapter.py',
             'continuation.py', 'constraints.py', 'operation_interleave.py', 'batch_size_diagnostics.py')
    before = {'ga_workers/' + name: digest('original ' + name) for name in names}
    after = dict(before)
    after.update({'ga_workers/' + name: digest('updated ' + name)
                  for name in ('full_runtime_adapter.py', 'joint_minibatch.py', 'joint_continuation.py')})
    return {'schema': 1, 'candidate_commit': '1' * 40, 'verification_run_id': 123,
            'code_inputs_sha256': '2' * 64, 'package_before': before, 'package_after': after,
            'public_sources': {name: digest(name) for name in guard.PUBLIC_PATHS}}


def successful_run(value):
    return {'id': value['verification_run_id'], 'status': 'completed', 'conclusion': 'success',
            'head_sha': value['candidate_commit'], 'head_branch': guard.BRANCH,
            'path': guard.VERIFY_WORKFLOW, 'repository': {'full_name': guard.REPOSITORY}}


def accepted_report(value):
    return {'format': 'native-minibatch-verification-v1', 'status': 'native_witness_pass',
            'release_gate_complete': True, 'ordered_continuation_verified': True,
            'provenance': {'source_hashes': copy.deepcopy(value['package_before']),
                'candidate_source_hashes': copy.deepcopy(value['package_after']),
                'code_inputs_sha256': value['code_inputs_sha256'], 'native_code_changed': True,
                'production_writes': False, 'overlay': {
                    'format': 'reviewed-public-native-overlay-v1',
                    'public_helper_hashes': {name.removeprefix('ops/ovh/'): value['public_sources'][name]
                                            for name in guard.OVERLAY_PUBLIC_PATHS},
                    'changed_package_files': sorted(guard.CHANGED_PACKAGE)}}}


class ReleaseGuardTests(unittest.TestCase):
    def test_exact_marker_and_full_acceptance_match(self):
        value = marker()
        self.assertIs(guard.validate_marker(value), value)
        guard.validate_run(value, successful_run(value))
        guard.validate_report(value, accepted_report(value))

    def test_unrelated_worker_changes_deletions_and_additions_are_rejected(self):
        for name, action in (
            ('ga_workers/compile_legacy_ga.py', 'change'),
            ('ga_workers/operation_interleave.py', 'change'),
            ('ga_workers/constraints.py', 'remove'),
            ('ga_workers/unreviewed.py', 'add'),
            ('ga_workers/joint_continuation.py', 'remove'),
        ):
            value = marker()
            if action == 'remove':
                del value['package_after'][name]
            else:
                value['package_after'][name] = 'f' * 64
            with self.subTest(name=name), self.assertRaises(ValueError):
                guard.validate_marker(value)

    def test_marker_cannot_add_unknown_inputs_or_omit_public_dependency(self):
        mutations = [lambda value: value.update(extra=True),
                     lambda value: value.update(candidate_commit='main'),
                     lambda value: value.update(verification_run_id=True),
                     lambda value: value.update(code_inputs_sha256='invalid'),
                     lambda value: value['public_sources'].pop(guard.PUBLIC_PATHS[0]),
                     lambda value: value['package_after'].update({'ga_workers/../escape.py': 'f' * 64})]
        for change in mutations:
            value = marker(); change(value)
            with self.assertRaises(ValueError):
                guard.validate_marker(value)

    def test_workflow_run_must_be_successful_same_commit_branch_and_repository(self):
        value = marker()
        for key, other in [('status', 'in_progress'), ('conclusion', 'failure'), ('head_sha', '3' * 40),
                           ('head_branch', 'main'), ('path', '.github/workflows/other.yml'),
                           ('id', 456), ('repository', {'full_name': 'different/repository'})]:
            run = successful_run(value); run[key] = other
            with self.subTest(key=key), self.assertRaises(ValueError):
                guard.validate_run(value, run)

    def test_successful_diagnostic_or_incomplete_overlay_cannot_release(self):
        value = marker()
        for key, other in [('release_gate_complete', False), ('ordered_continuation_verified', False),
                           ('status', 'native_minibatch_regression'), ('format', 'other')]:
            report = accepted_report(value); report[key] = other
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'acceptance_incomplete'):
                guard.validate_report(value, report)

    def test_acceptance_is_bound_to_original_input_exact_patch_and_public_helpers(self):
        value = marker()
        mutations = [lambda p: p['source_hashes'].update({'ga_workers/constraints.py': '0' * 64}),
                     lambda p: p['candidate_source_hashes'].update({'ga_workers/joint_minibatch.py': '0' * 64}),
                     lambda p: p.update(code_inputs_sha256='0' * 64),
                     lambda p: p.update(native_code_changed=False),
                     lambda p: p.update(production_writes=True),
                     lambda p: p['overlay']['public_helper_hashes'].update({guard.OVERLAY_PUBLIC_PATHS[0].removeprefix('ops/ovh/'): '0' * 64}),
                     lambda p: p['overlay'].update(changed_package_files=['ga_workers/full_runtime_adapter.py'])]
        for change in mutations:
            report = accepted_report(value); change(report['provenance'])
            with self.assertRaises(ValueError):
                guard.validate_report(value, report)

    def test_actual_harness_schema_uses_exact_relative_ovh_paths_without_aliases(self):
        # These five keys are the actual successful native report's schema.
        paths = {'joint-minibatch-release-20261124/prepare_overlay.py',
                 'joint-minibatch-search-20261124/patch.py',
                 'joint-minibatch-search-20261124/joint_minibatch.py',
                 'native-batching-continuation-20261124/patch_worker.py',
                 'native-batching-continuation-20261124/joint_continuation.py'}
        value = marker(); report = accepted_report(value)
        self.assertEqual(set(report['provenance']['overlay']['public_helper_hashes']), paths)
        guard.validate_report(value, report)
        for prefix in ('ops/ovh/', './', '../ovh/'):
            invalid = copy.deepcopy(report)
            mapping = invalid['provenance']['overlay']['public_helper_hashes']
            original = 'joint-minibatch-search-20261124/patch.py'
            mapping[prefix + original] = mapping.pop(original)
            with self.assertRaisesRegex(ValueError, 'acceptance_overlay'):
                guard.validate_report(value, invalid)

    def test_log_parser_accepts_one_actual_report_not_echoed_shell_source(self):
        expected = accepted_report(marker())
        line = 'NATIVE_BATCHING_VERIFICATION ' + json.dumps(expected)
        data = ('2026-11-24T18:30:10.100Z echo "NATIVE_BATCHING_VERIFICATION ignored"\n'
                + '2026-11-24T18:30:10.200Z ' + line + '\n').encode()
        self.assertEqual(guard.report_from_job_log(data), expected)
        for invalid in (b'no report', (line + '\n' + line).encode(), b'x' * (8 * 1024 * 1024 + 1)):
            with self.assertRaises(ValueError):
                guard.report_from_job_log(invalid)

    def test_actions_blob_redirect_never_forwards_github_authorization(self):
        original = urllib.request.Request('https://api.github.com/repos/example/repo/actions/jobs/1/logs',
                                          headers={'Authorization': 'Bearer synthetic-token', 'Accept': 'text/plain'})
        handler = guard.SafeRedirect()
        redirected = handler.redirect_request(original, None, 302, 'Found', {},
                                              'https://productionresultssa1.blob.core.windows.net/synthetic-log')
        self.assertIsNone(redirected.get_header('Authorization'))
        self.assertEqual(original.get_header('Authorization'), 'Bearer synthetic-token')
        with self.assertRaisesRegex(ValueError, 'insecure_redirect'):
            handler.redirect_request(original, None, 302, 'Found', {}, 'http://example.invalid/log')


class StageTests(unittest.TestCase):
    def fixture(self, root):
        value = marker()
        for side, package in [('native', 'package_before'), ('new', 'package_after')]:
            target = root / side / 'ga_workers'; target.mkdir(parents=True)
            for name in value[package]:
                short = name.split('/')[1]
                content = ('updated ' if package == 'package_after' and name in guard.CHANGED_PACKAGE else 'original ') + short
                (target / short).write_text(content)
                value[package][name] = digest(content)
        for side in ('old', 'new'):
            app = root / side / 'app'; app.mkdir(parents=True)
            for name in ('auth-runtime.js', 'python-ga-upstream.mjs', 'python-ga-upstream-build.ts', 'restart-optimizer-ui.js'):
                (app / name).write_text('public fixture ' + name)
        (root / 'new/app/python-ga-upstream.mjs').write_text('public fixture patched bridge')
        (root / 'new/app/restart-optimizer-ui.js').write_text('public fixture selected plan bridge')
        return value

    def test_deploy_manifest_changes_exactly_five_files_and_preserves_auth_ui(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); value = self.fixture(root)
            stage.make_manifest(value, root)
            rows = [line.split('\t') for line in (root / 'manifest.tsv').read_text().splitlines()]
            self.assertEqual({name for role, name, _, _ in rows if role == 'WRITE'},
                             {'app/python-ga-upstream.mjs', 'app/restart-optimizer-ui.js', 'ga/full_runtime_adapter.py',
                              'ga/joint_minibatch.py', 'ga/joint_continuation.py'})
            protected = {name: (old, new) for role, name, old, new in rows if role == 'PRESERVE'}
            self.assertEqual(protected['app/auth-runtime.js'][0], protected['app/auth-runtime.js'][1])
            self.assertIn('ga/operation_interleave.py', protected)

    def test_ui_or_native_input_drift_rejects_the_staged_release(self):
        for filename in ('new/app/auth-runtime.js', 'native/ga_workers/constraints.py'):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory); value = self.fixture(root)
                (root / filename).write_text('unexpected mutation')
                with self.assertRaises(ValueError):
                    stage.make_manifest(value, root)
                self.assertFalse((root / 'manifest.tsv').exists())


class RollbackHealthTests(unittest.TestCase):
    def function(self, name):
        # Extract only the reviewed shell functions. Never execute release.sh or
        # its SSH/update path; sudo and sleep below are local in-memory stubs.
        source = (HERE / 'release.sh').read_text()
        begin = source.index(name + '(){\n')
        end = source.index('\n}', begin) + 2
        return source[begin:end]

    def test_service_startup_wait_is_bounded_and_returns_real_health(self):
        for ready_after, code, calls, pauses in ((3, 0, 3, 2), (999, 1, 36, 35)):
            script = '''set -euo pipefail
calls=0; pauses=0
sudo(){ calls=$((calls+1)); test "$calls" -ge READY_AFTER; }
sleep(){ test "$1" = 5; pauses=$((pauses+1)); }
'''.replace('READY_AFTER', str(ready_after)) + self.function('wait_for_service_smoke') + '''
if wait_for_service_smoke; then code=0; else code=$?; fi
printf '%s %s %s\\n' "$code" "$calls" "$pauses"
'''
            result = subprocess.run(['bash', '-c', script], capture_output=True, text=True,
                                    env={'PATH': '/usr/bin:/bin'}, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), f'{code} {calls} {pauses}')

    def test_rollback_startup_grace_preserves_original_release_failure(self):
        for ready_after, health, calls, pauses in ((3, 'PASS', 3, 2), (999, 'UNCONFIRMED', 36, 35)):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / 'manifest.tsv').write_text('')
                script = '''set -euo pipefail
backup="$1"; manifest="$backup/manifest.tsv"; deployment_phase=update_services
calls=0; pauses=0
sudo(){
  if test "$3" = update; then return 0; fi
  if test "$3" != smoke; then return 97; fi
  calls=$((calls+1)); test "$calls" -ge READY_AFTER
}
sleep(){ test "$1" = 5; pauses=$((pauses+1)); }
trap 'printf "LOCAL_SMOKE_COUNTS %s %s\\n" "$calls" "$pauses"' EXIT
'''.replace('READY_AFTER', str(ready_after))
                script += self.function('wait_for_service_smoke') + '\n' + self.function('rollback') + '\nrollback 23\n'
                result = subprocess.run(['bash', '-c', script, 'bash', directory],
                                        capture_output=True, text=True, env={'PATH': '/usr/bin:/bin'}, timeout=5)
                self.assertEqual(result.returncode, 23, result.stderr)
                self.assertIn('JOINT_RELEASE_ROLLBACK_HEALTH_' + health, result.stdout)
                self.assertIn(f'LOCAL_SMOKE_COUNTS {calls} {pauses}', result.stdout)


if __name__ == '__main__':
    unittest.main()
