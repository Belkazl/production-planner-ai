"""Fixed code-only app capture; private contents never enter the public report."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import sys
import tarfile

ROOT = Path('/home/liftorbit-ci/liftorbit-migration')
APP = ROOT / 'sources/ovh-app/current'
APP_FILES = (
    'python-ga-upstream.mjs',
    'baselines/2026-10-10/aps-setup-bridge/index.ts',
    'restart-optimizer-ui.js', 'Dockerfile', 'build-bridge.ts',
    'tenant-model-build.ts', 'ga-worker-build.ts', 'python-ga-upstream-build.ts',
    'tests/python-ga-upstream.test.mjs', 'tests/python-ga-state.test.mjs', 'ga-python-state-store.mjs',
)
WRITE_FILES = APP_FILES[:3]
BUILD_TEST_FILES = ('tests/python-ga-upstream.test.mjs', 'tests/python-ga-state.test.mjs')
ALLOWED_WRITES = (*WRITE_FILES, *BUILD_TEST_FILES)
PROTECTED_FILES = ('auth-runtime.js',)
MAX_FILE = 4 * 1024 * 1024
MAX_BUNDLE = 40 * 1024 * 1024
SHA = re.compile(r'[0-9a-f]{64}\Z')
ANCHORS = {
    'python-ga-upstream.mjs': {
        'public_plan': 'const publicPlan = plan => {',
        'setup_loss_guard': 'setupOperationsDropped',
        'verified_checkpoint': '_pp_verified_checkpoint_v1',
        'same_account_header': "'x-authenticated-account':principal",
        'job_scoped_progress': 'async function progress(req, expectedJob=null)',
        'first_preview': 'firstPreviewPending',
        'joint_continuation': 'pp_native_batching_continuation_v1',
    },
    'baselines/2026-10-10/aps-setup-bridge/index.ts': {
        'convert_one': 'function convertOne(base,model,seed){',
        'progress_route': 'async function progress(req){',
        'plan_route': 'async function plan(req){',
        'legacy_setup_search': 'searchWithSetup(',
        'observed_best': 'ppPreferObservedObjectivePlan',
    },
    'restart-optimizer-ui.js': {
        'selected_batch_seed': 'batch_genome',
        'quality_floor': 'ppGaQualityFloorV1',
    },
}


class CaptureError(Exception):
    pass


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_owned(path, maximum=MAX_FILE):
    if path.is_symlink() or not path.parent.resolve(strict=True).is_relative_to(ROOT.resolve(strict=True)):
        raise CaptureError('source_path')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if (not stat.S_ISREG(before.st_mode) or before.st_uid not in (0, os.getuid())
                or not 0 < before.st_size <= maximum):
            raise CaptureError('source_file')
        data = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
        if (len(data) != before.st_size or len(data) > maximum
                or (before.st_size, before.st_mtime_ns, before.st_ino, before.st_dev)
                != (after.st_size, after.st_mtime_ns, after.st_ino, after.st_dev)):
            raise CaptureError('source_changed')
        return data


def capture():
    files = {name: read_owned(APP / name) for name in APP_FILES}
    if sum(map(len, files.values())) > MAX_BUNDLE:
        raise CaptureError('source_bound')
    manifest = {
        'format': 'integrated-setup-app-inputs-v1',
        'app_hashes': {name: digest(data) for name, data in files.items()},
        'protected_hashes': {name: digest(read_owned(APP / name)) for name in PROTECTED_FILES},
    }
    return dict(files, **{'manifest.json': json.dumps(manifest, separators=(',', ':')).encode()})


def write_bundle(stream, files):
    with tarfile.open(fileobj=stream, mode='w|', format=tarfile.USTAR_FORMAT) as archive:
        for name, data in files.items():
            member = tarfile.TarInfo(name)
            member.size, member.mode, member.mtime = len(data), 0o600, 0
            archive.addfile(member, io.BytesIO(data))


def read_bundle(path, native=False):
    if path.is_symlink():
        raise CaptureError('bundle_path')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        maximum = 72 * 1024 * 1024 if native else MAX_BUNDLE
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= maximum:
            raise CaptureError('bundle_bound')
        files = {}
        with tarfile.open(fileobj=stream, mode='r:') as archive:
            for member in archive:
                allowed = (member.name in ('manifest.json', 'code-inputs.json') or
                           bool(re.fullmatch(r'ga_workers/[A-Za-z_][A-Za-z0-9_]*\.py', member.name))) if native else member.name in (*APP_FILES, 'manifest.json')
                limit = 32 * 1024 * 1024 if native and member.name == 'code-inputs.json' else MAX_FILE
                if (not allowed or member.name in files or not member.isfile()
                        or member.type != tarfile.REGTYPE or member.linkname or member.pax_headers
                        or not 0 < member.size <= limit):
                    raise CaptureError('bundle_member')
                reader = archive.extractfile(member)
                if reader is None:
                    raise CaptureError('bundle_member')
                with reader:
                    data = reader.read(limit + 1)
                if len(data) != member.size or len(data) > limit:
                    raise CaptureError('bundle_member_bound')
                files[member.name] = data
                if len(files) > 66 or sum(map(len, files.values())) > maximum:
                    raise CaptureError('bundle_total_bound')
    return files


def inspect_inputs(app_bundle, native_bundle):
    files = read_bundle(app_bundle)
    if set(files) != {*APP_FILES, 'manifest.json'}:
        raise CaptureError('app_files')
    manifest = json.loads(files['manifest.json'])
    before = {name: digest(files[name]) for name in APP_FILES}
    if (set(manifest) != {'format', 'app_hashes', 'protected_hashes'}
            or manifest['format'] != 'integrated-setup-app-inputs-v1'
            or manifest['app_hashes'] != before
            or set(manifest['protected_hashes']) != set(PROTECTED_FILES)
            or any(not isinstance(value, str) or not SHA.fullmatch(value) for value in manifest['protected_hashes'].values())):
        raise CaptureError('app_manifest')
    native = read_bundle(native_bundle, native=True)
    if not {'manifest.json', 'code-inputs.json', 'ga_workers/compile_legacy_ga.py',
            'ga_workers/full_runtime_adapter.py', 'ga_workers/joint_minibatch.py',
            'ga_workers/joint_continuation.py'}.issubset(native):
        raise CaptureError('native_files')
    provenance = json.loads(native['manifest.json'])
    worker_hashes = {name: digest(data) for name, data in native.items() if name.startswith('ga_workers/')}
    code_hash = digest(native['code-inputs.json'])
    if (provenance.get('format') != 'ephemeral-native-code-inputs-v1'
            or provenance.get('source_hashes') != worker_hashes
            or provenance.get('code_inputs_sha256') != code_hash
            or provenance.get('compiler_sha256') != worker_hashes.get('ga_workers/compile_legacy_ga.py')):
        raise CaptureError('native_manifest')
    anchors = {name: {label: files[name].decode('utf-8').count(anchor) for label, anchor in wanted.items()}
               for name, wanted in ANCHORS.items()}
    docker = files['Dockerfile'].decode('utf-8')
    known_tests = ('account-model-boundary.cjs', 'password-reset-security.mjs', 'early-stop-contract.cjs',
                   'continuation-compat-contract.cjs', 'async-plan-transport-contract.cjs',
                   'ga-process-workers.cjs', 'python-ga-upstream.test.mjs', 'python-ga-state.test.mjs')
    build_tests = sorted(name for name in known_tests if ('tests/' + name) in docker)
    return {
        'format': 'integrated-setup-acceptance-v1', 'status': 'capture_only',
        'release_gate_complete': False, 'production_writes': False,
        'app_before': before, 'app_after': before,
        'protected_hashes': manifest['protected_hashes'],
        'worker_hashes': worker_hashes, 'code_inputs_sha256': code_hash,
        'source_anchors': anchors,
        'known_build_tests': build_tests,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--emit-private-bundle', action='store_true')
    parser.add_argument('--app-bundle', type=Path)
    parser.add_argument('--native-bundle', type=Path)
    args = parser.parse_args()
    try:
        if args.emit_private_bundle and not args.app_bundle and not args.native_bundle:
            if sys.stdout.isatty():
                raise CaptureError('binary_terminal')
            write_bundle(sys.stdout.buffer, capture())
        elif not args.emit_private_bundle and args.app_bundle and args.native_bundle:
            print('INTEGRATED_SETUP_VERIFICATION ' + json.dumps(inspect_inputs(args.app_bundle, args.native_bundle), separators=(',', ':')))
        else:
            raise CaptureError('invocation')
    except Exception as error:
        label = str(error) if isinstance(error, CaptureError) else 'unexpected_input'
        print('INTEGRATED_SETUP_CAPTURE_FAILED ' + label, file=sys.stderr)
        raise SystemExit(6)


if __name__ == '__main__':
    main()
