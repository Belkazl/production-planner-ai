"""Run the combined presentation checks and captured builds without networking."""
import json
from pathlib import Path
import subprocess
import sys

PUBLIC = Path('/public/repo/ops/ovh')
WORK = Path('/work')
APP = WORK / 'new/app'
OUT = WORK / 'out'
ZOOM_LABEL_CHECKS = (
    'label_synthetic_passed', 'resource_synthetic_passed', 'zoom_synthetic_passed', 'exact_insertion_actual_source_passed',
    'retired_preview_synthetic_passed', 'projection_synthetic_passed',
    'retired_preview_actual_source_passed', 'projection_actual_source_passed', 'combined_actual_source_passed',
    'ui_syntax_passed', 'actual_build_tests_passed', 'all_zoom_label_checks_passed',
)
BUILD_CHAIN_CHECKS = (
    'all_checks_passed', 'original_inputs_unchanged', 'build_bridge_passed',
    'feature_stop_passed', 'bundle_passed', 'native_bypass_preserved',
    'abort_signal_preserved', 'stop_guards_preserved',
)
FAILURE_GATES = frozenset({
    'zoom_label_patch', 'label_synthetic', 'resource_synthetic', 'zoom_synthetic', 'exact_insertion_actual_source',
    'retired_preview_synthetic', 'projection_synthetic', 'retired_preview_actual_source',
    'projection_actual_source', 'combined_actual_source', 'label_actual_patch',
    'ui_syntax', 'actual_build_tests', 'actual_build_chain', 'acceptance_report', 'unexpected_gate',
})
BUILD_PHASES = frozenset({'input', 'build_bridge', 'feature_stop', 'generated_contract', 'bundle', 'source_integrity'})
BUILD_FAILURES = frozenset({'source_path', 'source_file', 'source_changed', 'copy_integrity',
    'runner_unavailable', 'runner_timeout', 'runner_output_limit', 'build_bridge_failed',
    'feature_stop_failed', 'bundle_failed', 'generated_file', 'native_bypass_count',
    'abort_signal_missing', 'stop_guards_missing', 'unexpected'})


class GateError(Exception):
    pass


def safe_build_chain(value):
    if (not isinstance(value, dict) or value.get('format') != 'integrated-setup-build-chain-v1'
            or any(type(value.get(key)) is not bool for key in BUILD_CHAIN_CHECKS)):
        return None
    phase, code = value.get('failure_phase'), value.get('failure_code')
    return {**{key: value[key] for key in BUILD_CHAIN_CHECKS},
        'failure_phase': phase if isinstance(phase, str) and phase in BUILD_PHASES else None,
        'failure_code': code if isinstance(code, str) and code in BUILD_FAILURES else None}


def failure_metadata(label):
    value = {'gate': label if label in FAILURE_GATES else 'unexpected_gate'}
    if label == 'actual_build_chain':
        path = OUT / 'build-chain-report.json'
        try:
            if path.is_file() and not path.is_symlink() and path.stat().st_size <= 16384:
                value['build_chain'] = safe_build_chain(json.loads(path.read_bytes()))
        except (OSError, ValueError, TypeError):
            pass
    (OUT / 'failure-report.json').write_text(json.dumps(value, separators=(',', ':')))


def gate(label, command, extra_env=None):
    env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE': '1',
           'TMPDIR': '/tmp', **(extra_env or {})}
    try:
        with (OUT / (label + '-private.log')).open('wb') as log:
            result = subprocess.run(command, env=env, cwd=APP, stdin=subprocess.DEVNULL,
                stdout=log, stderr=subprocess.STDOUT, timeout=180, check=False)
        if result.returncode:
            failure_metadata(label)
            raise GateError(label)
    except (OSError, subprocess.TimeoutExpired):
        failure_metadata(label)
        raise GateError(label) from None


def main():
    OUT.mkdir(mode=0o700, exist_ok=True)
    own = PUBLIC / 'zoom-label-release-20261125'
    gate('zoom_label_patch', ['node', str(own / 'patch.mjs'), str(APP)])
    gate('label_synthetic', ['node', '--test', str(PUBLIC / 'zoom-label-sync-20261125/test.mjs')])
    gate('retired_preview_synthetic', ['node', '--test', str(PUBLIC / 'native-preview-presentation-20261125/test.mjs')])
    gate('projection_synthetic', ['node', '--test', str(PUBLIC / 'native-preview-projection-20261125/test.mjs')])
    gate('resource_synthetic', ['node', '--test', str(PUBLIC / 'resource-presentation-20261125/test.mjs')])
    gate('zoom_synthetic', ['node', str(PUBLIC / 'secondary-zoom-20261125/test.mjs')])
    # The frozen label-only test has an exact before/after contract. Exercise it
    # on its own private copy, then separately require the final combined bytes.
    label_only = WORK / 'label-only'
    label_only.mkdir(mode=0o700)
    gate('label_actual_patch', ['node', str(PUBLIC / 'zoom-label-sync-20261125/zoom-label.mjs'),
        '/input/app/restart-optimizer-ui.js', str(label_only / 'restart-optimizer-ui.js')])
    gate('exact_insertion_actual_source', ['node', '--test', str(PUBLIC / 'zoom-label-sync-20261125/test.mjs')],
        {'LIFTORBIT_ZOOM_LABEL_FIXTURE_ROOT': '/input/app', 'LIFTORBIT_ZOOM_LABEL_PATCHED_ROOT': str(label_only)})
    gate('retired_preview_actual_source', ['node', '--test', str(PUBLIC / 'native-preview-presentation-20261125/test.mjs')],
        {'LIFTORBIT_NATIVE_PREVIEW_APP_ROOT': '/input/app'})
    gate('projection_actual_source', ['node', '--test', str(PUBLIC / 'native-preview-projection-20261125/test.mjs')],
        {'LIFTORBIT_NATIVE_PREVIEW_APP_FIXTURE_ROOT': '/input/app'})
    gate('combined_actual_source', ['node', '--test', str(own / 'test_combined.mjs')],
        {'LIFTORBIT_PRESENTATION_COMBINED_BEFORE': '/input/app', 'LIFTORBIT_PRESENTATION_COMBINED_AFTER': str(APP)})
    gate('ui_syntax', ['node', '--check', str(APP / 'restart-optimizer-ui.js')])
    # Frozen verifier executes the actual build-bridge, feature-stop and Bun
    # bundle in a temporary private copy. It never starts the generated server.
    gate('actual_build_chain', ['node', str(PUBLIC / 'integrated-setup-release-20261125/verify-build-chain.mjs'),
        str(APP), str(OUT / 'build-chain-report.json')])
    path = OUT / 'build-chain-report.json'
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 16384:
        raise GateError('acceptance_report')
    chain = safe_build_chain(json.loads(path.read_bytes()))
    if not chain or any(chain[key] is not True for key in BUILD_CHAIN_CHECKS):
        raise GateError('acceptance_report')
    # Both captured fixtures are already accepted. This release may not repair,
    # replace or weaken them to manufacture a passing presentation-only gate.
    gate('actual_build_tests', ['bun', 'test', 'tests/python-ga-upstream.test.mjs', 'tests/python-ga-state.test.mjs'])
    report = {'format': 'zoom-label-container-v1', 'all_checks_passed': True,
        'zoom_label_checks': dict.fromkeys(ZOOM_LABEL_CHECKS, True),
        'build_chain_checks': {key: True for key in BUILD_CHAIN_CHECKS}}
    (OUT / 'safe-report.json').write_text(json.dumps(report, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        label = str(error) if isinstance(error, GateError) and str(error) in FAILURE_GATES else 'unexpected_gate'
        print('ZOOM_LABEL_RELEASE_GATE_FAILED ' + label)
        raise SystemExit(6)
