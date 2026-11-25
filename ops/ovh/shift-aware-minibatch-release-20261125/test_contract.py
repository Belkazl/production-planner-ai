import copy
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import contract
import capture
import deploy_contract
import release_guard
import verify


def fixture_baseline():
    workers = {f'ga_workers/{name}.py': '1' * 64 for name in
               ('__init__', 'full_runtime_adapter', 'joint_minibatch', 'joint_continuation', 'constraints')}
    workers['ga_workers/compile_legacy_ga.py'] = contract.COMPILE_SHA
    return {'format': 'shift-aware-minibatch-baseline-v1', 'ready': True,
        'presentation_candidate': 'a' * 40, 'presentation_verification_run_id': 123,
        'presentation_deployed_commit': 'b' * 40,
        'app_hashes': dict.fromkeys(contract.APP_FILES, '2' * 64),
        'protected_hashes': dict.fromkeys(contract.PROTECTED_FILES, '3' * 64),
        'worker_hashes': workers, 'code_inputs_sha256': '4' * 64}


def fixture_report():
    before = fixture_baseline()
    after = dict(before['worker_hashes']); after[contract.TARGET] = '5' * 64
    return {'format': 'shift-aware-minibatch-acceptance-v1', 'status': 'shift_aware_minibatch_pass',
        'release_gate_complete': True, 'production_writes': False,
        'app_hashes': before['app_hashes'], 'protected_hashes': before['protected_hashes'],
        'worker_before': before['worker_hashes'], 'worker_after': after,
        'code_inputs_sha256': before['code_inputs_sha256'], 'runtime_image': 'sha256:' + '6' * 64,
        'public_sources': {'reviewed-helper.py': '7' * 64},
        'native_eleven_verified': True, 'native_case_count': 11, 'integrated_case_count': 4,
        'shift_aware_verified': True, 'unique_evaluations_complete': True,
        'worker_checks': dict.fromkeys(contract.WORKER_CHECKS, True),
        'shift_checks': dict.fromkeys(contract.SHIFT_CHECKS, True),
        'shift_counts': dict.fromkeys(contract.SHIFT_COUNTS, 18),
        'shift_cases': {name: {**dict.fromkeys(contract.SHIFT_CASE_CHECKS, True),
            'baseline_duration': 500, 'best_duration': 470,
            'target_cut': 25 if name == 'setup_reservation' else 30,
            'first_cut': 25 if name == 'setup_reservation' else 30}
            for name in contract.SHIFT_CASES}}


class ContractTests(unittest.TestCase):
    def test_placeholder_fails_before_private_capture(self):
        with self.assertRaisesRegex(ValueError, 'baseline_not_ready'):
            contract.validate_baseline({'format': 'shift-aware-minibatch-baseline-v1', 'ready': False})
        self.assertEqual(contract.validate_baseline(fixture_baseline()), fixture_baseline())

    def test_baseline_derives_only_successful_complete_presentation(self):
        fixed = fixture_baseline()
        source = {'format': 'zoom-label-acceptance-v1', 'status': 'zoom_label_pass',
            'release_gate_complete': True, 'production_writes': False, 'app_after': fixed['app_hashes'],
            'protected_hashes': fixed['protected_hashes'], 'worker_hashes': fixed['worker_hashes'],
            'code_inputs_sha256': fixed['code_inputs_sha256'],
            'zoom_label_checks': dict.fromkeys(contract.PRESENTATION_CHECKS, True),
            'build_chain_checks': dict.fromkeys(contract.BUILD_CHAIN_CHECKS, True)}
        result = contract.baseline_from_presentation(source, 'a' * 40, 123, 'b' * 40)
        self.assertEqual(result, fixed)
        for changed in (dict(source, release_gate_complete=False), dict(source, build_chain_checks={'all_checks_passed': True}),
                        dict(source, zoom_label_checks={'all_zoom_label_checks_passed': True})):
            with self.assertRaises(ValueError):
                contract.baseline_from_presentation(changed, 'a' * 40, 123, 'b' * 40)

    def test_only_joint_module_can_change(self):
        report = fixture_report()
        contract.validate_worker_change(report['worker_before'], report['worker_after'])
        for name in ('ga_workers/full_runtime_adapter.py', 'ga_workers/joint_continuation.py', 'ga_workers/compile_legacy_ga.py'):
            changed = dict(report['worker_after']); changed[name] = '8' * 64
            with self.assertRaisesRegex(ValueError, 'single_native_module_contract'):
                contract.validate_worker_change(report['worker_before'], changed)
        with self.assertRaises(ValueError):
            contract.validate_worker_change(report['worker_before'], report['worker_before'])

    def test_exact_all_required_native_gates(self):
        report = fixture_report()
        complete = dict(report, format='shift-aware-minibatch-container-v1', all_checks_passed=True)
        contract.validate_container_report(complete)
        for name, invalid in (('native_eleven_verified', False), ('native_case_count', 10),
                              ('integrated_case_count', 3), ('shift_aware_verified', False), ('unique_evaluations_complete', False)):
            with self.assertRaises(ValueError):
                contract.validate_container_report(dict(complete, **{name: invalid}))
        for name in contract.WORKER_CHECKS:
            changed = copy.deepcopy(complete); changed['worker_checks'][name] = False
            with self.assertRaises(ValueError):
                contract.validate_container_report(changed)
        for name in contract.SHIFT_CHECKS:
            changed = copy.deepcopy(complete); changed['shift_checks'][name] = False
            with self.assertRaises(ValueError):
                contract.validate_container_report(changed)

    def test_shift_case_witnesses_cannot_be_missing_or_unbounded(self):
        complete = dict(fixture_report(), format='shift-aware-minibatch-container-v1', all_checks_passed=True)
        for name in contract.SHIFT_CASES:
            changed = copy.deepcopy(complete); del changed['shift_cases'][name]
            with self.assertRaises(ValueError):
                contract.validate_container_report(changed)
            for key in contract.SHIFT_CASE_CHECKS:
                changed = copy.deepcopy(complete); changed['shift_cases'][name][key] = False
                with self.assertRaises(ValueError):
                    contract.validate_container_report(changed)
            for key, invalid in (('best_duration', float('nan')), ('best_duration', 500),
                    ('target_cut', 200), ('first_cut', True), ('first_cut', 0), ('first_cut', 201)):
                changed = copy.deepcopy(complete); changed['shift_cases'][name][key] = invalid
                with self.assertRaises(ValueError):
                    contract.validate_container_report(changed)

    def test_marker_binds_app_auth_native_inputs_and_helpers(self):
        report = fixture_report()
        with patch.object(release_guard, 'baseline', return_value=fixture_baseline()), patch.object(release_guard, 'public_hashes', return_value=report['public_sources']):
            marker = release_guard.marker_from_report(report, 'c' * 40, 456)
            for field, key in (('app_hashes', 'restart-optimizer-ui.js'), ('protected_hashes', 'auth-runtime.js'),
                               ('worker_before', 'ga_workers/full_runtime_adapter.py'), ('public_sources', 'reviewed-helper.py')):
                changed = copy.deepcopy(marker); changed[field][key] = '9' * 64
                with self.assertRaises(ValueError):
                    release_guard.validate_marker(changed)
            with self.assertRaises(ValueError):
                release_guard.validate_marker(dict(marker, code_inputs_sha256='9' * 64))
            with self.assertRaises(ValueError):
                release_guard.validate_report(marker, dict(report, worker_after=report['worker_before']))

    def test_acceptance_run_has_exact_repository_branch_head_and_workflow(self):
        marker = {'candidate_commit': 'c' * 40, 'verification_run_id': 456}
        run = {'id': 456, 'status': 'completed', 'conclusion': 'success', 'head_sha': 'c' * 40,
               'head_branch': release_guard.BRANCH, 'path': release_guard.WORKFLOW,
               'repository': {'full_name': release_guard.REPOSITORY}}
        release_guard.validate_run(marker, run)
        for field, value in (('id', 457), ('conclusion', 'failure'), ('head_sha', 'd' * 40),
                             ('head_branch', 'main'), ('path', 'different.yml')):
            with self.assertRaises(ValueError):
                release_guard.validate_run(marker, dict(run, **{field: value}))

    def test_receipt_cannot_be_missing_duplicate_or_arbitrary_log(self):
        data = b'2026-11-25T00:00:00Z SHIFT_AWARE_VERIFICATION {"safe":true}\n'
        self.assertEqual(release_guard.report_from_log(data), {'safe': True})
        for rejected in (b'', data + data, b'private log with no receipt'):
            with self.assertRaises(ValueError):
                release_guard.report_from_log(rejected)

    def test_deployment_manifest_refuses_every_other_write(self):
        report = fixture_report()
        rows = [('PRESERVE', 'app/' + name, sha, sha) for name, sha in report['app_hashes'].items()]
        rows += [('PRESERVE', 'app/' + name, sha, sha) for name, sha in report['protected_hashes'].items()]
        rows += [('WRITE' if name == contract.TARGET else 'PRESERVE', 'ga/' + name.removeprefix('ga_workers/'), sha, report['worker_after'][name])
                 for name, sha in report['worker_before'].items()]
        encode = lambda items: ''.join('\t'.join(row) + '\n' for row in items).encode()
        deploy_contract.manifest_rows(encode(rows))
        changed = list(rows); changed[0] = ('WRITE', rows[0][1], rows[0][2], 'a' * 64)
        with self.assertRaises(ValueError):
            deploy_contract.manifest_rows(encode(changed))
        with self.assertRaises(ValueError):
            deploy_contract.manifest_rows(encode(rows + [rows[-1]]))

    def test_backup_is_verified_against_accepted_old_hash_before_install(self):
        source = (HERE / 'release.sh').read_text()
        block = source.split('deployment_phase=backup_native_module\n', 1)[1].split('rollback(){', 1)[0]
        program = "deployment_phase=backup_native_module\nsha(){ sha256sum \"$1\" | cut -d' ' -f1; }\n" + block
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); stage = root / 'stage'; stage.mkdir()
            target = root / 'joint_minibatch.py'; target.write_bytes(b'accepted native module')
            accepted = hashlib.sha256(target.read_bytes()).hexdigest()
            (stage / 'manifest.tsv').write_text('WRITE\tga/joint_minibatch.py\t' + accepted + '\t' + 'b' * 64 + '\n')
            env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'stage': str(stage), 'target': str(target)}
            ok = subprocess.run(['bash', '-euo', 'pipefail', '-c', program],
                env=dict(env, backup=str(root / 'accepted-backup')), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self.assertEqual(ok.returncode, 0)
            # A target changed after preflight would make both current/backup
            # hashes equal each other. It must still fail the accepted-old check.
            target.write_bytes(b'unaccepted intervening change')
            bad = subprocess.run(['bash', '-euo', 'pipefail', '-c', program],
                env=dict(env, backup=str(root / 'changed-backup')), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self.assertNotEqual(bad.returncode, 0)

    def test_regular_source_guard_refuses_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); path = root / 'source.py'; path.write_text('safe public source')
            link = root / 'link.py'; link.symlink_to(path)
            with patch.object(capture, 'ROOT', root), patch.object(deploy_contract, 'ROOT', root):
                self.assertEqual(capture.read_owned(path), path.read_bytes())
                self.assertEqual(deploy_contract.read_regular(path), path.read_bytes())
                for read in (capture.read_owned, deploy_contract.read_regular):
                    with self.assertRaises(ValueError):
                        read(link)

    def test_native_bundle_rejects_traversal_and_links_before_extracting(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'native.tar'
            for name, kind in (('../outside.py', tarfile.REGTYPE), ('ga_workers/joint_minibatch.py', tarfile.SYMTYPE)):
                with tarfile.open(path, 'w') as archive:
                    member = tarfile.TarInfo(name); member.type = kind
                    if kind == tarfile.SYMTYPE:
                        member.linkname = '/private'
                        archive.addfile(member)
                    else:
                        member.size = 1; archive.addfile(member, io.BytesIO(b'x'))
                with self.assertRaises(ValueError):
                    contract.native_bundle(path)

    def test_failure_output_omits_arbitrary_names_and_messages(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'failure.json'
            path.write_text(json.dumps({'gate': 'native_eleven', 'exception_types': ['AssertionError', 'PRIVATE_SECRET'],
                'failed_cases': ['stop_continue', 'PRIVATE_CUSTOMER'], 'message': 'PRIVATE_SOURCE'}))
            result = verify.safe_failure(path)
            self.assertEqual(result, {'gate': 'native_eleven', 'exception_types': ['AssertionError'],
                                     'failed_cases': ['stop_continue'], 'failed_checks': []})
            self.assertNotIn('PRIVATE', json.dumps(result))


if __name__ == '__main__':
    unittest.main()
