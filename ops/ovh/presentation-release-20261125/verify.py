"""Bounded actual-source acceptance; only public labels, booleans and hashes leave."""
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
REPO = HERE.parents[2]
sys.path.insert(0, str(HERE))
import capture
from container_gate import PRESENTATION_CHECKS, BUILD_CHAIN_CHECKS, FAILURE_GATES, safe_build_chain


def public_hashes():
    paths = set()
    for directory in ('presentation-release-20261125', 'resource-presentation-20261125', 'secondary-zoom-20261125'):
        for path in (REPO / 'ops/ovh' / directory).rglob('*'):
            if path.is_file() and path.name != 'release.json' and (
                    path.suffix in {'.py', '.mjs', '.cjs', '.js', '.ts', '.sh', '.json'} or path.name == 'Dockerfile.verify'):
                if path.is_symlink():
                    raise ValueError('public_source_path')
                paths.add(path.relative_to(REPO).as_posix())
    paths.update({
        '.github/workflows/liftorbit-presentation-verify-20261125.yml',
        '.github/workflows/liftorbit-presentation-release-20261125.yml',
        'ops/ovh/native-batching-verify-20261124/native_input_contract.py',
        'ops/ovh/integrated-setup-release-20261125/verify-build-chain.mjs',
        'ops/ovh/integrated-setup-result-20261125/patch.mjs',
        'ops/ovh/integrated-setup-result-20261125/canonical.mjs',
    })
    hashes = {}
    for name in sorted(paths):
        path = REPO / name
        if path.is_symlink() or not path.is_file():
            raise ValueError('public_source_path')
        hashes[name] = capture.digest(path.read_bytes())
    frozen = json.loads((HERE / 'baseline.json').read_bytes())['frozen_public_sources']
    if any(hashes.get(name) != expected for name, expected in frozen.items()):
        raise ValueError('frozen_public_source_drift')
    return hashes


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
    if (not isinstance(value, dict) or set(value) != {'format', 'all_checks_passed', 'presentation_checks', 'build_chain_checks'}
            or value.get('format') != 'presentation-container-v1' or value.get('all_checks_passed') is not True):
        raise ValueError('container_report')
    for key, checks in (('presentation_checks', PRESENTATION_CHECKS), ('build_chain_checks', BUILD_CHAIN_CHECKS)):
        if (not isinstance(value[key], dict) or set(value[key]) != set(checks)
                or any(item is not True for item in value[key].values())):
            raise ValueError('container_checks')


def safe_failure_report(path):
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 16384:
            return None
        value = json.loads(path.read_bytes())
        if not isinstance(value, dict) or value.get('gate') not in FAILURE_GATES:
            return None
        result = {'gate': value['gate']}
        if value['gate'] == 'actual_build_chain':
            # Reconstruct the format for a second independent sanitization.
            chain = value.get('build_chain')
            result['build_chain'] = safe_build_chain({'format': 'integrated-setup-build-chain-v1', **chain}) if isinstance(chain, dict) else None
        return result
    except (OSError, ValueError, TypeError):
        return None


def verify(app_bundle, native_hashes, image):
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', image):
        raise ValueError('runtime_image')
    report = capture.inspect_inputs(app_bundle, native_hashes)
    baseline = json.loads((HERE / 'baseline.json').read_bytes())
    if (report['app_before'] != baseline['app_hashes'] or report['protected_hashes'] != baseline['protected_hashes']
            or report['worker_hashes'] != baseline['worker_hashes']
            or report['code_inputs_sha256'] != baseline['code_inputs_sha256']):
        raise ValueError('baseline_source_drift')
    files = capture.read_bundle(app_bundle)
    with tempfile.TemporaryDirectory(prefix='presentation-private-', dir=os.environ.get('RUNNER_TEMP')) as directory:
        root = Path(directory); root.chmod(0o700)
        inputs, work = root / 'input', root / 'work'
        write_files(inputs / 'app', files)
        write_files(work / 'new/app', files)
        (work / 'out').mkdir(mode=0o700, parents=True)
        uid, gid = os.getuid(), os.getgid()
        name = 'presentation-verify-' + uuid.uuid4().hex
        command = ['docker', 'run', '--rm', '--name', name, '--network', 'none', '--read-only',
            '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user', f'{uid}:{gid}',
            '--pids-limit', '256', '--memory', '3g', '--cpus', '2',
            '--tmpfs', f'/tmp:rw,nosuid,nodev,size=536870912,uid={uid},gid={gid},mode=700',
            '--mount', f'type=bind,src={inputs},dst=/input,readonly',
            '--mount', f'type=bind,src={work},dst=/work',
            '--mount', f'type=bind,src={REPO / "ops"},dst=/public/repo/ops,readonly',
            image, 'python3', '-I', '/public/repo/ops/ovh/presentation-release-20261125/container_gate.py']
        try:
            with (root / 'container-private.log').open('wb') as log:
                result = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=log,
                    stderr=subprocess.STDOUT, timeout=600, check=False)
        finally:
            subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL, timeout=20, check=False)
        if result.returncode:
            failure = safe_failure_report(work / 'out/failure-report.json')
            if failure:
                print('PRESENTATION_RELEASE_FAILURE_METADATA ' + json.dumps(failure, separators=(',', ':')))
            raise ValueError(failure['gate'] if failure else 'container_exit')
        safe = work / 'out/safe-report.json'
        if safe.is_symlink() or not safe.is_file() or safe.stat().st_size > 16384:
            raise ValueError('container_report')
        accepted = json.loads(safe.read_bytes()); validate_container_report(accepted)
        target = work / 'new/app'
        names = {path.relative_to(target).as_posix() for path in target.rglob('*') if path.is_file()}
        if names != set(capture.APP_FILES) or any(path.is_symlink() for path in target.rglob('*')):
            raise ValueError('unexpected_app_output')
        after = {}
        for filename in capture.APP_FILES:
            path = target / filename
            if path.stat().st_size > capture.MAX_FILE:
                raise ValueError('app_output_bound')
            after[filename] = capture.digest(path.read_bytes())
        if {filename for filename in after if after[filename] != report['app_before'][filename]} != set(capture.WRITE_FILES):
            raise ValueError('exact_app_overlay')
        for filename, data in files.items():
            if filename != 'manifest.json' and (inputs / 'app' / filename).read_bytes() != data:
                raise ValueError('input_changed')
        report.update(status='presentation_pass', release_gate_complete=True, app_after=after,
            presentation_checks=accepted['presentation_checks'], build_chain_checks=accepted['build_chain_checks'],
            runtime_image=image, public_sources=public_hashes())
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--app-bundle', required=True, type=Path)
    parser.add_argument('--native-hashes', required=True, type=Path)
    parser.add_argument('--image-id', required=True)
    args = parser.parse_args()
    try:
        report = verify(args.app_bundle, args.native_hashes, args.image_id)
        print('PRESENTATION_RELEASE_VERIFICATION ' + json.dumps(report, separators=(',', ':')))
    except Exception as error:
        allowed = {*FAILURE_GATES, 'runtime_image', 'container_report', 'container_checks', 'container_exit',
            'baseline_source_drift', 'unexpected_app_output', 'app_output_bound', 'exact_app_overlay', 'input_changed'}
        label = str(error) if isinstance(error, ValueError) and str(error) in allowed else 'verification_failed'
        print('PRESENTATION_RELEASE_VERIFICATION_FAILED ' + label)
        raise SystemExit(6)
