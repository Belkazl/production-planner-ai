"""Run unchanged constraint suites and actual shift, lunch and setup witnesses."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from contract import (WORKER_CHECKS, SHIFT_CHECKS, SHIFT_COUNTS, SHIFT_CASES, SHIFT_CASE_CHECKS, NATIVE_ELEVEN_CASES,
                      INTEGRATED_CASES, SHIFT_FAILURE_PHASES, SHIFT_FAILURE_CODES,
                      read_json, validate_container_report, validate_shift_cases)

PUBLIC = Path('/public/repo/ops/ovh')
OUT = Path('/work/out')
PHASES = ('shift_tests', 'native_eleven', 'native_integrated_setups', 'native_shift_aware', 'acceptance_report')
CLASSES = ('AssertionError', 'TypeError', 'ValueError', 'KeyError', 'RuntimeError', 'VerificationError',
    'CheckError', 'JointContractError', 'PinConstraintError', 'SyntaxError', 'ImportError',
    'ModuleNotFoundError', 'TimeoutExpired', 'ShiftCheckError', 'ShiftVerificationError',
    'FullGAError', 'InfeasibleCandidate', 'ContinuationError', 'OverflowError',
    'JSONDecodeError', 'FileNotFoundError', 'AttributeError', 'Exception')


class GateError(Exception):
    pass


def failure(phase, error=None):
    value = {'gate': phase, 'exception_types': [], 'failed_cases': [], 'failed_checks': []}
    if error is not None and type(error).__name__ in CLASSES:
        value['exception_types'].append(type(error).__name__)
    path = OUT / (phase + '-private.log')
    if path.is_file() and not path.is_symlink():
        with path.open('rb') as stream:
            text = stream.read(262144).decode('utf-8', errors='replace')
        value['exception_types'] = sorted(set(value['exception_types']) | {
            kind for kind in CLASSES if re.search(r'(?<![A-Za-z0-9_])' + kind + r'(?![A-Za-z0-9_])', text)})[:8]
    report_name = {'native_eleven': 'native-eleven.json', 'native_integrated_setups': 'worker-report.json',
                   'native_shift_aware': 'shift-report.json'}.get(phase)
    if report_name:
        try:
            report = read_json(OUT / report_name, 4 * 1024 * 1024)
            if isinstance(report, dict):
                for name, case in report.get('cases', {}).items():
                    if name in (*NATIVE_ELEVEN_CASES, *INTEGRATED_CASES, *SHIFT_CASES) and isinstance(case, dict):
                        if (case.get('valid') is False or case.get('error_type') or
                                name in SHIFT_CASES and any(case.get(key) is not True for key in SHIFT_CASE_CHECKS)):
                            value['failed_cases'].append(name)
                        if case.get('error_type') in CLASSES:
                            value['exception_types'].append(case['error_type'])
                for item in report.get('mandatory_gate_failures', []):
                    name = item.split(':', 1)[0] if isinstance(item, str) else None
                    if name in NATIVE_ELEVEN_CASES:
                        value['failed_cases'].append(name)
                wanted = (WORKER_CHECKS if phase == 'native_integrated_setups' else SHIFT_CHECKS
                          if phase == 'native_shift_aware' else ('release_gate_complete', 'ordered_continuation_verified'))
                value['failed_checks'] = [name for name in wanted if report.get(name) is not True]
                detail = report.get('failure')
                if (phase == 'native_shift_aware' and isinstance(detail, dict)
                        and detail.get('phase') in SHIFT_FAILURE_PHASES
                        and detail.get('error_code') in SHIFT_FAILURE_CODES):
                    value['native_detail'] = {'phase': detail['phase'], 'error_code': detail['error_code'],
                        'error_type': detail['error_type'] if detail.get('error_type') in CLASSES else 'Exception'}
        except Exception:
            pass
    value['exception_types'] = sorted(set(value['exception_types']))[:8]
    value['failed_cases'] = sorted(set(value['failed_cases']))[:16]
    (OUT / 'failure-report.json').write_text(json.dumps(value, separators=(',', ':')))


def gate(phase, command, env_extra=None, timeout=300):
    env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE': '1',
           'LC_ALL': 'C.UTF-8', **(env_extra or {})}
    try:
        with (OUT / (phase + '-private.log')).open('wb') as log:
            result = subprocess.run(command, env=env, stdin=subprocess.DEVNULL,
                stdout=log, stderr=subprocess.STDOUT, timeout=timeout, check=False)
        if result.returncode:
            raise GateError(phase)
    except Exception as error:
        failure(phase, error)
        raise GateError(phase) from None


def require_checks(report, format_name, expected, phase):
    if not isinstance(report, dict) or report.get('format') != format_name or any(report.get(name) is not True for name in expected):
        failure(phase)
        raise GateError(phase)
    return {name: True for name in expected}


def run():
    OUT.mkdir(mode=0o700, parents=True, exist_ok=True)
    gate('shift_tests', ['python3', '-B', '-I', '-m', 'unittest', 'discover',
        '-s', str(PUBLIC / 'shift-aware-minibatches-20261125'), '-p', 'test_*.py'],
        {'LIFTORBIT_SHIFT_AWARE_FIXTURE': '/native/ga_workers/joint_minibatch.py'})
    print('SHIFT_AWARE_GATE_PASS shift_tests', flush=True)
    gate('native_eleven', ['python3', '-B', '-I', str(PUBLIC / 'native-batching-verify-20261124/verify_native.py'),
        '--child', '/native', '--report', str(OUT / 'native-eleven.json'), '--overlay-gates'], timeout=420)
    native = read_json(OUT / 'native-eleven.json', 4 * 1024 * 1024)
    if (native.get('format') != 'native-minibatch-verification-v1' or native.get('status') != 'native_witness_pass'
            or native.get('release_gate_complete') is not True or native.get('ordered_continuation_verified') is not True
            or set(native.get('cases', {})) != set(NATIVE_ELEVEN_CASES)):
        failure('native_eleven'); raise GateError('native_eleven')
    print('SHIFT_AWARE_GATE_PASS native_eleven', flush=True)
    helper = str(PUBLIC / 'native-batching-verify-20261124/native_input_contract.py')
    gate('native_integrated_setups', ['python3', '-B', '-I', str(PUBLIC / 'integrated-setup-verify-20261125/verify_worker.py'),
        '--package-root', '/native', '--code-inputs', '/input/code-inputs.json',
        '--fixtures', str(OUT / 'native-fixtures.json'), '--report', str(OUT / 'worker-report.json'),
        '--contract-helper', helper])
    worker = read_json(OUT / 'worker-report.json', 4 * 1024 * 1024)
    worker_checks = require_checks(worker, 'integrated-setup-worker-v1', WORKER_CHECKS, 'native_integrated_setups')
    if set(worker.get('cases', {})) != set(INTEGRATED_CASES) or worker.get('fixture_count') != 4:
        failure('native_integrated_setups'); raise GateError('native_integrated_setups')
    print('SHIFT_AWARE_GATE_PASS native_integrated_setups', flush=True)
    gate('native_shift_aware', ['python3', '-B', '-I', str(PUBLIC / 'shift-aware-minibatches-20261125/verify_shift.py'),
        '--package-root', '/native', '--code-inputs', '/input/code-inputs.json',
        '--contract-helper', helper, '--report', str(OUT / 'shift-report.json')])
    shift = read_json(OUT / 'shift-report.json')
    shift_checks = require_checks(shift, 'shift-aware-minibatch-verification-v1', SHIFT_CHECKS, 'native_shift_aware')
    counts = shift.get('counts')
    if (shift.get('production_writes') is not False or shift.get('unique_evaluations_complete') is not True
            or not isinstance(counts, dict) or set(counts) != set(SHIFT_COUNTS)
            or any(type(item) is not int or not 0 <= item <= 1000 for item in counts.values())):
        failure('native_shift_aware'); raise GateError('native_shift_aware')
    try:
        cases = validate_shift_cases(shift.get('cases'))
    except ValueError:
        failure('native_shift_aware'); raise GateError('native_shift_aware') from None
    report = {'format': 'shift-aware-minibatch-container-v1', 'all_checks_passed': True,
        'native_eleven_verified': True, 'native_case_count': 11, 'integrated_case_count': 4,
        'shift_aware_verified': True, 'unique_evaluations_complete': True,
        'worker_checks': worker_checks, 'shift_checks': shift_checks, 'shift_counts': dict(counts),
        'shift_cases': cases}
    validate_container_report(report)
    (OUT / 'safe-report.json').write_text(json.dumps(report, separators=(',', ':')))
    print('SHIFT_AWARE_GATE_PASS native_shift_aware', flush=True)


if __name__ == '__main__':
    try:
        run()
    except Exception as error:
        phase = str(error) if type(error) is GateError and str(error) in PHASES else 'acceptance_report'
        if not (OUT / 'failure-report.json').is_file():
            failure(phase, error)
        print('SHIFT_AWARE_GATE_FAILED ' + phase)
        raise SystemExit(6)
