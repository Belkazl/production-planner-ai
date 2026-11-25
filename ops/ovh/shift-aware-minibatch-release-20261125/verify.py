"""One-module private overlay; exact native regression evidence and source hashes."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import uuid

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from contract import (APP_FILES, PROTECTED_FILES, TARGET, REPO, OPS, baseline, digest, hashes,
                      native_bundle, public_hashes, read_json, validate_container_report, validate_worker_change,
                      WORKER_CHECKS, SHIFT_CHECKS, SHIFT_CASES, NATIVE_ELEVEN_CASES, INTEGRATED_CASES,
                      SHIFT_FAILURE_PHASES, SHIFT_FAILURE_CODES)

GATES = ('shift_tests', 'native_eleven', 'native_integrated_setups', 'native_shift_aware', 'acceptance_report')
CLASSES = frozenset({'AssertionError', 'TypeError', 'ValueError', 'KeyError', 'RuntimeError',
    'VerificationError', 'CheckError', 'JointContractError', 'PinConstraintError',
    'SyntaxError', 'ImportError', 'ModuleNotFoundError', 'TimeoutExpired', 'ShiftCheckError', 'ShiftVerificationError',
    'FullGAError', 'InfeasibleCandidate', 'ContinuationError', 'OverflowError',
    'JSONDecodeError', 'FileNotFoundError', 'AttributeError', 'Exception'})


def app_manifest(path):
    value = read_json(path, 16384)
    if not isinstance(value, dict) or set(value) != {'format', 'app_hashes', 'protected_hashes'} or value['format'] != 'shift-aware-minibatch-app-hashes-v1':
        raise ValueError('app_hash_contract')
    hashes(value['app_hashes'], APP_FILES); hashes(value['protected_hashes'], PROTECTED_FILES)
    return value


def write_files(root, files):
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    for name, data in files.items():
        if name == 'manifest.json':
            continue
        path = root / name
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with path.open('xb') as stream:
            os.chmod(path, 0o600); stream.write(data)


def build_overlay(files, target, log_path):
    write_files(target, {name: data for name, data in files.items() if name.startswith('ga_workers/')})
    path = target / TARGET
    command = [sys.executable, '-B', '-I', str(OPS / 'shift-aware-minibatches-20261125/patch.py'), str(path), str(path)]
    with log_path.open('wb') as log:
        result = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
            env={'PATH': '/usr/local/bin:/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE': '1'}, timeout=30, check=False)
    if result.returncode:
        raise ValueError('exact_native_patch')
    paths = list(target.rglob('*'))
    names = {path.relative_to(target).as_posix() for path in paths if path.is_file()}
    before = {name: digest(data) for name, data in files.items() if name.startswith('ga_workers/')}
    if names != set(before) or any(path.is_symlink() for path in paths):
        raise ValueError('native_overlay_files')
    after = {name: digest((target / name).read_bytes()) for name in names}
    validate_worker_change(before, after)
    # Syntax only: never import or execute private native source on the runner.
    compile(path.read_bytes(), '<accepted-joint-module>', 'exec')
    return after


def safe_failure(path):
    try:
        value = read_json(path, 131072)
        if not isinstance(value, dict) or value.get('gate') not in GATES:
            return None
        # All optional details are fixed booleans/counts; arbitrary exception
        # messages or source-derived names cannot reach stdout.
        result = {'gate': value['gate'],
                'exception_types': [kind for kind in value.get('exception_types', [])[:8]
                                    if isinstance(kind, str) and kind in CLASSES],
                'failed_cases': [name for name in value.get('failed_cases', [])[:16]
                                 if name in (*NATIVE_ELEVEN_CASES, *INTEGRATED_CASES, *SHIFT_CASES)],
                'failed_checks': [name for name in value.get('failed_checks', [])[:20]
                                  if name in (*WORKER_CHECKS, *SHIFT_CHECKS, 'release_gate_complete', 'ordered_continuation_verified')]}
        detail = value.get('native_detail')
        if (value['gate'] == 'native_shift_aware' and isinstance(detail, dict)
                and detail.get('phase') in SHIFT_FAILURE_PHASES
                and detail.get('error_code') in SHIFT_FAILURE_CODES):
            result['native_detail'] = {'phase': detail['phase'], 'error_code': detail['error_code'],
                'error_type': detail['error_type'] if detail.get('error_type') in CLASSES else 'Exception'}
        return result
    except Exception:
        return None


def verify(native_path, app_path, image):
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', image):
        raise ValueError('runtime_image')
    fixed, app = baseline(), app_manifest(app_path)
    files, workers, code_hash = native_bundle(native_path)
    if (app['app_hashes'] != fixed['app_hashes'] or app['protected_hashes'] != fixed['protected_hashes']
            or workers != fixed['worker_hashes'] or code_hash != fixed['code_inputs_sha256']):
        raise ValueError('baseline_source_drift')
    with tempfile.TemporaryDirectory(prefix='shift-aware-private-', dir=os.environ.get('RUNNER_TEMP')) as directory:
        root = Path(directory); root.chmod(0o700)
        inputs, candidate, work = root / 'input', root / 'candidate', root / 'work'
        write_files(inputs, {'code-inputs.json': files['code-inputs.json']})
        after = build_overlay(files, candidate, root / 'patch-private.log')
        (work / 'out').mkdir(mode=0o700, parents=True)
        uid, gid = os.getuid(), os.getgid()
        name = 'shift-aware-verify-' + uuid.uuid4().hex
        command = ['docker', 'run', '--rm', '--name', name, '--network', 'none', '--read-only',
            '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user', f'{uid}:{gid}',
            '--pids-limit', '256', '--memory', '3g', '--cpus', '2',
            '--tmpfs', f'/tmp:rw,nosuid,nodev,size=536870912,uid={uid},gid={gid},mode=700',
            '--mount', f'type=bind,src={inputs},dst=/input,readonly',
            '--mount', f'type=bind,src={candidate},dst=/native,readonly',
            '--mount', f'type=bind,src={work},dst=/work',
            '--mount', f'type=bind,src={REPO / "ops"},dst=/public/repo/ops,readonly',
            image, 'python3', '-B', '-I', '/public/repo/ops/ovh/shift-aware-minibatch-release-20261125/container_gate.py']
        try:
            with (root / 'container-private.log').open('wb') as log:
                result = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=log,
                                        stderr=subprocess.STDOUT, timeout=900, check=False)
        finally:
            subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=20, check=False)
        if result.returncode:
            failure = safe_failure(work / 'out/failure-report.json')
            if failure:
                print('SHIFT_AWARE_FAILURE_METADATA ' + json.dumps(failure, separators=(',', ':')))
            raise ValueError('container_failed')
        accepted = validate_container_report(read_json(work / 'out/safe-report.json'))
        if {name: digest((candidate / name).read_bytes()) for name in after} != after:
            raise ValueError('native_output_changed')
        if (inputs / 'code-inputs.json').read_bytes() != files['code-inputs.json']:
            raise ValueError('code_input_changed')
        return {'format': 'shift-aware-minibatch-acceptance-v1', 'status': 'shift_aware_minibatch_pass',
            'release_gate_complete': True, 'production_writes': False,
            'app_hashes': app['app_hashes'], 'protected_hashes': app['protected_hashes'],
            'worker_before': workers, 'worker_after': after, 'code_inputs_sha256': code_hash,
            'runtime_image': image, 'public_sources': public_hashes(),
            'native_eleven_verified': True, 'native_case_count': 11, 'integrated_case_count': 4,
            'shift_aware_verified': True, 'unique_evaluations_complete': True,
            'worker_checks': accepted['worker_checks'], 'shift_checks': accepted['shift_checks'],
            'shift_counts': accepted['shift_counts'], 'shift_cases': accepted['shift_cases']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--native-bundle', required=True, type=Path)
    parser.add_argument('--app-hashes', required=True, type=Path)
    parser.add_argument('--image-id', required=True)
    args = parser.parse_args()
    try:
        report = verify(args.native_bundle, args.app_hashes, args.image_id)
        print('SHIFT_AWARE_VERIFICATION ' + json.dumps(report, separators=(',', ':')))
    except Exception as error:
        allowed = {'runtime_image', 'baseline_not_ready', 'baseline_source_drift', 'exact_native_patch',
                   'native_overlay_files', 'container_failed', 'container_acceptance_incomplete',
                   'container_acceptance_checks', 'container_acceptance_counts', 'container_acceptance_cases',
                   'native_output_changed', 'code_input_changed'}
        label = str(error) if isinstance(error, ValueError) and str(error) in allowed else 'verification_failed'
        print('SHIFT_AWARE_VERIFICATION_FAILED ' + label)
        raise SystemExit(6)
