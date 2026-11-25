import contextlib
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import contract
import deploy_contract
import native_hashes
import stage

BEFORE = '08a3fd9d556fecb726c69ce7632851c2117f0e753c16edac183361e632afe253'
AFTER = '9ddfde67f8ebf723c401d3849b0bf88004ebb6c8a6b537dbd157e7dc6920a6f5'


def fixture():
    workers = {f'ga_workers/{name}.py': '1' * 64 for name in
               ('__init__', 'full_runtime_adapter', 'joint_continuation', 'constraints')}
    workers.update({contract.TARGET: BEFORE, 'ga_workers/compile_legacy_ga.py': contract.COMPILE_SHA})
    marker = {'app_hashes': dict.fromkeys(contract.APP_FILES, '2' * 64),
        'protected_hashes': dict.fromkeys(contract.PROTECTED_FILES, '3' * 64),
        'worker_before': workers, 'worker_after': dict(workers, **{contract.TARGET: AFTER}),
        'code_inputs_sha256': '4' * 64}
    app = {'format': 'shift-aware-minibatch-app-hashes-v1',
        'app_hashes': copy.deepcopy(marker['app_hashes']),
        'protected_hashes': copy.deepcopy(marker['protected_hashes'])}
    native = {'format': 'shift-aware-native-hashes-v1',
        'worker_hashes': dict(workers), 'code_inputs_sha256': marker['code_inputs_sha256']}
    return marker, app, native


def write_inputs(root, app, native):
    (root / 'app-hashes.json').write_text(json.dumps(app))
    (root / 'native-hashes.json').write_text(json.dumps(native))


class StageTests(unittest.TestCase):
    def test_public_sources_reproduce_exact_deployed_base_and_candidate(self):
        marker, _, _ = fixture()
        candidate, after = stage.public_artifact(marker['worker_before'])
        self.assertEqual(hashlib.sha256(candidate).hexdigest(), AFTER)
        self.assertEqual(after, marker['worker_after'])
        wrong = dict(marker['worker_before'], **{contract.TARGET: '9' * 64})
        with self.assertRaisesRegex(ValueError, 'stage_public_base_mismatch'):
            stage.public_artifact(wrong)

    def test_hash_only_stage_preserves_manifest_and_needs_no_private_bundle(self):
        marker, app, native = fixture()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_inputs(root, app, native)
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                stage.stage(marker, root)
            target = root / 'new/ga/joint_minibatch.py'
            self.assertEqual(hashlib.sha256(target.read_bytes()).hexdigest(), AFTER)
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            rows = deploy_contract.manifest_rows((root / 'manifest.tsv').read_bytes())
            self.assertEqual([row for row in rows if row[0] == 'WRITE'],
                             [['WRITE', 'ga/joint_minibatch.py', BEFORE, AFTER]])
            self.assertEqual((root / 'code-inputs.sha256').read_text(), marker['code_inputs_sha256'] + '\n')
            self.assertEqual((root / 'native-contract.sha256').read_text(), native_hashes.CONTRACT_SHA + '\n')
            self.assertEqual({path.relative_to(root).as_posix() for path in root.rglob('*') if path.is_file()},
                {'app-hashes.json', 'native-hashes.json', 'manifest.tsv', 'code-inputs.sha256',
                 'native-contract.sha256', 'new/ga/joint_minibatch.py'})
            self.assertEqual(output.getvalue(), 'SHIFT_AWARE_EXACT_ARTIFACT_VERIFIED writes=1\n')

    def test_stage_refuses_live_app_auth_worker_or_selected_input_drift(self):
        for field, key in (('app_hashes', 'restart-optimizer-ui.js'), ('protected_hashes', 'auth-runtime.js'),
                           ('worker_hashes', 'ga_workers/full_runtime_adapter.py'), ('code_inputs_sha256', None)):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as directory:
                marker, app, native = fixture()
                value = app if field in app else native
                if key is None:
                    value[field] = '9' * 64
                else:
                    value[field][key] = '9' * 64
                root = Path(directory)
                write_inputs(root, app, native)
                with self.assertRaisesRegex(ValueError, 'stage_original_hashes'):
                    stage.stage(marker, root)
                self.assertFalse((root / 'new').exists())

    def test_stage_refuses_any_difference_from_accepted_worker_after(self):
        for name in (contract.TARGET, 'ga_workers/full_runtime_adapter.py'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                marker, app, native = fixture()
                marker['worker_after'][name] = '9' * 64
                root = Path(directory)
                write_inputs(root, app, native)
                with self.assertRaisesRegex(ValueError, 'stage_accepted_artifact_mismatch'):
                    stage.stage(marker, root)
                self.assertFalse((root / 'new').exists())

    def test_native_hash_receiver_rejects_private_fields_invalid_hashes_and_symlinks(self):
        _, _, native = fixture()
        invalid = [dict(native, private_source='PRIVATE_SENTINEL'), dict(native, code_inputs_sha256='not-a-hash'),
                   dict(native, format='unexpected'), dict(native, worker_hashes={'../source.py': '1' * 64})]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / 'native.json'
            path.write_text(json.dumps(native))
            self.assertEqual(stage.native_manifest(path), native)
            link = root / 'linked.json'; link.symlink_to(path)
            with self.assertRaises(ValueError):
                stage.native_manifest(link)
            for value in invalid:
                path.write_text(json.dumps(value))
                with self.assertRaises(ValueError):
                    stage.native_manifest(path)
            path.write_text('x' * 16385)
            with self.assertRaises(ValueError):
                stage.native_manifest(path)

    def test_native_hash_program_keeps_selected_values_source_and_errors_on_host(self):
        secret = 'CODE_INPUT_SENTINEL_NOT_FOR_CI'
        synthetic = ('def load_owned_inputs():\n'
            '    return {"synthetic_code": "' + secret + '"}, '
            '{"source_hashes": {"ga_workers/a.py": "' + 'a' * 64 + '"}, "private": "' + secret + '"}, '
            '{"ga_workers/a.py": "' + secret + '"}\n')
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'contract.py'; source.write_text(synthetic)
            with patch.object(native_hashes, 'CONTRACT', source), patch.object(native_hashes, 'CONTRACT_SHA', contract.digest(synthetic.encode())):
                program = native_hashes.public_program()
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                exec(program, {})
            value = json.loads(output.getvalue())
            self.assertEqual(set(value), {'format', 'worker_hashes', 'code_inputs_sha256'})
            self.assertEqual(value['format'], 'shift-aware-native-hashes-v1')
            self.assertEqual(value['worker_hashes'], {'ga_workers/a.py': 'a' * 64})
            self.assertEqual(value['code_inputs_sha256'], contract.digest(json.dumps(
                {'synthetic_code': secret}, separators=(',', ':')).encode()))
            self.assertNotIn(secret, output.getvalue())
            with patch.object(native_hashes, 'CONTRACT', source), self.assertRaisesRegex(ValueError, 'native_contract_drift'):
                native_hashes.public_program()
            failing = 'def load_owned_inputs():\n    raise ValueError("' + secret + '")\n'
            source.write_text(failing)
            with patch.object(native_hashes, 'CONTRACT', source), patch.object(native_hashes, 'CONTRACT_SHA', contract.digest(failing.encode())):
                program = native_hashes.public_program()
            errors = io.StringIO(); output = io.StringIO()
            with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors), self.assertRaises(SystemExit) as raised:
                exec(program, {})
            self.assertEqual(raised.exception.code, 6)
            self.assertEqual(output.getvalue(), '')
            self.assertEqual(errors.getvalue(), 'SHIFT_AWARE_NATIVE_HASH_CAPTURE_FAILED\n')

    def test_new_helpers_are_bound_to_public_source_receipt(self):
        public = contract.public_hashes()
        for name in ('native_hashes.py', 'stage.py', 'test_stage.py', 'release.sh'):
            self.assertIn('ops/ovh/shift-aware-minibatch-release-20261125/' + name, public)
        self.assertIn('ops/ovh/joint-minibatch-search-20261124/joint_minibatch.py', public)
        self.assertIn('ops/ovh/joint-search-diversity-20261125/patch.py', public)
        self.assertIn('ops/ovh/shift-aware-minibatches-20261125/patch.py', public)
        self.assertEqual(contract.digest(native_hashes.CONTRACT.read_bytes()), native_hashes.CONTRACT_SHA)

    def test_post_install_hash_function_failure_restores_backup_and_runs_rollback(self):
        source = (HERE / 'release.sh').read_text()
        remote = source.split("<<'REMOTE'\n", 1)[1]
        shell_options = next(line for line in remote.splitlines() if line.startswith('set -'))
        verify_function = next(line for line in remote.splitlines() if line.startswith('verify_sources(){'))
        rollback = 'rollback(){\n' + remote.split('rollback(){\n', 1)[1].split('\ndeployment_phase=install_native_module\n', 1)[0]
        handler = next(line for line in remote.splitlines() if line.startswith("trap 'rollback "))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); staging = root / 'stage'; backup = root / 'backup'
            (staging / 'ga').mkdir(parents=True); (backup / 'ga').mkdir(parents=True)
            target = root / 'joint_minibatch.py'; target.write_bytes(b'accepted old source')
            (backup / 'ga/joint_minibatch.py').write_bytes(target.read_bytes())
            (staging / 'ga/joint_minibatch.py').write_bytes(b'accepted new source')
            (staging / 'deploy_contract.py').write_text(
                'from pathlib import Path\nimport sys\n'
                'stage = Path(sys.argv[1])\n'
                'if sys.argv[2] == "new":\n    raise SystemExit(6)\n'
                'assert sys.argv[2] == "old"\n'
                'assert (stage.parent / "joint_minibatch.py").read_bytes() == b"accepted old source"\n')
            # These shell functions intercept every operations-helper call;
            # the regression uses only synthetic files in this temporary folder.
            program = '\n'.join([shell_options, verify_function,
                'sudo(){ test "$*" = "-n /usr/local/sbin/liftorbit-ops update" && : > "$stage/rollback-updated"; }',
                'wait_for_service_smoke(){ return 0; }', rollback, handler,
                'deployment_phase=install_native_module',
                'cp "$stage/ga/joint_minibatch.py" "$target"',
                'deployment_phase=verify_staged_hashes', 'verify_sources new',
                'printf "UNSAFE_CONTINUATION\\n"'])
            result = subprocess.run(['bash', '-c', program], text=True, capture_output=True,
                env={'PATH': os.environ.get('PATH', '/usr/local/bin:/usr/bin:/bin'),
                     'stage': str(staging), 'backup': str(backup), 'target': str(target)})
            self.assertEqual(result.returncode, 6, result.stderr)
            self.assertEqual(target.read_bytes(), b'accepted old source')
            self.assertTrue((staging / 'rollback-updated').is_file())
            self.assertIn('SHIFT_AWARE_RELEASE_FAILED_PHASE verify_staged_hashes', result.stdout)
            self.assertIn('SHIFT_AWARE_RELEASE_ROLLBACK_RESTORE_EXIT 0', result.stdout)
            self.assertIn('SHIFT_AWARE_RELEASE_ROLLBACK_UPDATE_EXIT 0', result.stdout)
            self.assertIn('SHIFT_AWARE_RELEASE_ROLLBACK_HEALTH_PASS', result.stdout)
            self.assertNotIn('UNSAFE_CONTINUATION', result.stdout)


if __name__ == '__main__':
    unittest.main()
