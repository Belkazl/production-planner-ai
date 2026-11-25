"""Private actual-source preflight; emits only a reconstructed bounded receipt."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import uuid

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(HERE))
import capture
from container_gate import APP_CHECKS, WORKER_CHECKS
from diagnostics import summarize_report, public_error_codes

FAILURE_GATES = {'canonical_patch', 'preview_patch', 'canonical_actual_source', 'preview_actual_source',
                 'native_synthetic_fixtures', 'native_eleven', 'actual_final_pipeline', 'acceptance_report', 'unexpected_gate',
                 'build_fixture_contract', 'actual_build_tests'}
PUBLIC_FAILURE_FILES = {'patch.mjs', 'test.mjs', 'canonical.mjs', 'pipeline.mjs', 'build-fixtures.mjs', 'test-build-fixtures.mjs',
                        'python-ga-upstream.test.mjs', 'python-ga-state.test.mjs', 'verify_app.mjs', 'verify_worker.py', 'cases.py',
                        'verify_native.py', 'regression_cases.py', 'container_gate.py'}
FAILURE_CLASSES = {'AssertionError', 'TypeError', 'ReferenceError', 'SyntaxError', 'ImportError',
                   'ModuleNotFoundError', 'ValueError', 'RuntimeError', 'VerificationError', 'Error'}


def safe_failure_report(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 65536:
        return None
    try:
        value = json.loads(path.read_bytes())
        if not isinstance(value, dict) or value.get('gate') not in FAILURE_GATES:
            return None
        kinds = value.get('exception_classes', [])
        frames = value.get('public_frames', [])
        codes = value.get('public_error_codes', [])
        if (not isinstance(kinds, list) or not isinstance(frames, list)
                or not isinstance(codes, list) or len(codes) > 8 or len(kinds) > 16 or len(frames) > 16):
            return None
        return {'gate': value['gate'],
                'exception_classes': [name for name in kinds if isinstance(name, str) and name in FAILURE_CLASSES],
                'public_error_codes': [name for name in codes if isinstance(name, str) and name in public_error_codes(REPO / 'ops/ovh')],
                'public_frames': [{'file': item['file'], 'line': item['line']} for item in frames
                                  if isinstance(item, dict) and item.get('file') in PUBLIC_FAILURE_FILES
                                  and type(item.get('line')) is int and 0 <= item['line'] <= 999999]}
    except (OSError, ValueError, TypeError):
        return None


def public_hashes():
    paths = set()
    for directory in ('integrated-setup-release-20261125', 'integrated-setup-result-20261125',
                      'integrated-setup-preview-20261125', 'integrated-setup-verify-20261125'):
        root = REPO / 'ops/ovh' / directory
        for path in root.rglob('*'):
            if path.is_file() and path.name != 'release.json' and (path.suffix in {'.py', '.mjs', '.cjs', '.js', '.ts', '.sh', '.json', '.txt'} or path.name == 'Dockerfile.verify'):
                if path.is_symlink():
                    raise ValueError('public_source_path')
                paths.add(path.relative_to(REPO).as_posix())
    paths.update({'.github/workflows/liftorbit-integrated-setup-verify-20261125.yml',
                  'ops/ovh/native-batching-verify-20261124/native_input_contract.py',
                  'ops/ovh/native-batching-verify-20261124/verify_native.py',
                  'ops/ovh/native-batching-verify-20261124/regression_cases.py',
                  'baselines/2026-10-10/aps-setup-bridge/index.ts'})
    release_workflow = '.github/workflows/liftorbit-integrated-setup-release-20261125.yml'
    if (REPO / release_workflow).is_file():
        paths.add(release_workflow)
    return {name: capture.digest((REPO / name).read_bytes()) for name in sorted(paths)}


def write_files(root, files):
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    for name, data in files.items():
        if name == 'manifest.json':
            continue
        path = root / name
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with path.open('xb') as stream:
            os.chmod(path, 0o600)
            stream.write(data)


def validate_container_report(value):
    if (not isinstance(value, dict) or set(value) != {'format', 'worker_checks', 'app_checks', 'native_eleven_verified', 'native_case_count', 'all_checks_passed',
                                                   'legacy_build_before_passed', 'legacy_build_after_passed', 'build_fixtures_updated'}
            or value.get('format') != 'integrated-setup-container-v1' or value.get('all_checks_passed') is not True
            or value.get('native_eleven_verified') is not True or type(value.get('native_case_count')) is not int
            or value['native_case_count'] != 11):
        raise ValueError('container_report')
    if (type(value.get('legacy_build_before_passed')) is not bool or value.get('legacy_build_after_passed') is not True
            or value.get('build_fixtures_updated') is not (not value['legacy_build_before_passed'])):
        raise ValueError('container_build_contract')
    for key, expected in (('worker_checks', WORKER_CHECKS), ('app_checks', APP_CHECKS)):
        if (not isinstance(value[key], dict) or set(value[key]) != set(expected)
                or any(item is not True for item in value[key].values())):
            raise ValueError('container_checks')


def verify(app_bundle, native_bundle, image):
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', image):
        raise ValueError('runtime_image')
    report = capture.inspect_inputs(app_bundle, native_bundle)
    baseline = json.loads((HERE / 'baseline.json').read_bytes())
    if (any(report['app_before'].get(name) != sha for name, sha in baseline.get('app_hashes', {}).items()) or report['protected_hashes'] != baseline.get('protected_hashes')
            or report['worker_hashes'] != baseline.get('worker_hashes')
            or report['code_inputs_sha256'] != baseline.get('code_inputs_sha256')):
        raise ValueError('baseline_source_drift')
    app_files = capture.read_bundle(app_bundle)
    native_files = capture.read_bundle(native_bundle, native=True)
    with tempfile.TemporaryDirectory(prefix='integrated-setup-private-', dir=os.environ.get('RUNNER_TEMP')) as directory:
        root = Path(directory); root.chmod(0o700)
        inputs, work = root / 'input', root / 'work'
        write_files(inputs / 'app', app_files)
        write_files(inputs / 'native', native_files)
        write_files(inputs, {'code-inputs.json': native_files['code-inputs.json']})
        write_files(work / 'new/app', app_files)
        (work / 'out').mkdir(mode=0o700, parents=True)
        uid, gid = os.getuid(), os.getgid()
        container_name = 'integrated-setup-verify-' + uuid.uuid4().hex
        command = ['docker', 'run', '--rm', '--name', container_name, '--network', 'none', '--read-only',
                   '--cap-drop=ALL', '--security-opt=no-new-privileges',
                   '--user', f'{uid}:{gid}', '--pids-limit', '256', '--memory', '3g', '--cpus', '2',
                   '--tmpfs', f'/tmp:rw,nosuid,nodev,size=536870912,uid={uid},gid={gid},mode=700',
                   '--mount', f'type=bind,src={inputs},dst=/input,readonly',
                   '--mount', f'type=bind,src={work},dst=/work',
                   '--mount', f'type=bind,src={REPO / "ops"},dst=/public/repo/ops,readonly',
                   '--mount', f'type=bind,src={REPO / "baselines"},dst=/public/repo/baselines,readonly',
                   image, 'python3', '-I', '/public/repo/ops/ovh/integrated-setup-release-20261125/container_gate.py']
        try:
            with (root / 'container-private.log').open('wb') as log:
                result = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=log,
                                        stderr=subprocess.STDOUT, timeout=600, check=False)
        finally:
            subprocess.run(['docker', 'rm', '-f', container_name], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=20, check=False)
        if result.returncode:
            # Emit only a known gate label, never container output or traceback.
            data = (root / 'container-private.log').read_bytes()[:65536].decode('utf-8', errors='replace')
            failure = safe_failure_report(work / 'out/failure-report.json')
            label = next((line.split(' ', 1)[1] for line in data.splitlines()
                          if line.startswith('INTEGRATED_SETUP_GATE_FAILED ') and line.split(' ', 1)[1] in FAILURE_GATES), 'container_exit')
            case_file = {'native_eleven': 'native-eleven.json', 'native_synthetic_fixtures': 'worker-report.json',
                         'actual_final_pipeline': 'app-report.json'}.get(label)
            details = summarize_report(work / 'out' / case_file, REPO / 'ops/ovh') if case_file else None
            if failure or details:
                print('INTEGRATED_SETUP_FAILURE_METADATA ' + json.dumps(
                    {'gate': label, 'trace': failure, 'synthetic_cases': details}, separators=(',', ':')))
            raise ValueError(label)
        safe = work / 'out/safe-report.json'
        if safe.is_symlink() or not safe.is_file() or safe.stat().st_size > 131072:
            raise ValueError('container_report')
        accepted = json.loads(safe.read_bytes()); validate_container_report(accepted)
        after = {}
        target = work / 'new/app'
        names = {path.relative_to(target).as_posix() for path in target.rglob('*') if path.is_file()}
        if names != set(capture.APP_FILES) or any(path.is_symlink() for path in target.rglob('*')):
            raise ValueError('unexpected_app_output')
        for name in capture.APP_FILES:
            path = target / name
            if path.stat().st_size > capture.MAX_FILE:
                raise ValueError('app_output_bound')
            after[name] = capture.digest(path.read_bytes())
        changed = {name for name in after if after[name] != report['app_before'][name]}
        expected_changed = set(capture.WRITE_FILES) | (set(capture.BUILD_TEST_FILES) if accepted['build_fixtures_updated'] else set())
        if changed != expected_changed:
            raise ValueError('exact_app_overlay')
        # Read-only mounts are enforced by Docker; recheck every native/app input.
        for name, data in app_files.items():
            if name != 'manifest.json' and (inputs / 'app' / name).read_bytes() != data:
                raise ValueError('input_changed')
        for name, data in native_files.items():
            if name != 'manifest.json' and (inputs / 'native' / name).read_bytes() != data:
                raise ValueError('input_changed')
        report.update(status='integrated_setup_pass', release_gate_complete=True, app_after=after,
                      worker_checks=accepted['worker_checks'], app_checks=accepted['app_checks'],
                      native_eleven_verified=True, native_case_count=11,
                      legacy_build_before_passed=accepted['legacy_build_before_passed'], legacy_build_after_passed=True,
                      build_fixtures_updated=accepted['build_fixtures_updated'],
                      worker_evidence=summarize_report(work / 'out/worker-report.json', REPO / 'ops/ovh'),
                      app_evidence=summarize_report(work / 'out/app-report.json', REPO / 'ops/ovh'),
                      runtime_image=image, public_sources=public_hashes())
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--app-bundle', required=True, type=Path)
    parser.add_argument('--native-bundle', required=True, type=Path)
    parser.add_argument('--image-id', required=True)
    args = parser.parse_args()
    try:
        report = verify(args.app_bundle, args.native_bundle, args.image_id)
        print('INTEGRATED_SETUP_VERIFICATION ' + json.dumps(report, separators=(',', ':')))
    except Exception as error:
        allowed = {'runtime_image', 'container_report', 'container_checks', 'canonical_patch', 'preview_patch',
                   'canonical_actual_source', 'preview_actual_source', 'native_synthetic_fixtures',
                   'native_eleven', 'actual_final_pipeline', 'acceptance_report', 'unexpected_gate', 'container_exit', 'baseline_source_drift',
                   'build_fixture_contract', 'actual_build_tests', 'container_build_contract',
                   'unexpected_app_output', 'app_output_bound', 'exact_app_overlay', 'input_changed'}
        label = str(error) if isinstance(error, ValueError) and str(error) in allowed else 'verification_failed'
        print('INTEGRATED_SETUP_VERIFICATION_FAILED ' + label)
        raise SystemExit(6)


if __name__ == '__main__':
    main()
