"""Execute public synthetic gates inside the networkless private container."""
import json
import os
from pathlib import Path
import subprocess
import sys
import re

sys.path.insert(0, str(Path(__file__).resolve().parent))
from diagnostics import NATIVE_ELEVEN_CASES, public_error_codes, safe_anchor_counts, build_test_metadata, safe_build_probe

PUBLIC = Path('/public/repo/ops/ovh')
WORK = Path('/work')
APP = WORK / 'new/app'
OUT = WORK / 'out'
WORKER_CHECKS = (
    'native_setups_in_fitness', 'candidate_resource_reservations',
    'material_shift_case_valid', 'pinned_case_valid', 'zero_setup_case_valid',
    'all_native_checks_passed',
)
APP_CHECKS = (
    'pipeline_preserves_native_schedule', 'pipeline_preserves_native_metrics',
    'pipeline_preserves_server_resume', 'public_stop_projection_coherent',
    'zero_setups_authoritative', 'delayed_material_shift_preserved',
    'pins_preserved', 'scoped_stop_isolated', 'no_legacy_rescheduling',
    'all_app_checks_passed',
)


class GateError(Exception):
    pass


def failure_metadata(label, log_path):
    # Public filenames and fixed exception types only. Stack source, arbitrary
    # messages and native/generated filenames never enter the receipt.
    names = ('patch.mjs', 'test.mjs', 'canonical.mjs', 'pipeline.mjs', 'build-fixtures.mjs', 'test-build-fixtures.mjs',
             'python-ga-upstream.test.mjs', 'python-ga-state.test.mjs', 'verify_app.mjs', 'verify_worker.py', 'cases.py',
             'verify_native.py', 'regression_cases.py', 'container_gate.py')
    classes = ('AssertionError', 'TypeError', 'ReferenceError', 'SyntaxError', 'ImportError',
               'ModuleNotFoundError', 'ValueError', 'RuntimeError', 'VerificationError', 'Error')
    with log_path.open('rb') as stream:
        text = stream.read(262144).decode('utf-8', errors='replace')
    text = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', text)
    frames = []
    for name in names:
        expression = r'(?<![A-Za-z0-9_.-])' + re.escape(name) + r':([0-9]{1,6})(?::[0-9]{1,6})?'
        frames.extend({'file': name, 'line': int(match.group(1))} for match in re.finditer(expression, text))
        expression = r'File [\"\'][^\"\'\r\n]*[/\\]' + re.escape(name) + r'[\"\'], line ([0-9]{1,6})'
        frames.extend({'file': name, 'line': int(match.group(1))} for match in re.finditer(expression, text))
    types = [name for name in classes if re.search(r'\b' + name + r'\b', text)]
    known_codes = public_error_codes(PUBLIC)
    codes = sorted({word for word in re.findall(r'\bINTEGRATED_[A-Za-z0-9_]{1,140}\b', text) if word in known_codes})[:8]
    value = {'gate': label, 'exception_classes': types, 'public_frames': frames[:16], 'public_error_codes': codes}
    if label == 'actual_build_tests':
        value['build_tests'] = build_test_metadata(text)
    anchor_rows = re.findall(r'^INTEGRATED_SETUP_SOURCE_ANCHORS ([^\r\n]{1,16000})$', text, re.MULTILINE)
    if len(anchor_rows) == 1:
        try:
            value['source_anchors'] = safe_anchor_counts(json.loads(anchor_rows[0]), PUBLIC)
        except (ValueError, TypeError, RecursionError):
            pass
    (OUT / 'failure-report.json').write_text(json.dumps(value, separators=(',', ':')))


def run_build_probe():
    # Diagnostics can never turn the already failed required build gate green.
    status, report = 'unavailable', None
    try:
        with (OUT / 'build_diagnostic-private.log').open('wb') as log:
            result = subprocess.run(['node', str(PUBLIC / 'integrated-setup-release-20261125/diagnose-build.mjs'),
                str(APP), str(OUT / 'build-diagnostic.json')], cwd=APP,
                env={'PATH': '/usr/local/bin:/usr/bin:/bin', 'TMPDIR': '/tmp'}, stdin=subprocess.DEVNULL,
                stdout=log, stderr=subprocess.STDOUT, timeout=100, check=False)
        path = OUT / 'build-diagnostic.json'
        if result.returncode in (0, 1) and path.is_file() and not path.is_symlink() and path.stat().st_size <= 131072:
            report = safe_build_probe(json.loads(path.read_bytes()))
            if report is not None:
                status = 'completed' if result.returncode == 0 and report['diagnostic_completed'] and report['original_app_unchanged'] else 'unavailable'
    except (OSError, ValueError, TypeError, subprocess.TimeoutExpired):
        pass
    try:
        path = OUT / 'failure-report.json'
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 65536:
            return
        failure = json.loads(path.read_bytes())
        failure['probe_status'] = status
        failure['build_probe'] = report
        path.write_text(json.dumps(failure, separators=(',', ':')))
    except (OSError, ValueError, TypeError):
        pass


def gate(label, command, extra_env=None):
    env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE': '1',
           'TMPDIR': '/tmp', **(extra_env or {})}
    try:
        with (OUT / (label + '-private.log')).open('wb') as log:
            result = subprocess.run(command, env=env, cwd=APP, stdin=subprocess.DEVNULL,
                                    stdout=log, stderr=subprocess.STDOUT, timeout=240, check=False)
        if result.returncode:
            failure_metadata(label, OUT / (label + '-private.log'))
            raise GateError(label)
    except (OSError, subprocess.TimeoutExpired):
        raise GateError(label) from None


def actual_build_tests():
    command = ['bun', 'test', 'tests/python-ga-upstream.test.mjs', 'tests/python-ga-state.test.mjs']
    env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'TMPDIR': '/tmp'}
    with (OUT / 'legacy_build_before-private.log').open('wb') as log:
        before = subprocess.run(command, cwd=APP, env=env, stdin=subprocess.DEVNULL,
                                stdout=log, stderr=subprocess.STDOUT, timeout=90, check=False)
    passed = before.returncode == 0
    if not passed:
        gate('build_fixture_contract', ['node', str(PUBLIC / 'integrated-setup-result-20261125/build-fixtures.mjs'), str(APP)])
    try:
        gate('actual_build_tests', command)
    except GateError:
        run_build_probe()
        raise
    return {'legacy_build_before_passed': passed, 'legacy_build_after_passed': True, 'build_fixtures_updated': not passed}


def checked_report(path, expected_format, checks):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 131072:
        raise GateError('acceptance_report')
    value = json.loads(path.read_bytes())
    if value.get('format') != expected_format or any(value.get(name) is not True for name in checks):
        raise GateError('acceptance_report')
    return {name: True for name in checks}


def main():
    OUT.mkdir(mode=0o700, exist_ok=True)
    gate('canonical_patch', ['node', str(PUBLIC / 'integrated-setup-result-20261125/patch.mjs'), str(APP)])
    gate('preview_patch', ['node', str(PUBLIC / 'integrated-setup-preview-20261125/patch.mjs'),
                          str(APP / 'python-ga-upstream.mjs'), str(APP / 'python-ga-upstream.mjs')])
    gate('canonical_actual_source', ['node', '--test', str(PUBLIC / 'integrated-setup-result-20261125/test.mjs')],
         {'LIFTORBIT_INTEGRATED_SETUP_APP_FIXTURE_ROOT': '/input/app'})
    gate('preview_actual_source', ['node', '--test', str(PUBLIC / 'integrated-setup-preview-20261125/test.mjs')],
         {'LIFTORBIT_INTEGRATED_PREVIEW_FIXTURE': str(APP / 'python-ga-upstream.mjs')})
    gate('native_eleven', ['python3', '-I', str(PUBLIC / 'native-batching-verify-20261124/verify_native.py'),
         '--child', '/input/native', '--report', str(OUT / 'native-eleven.json'), '--overlay-gates'])
    native = json.loads((OUT / 'native-eleven.json').read_bytes())
    if (native.get('format') != 'native-minibatch-verification-v1' or native.get('status') != 'native_witness_pass'
            or native.get('release_gate_complete') is not True or native.get('ordered_continuation_verified') is not True
            or set(native.get('cases', {})) != set(NATIVE_ELEVEN_CASES)):
        raise GateError('native_eleven')
    gate('native_synthetic_fixtures', ['python3', '-I', str(PUBLIC / 'integrated-setup-verify-20261125/verify_worker.py'),
         '--package-root', '/input/native', '--code-inputs', '/input/native/code-inputs.json',
         '--fixtures', str(OUT / 'native-fixtures.json'), '--report', str(OUT / 'worker-report.json'),
         '--contract-helper', str(PUBLIC / 'native-batching-verify-20261124/native_input_contract.py')])
    gate('actual_final_pipeline', ['node', str(PUBLIC / 'integrated-setup-verify-20261125/verify_app.mjs'),
         '--app-root', str(APP), '--native-fixtures', str(OUT / 'native-fixtures.json'),
         '--report', str(OUT / 'app-report.json')])
    build = actual_build_tests()
    worker = checked_report(OUT / 'worker-report.json', 'integrated-setup-worker-v1', WORKER_CHECKS)
    app = checked_report(OUT / 'app-report.json', 'integrated-setup-app-v1', APP_CHECKS)
    # Reconstruct the safe receipt from fixed fields; never forward raw reports.
    report = {'format': 'integrated-setup-container-v1', 'worker_checks': worker,
              'app_checks': app, 'native_eleven_verified': True, 'native_case_count': len(native['cases']),
              'all_checks_passed': True, **build}
    (OUT / 'safe-report.json').write_text(json.dumps(report, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        label = str(error) if isinstance(error, GateError) else 'unexpected_gate'
        print('INTEGRATED_SETUP_GATE_FAILED ' + label)
        raise SystemExit(6)
