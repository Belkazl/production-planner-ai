"""Capture a fixed app source allowlist; native/auth inputs leave only as hashes."""
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
    'python-ga-upstream.mjs', 'baselines/2026-10-10/aps-setup-bridge/index.ts',
    'restart-optimizer-ui.js', 'Dockerfile', 'build-bridge.ts',
    'tenant-model-build.ts', 'ga-worker-build.ts', 'python-ga-upstream-build.ts',
    'tests/python-ga-upstream.test.mjs', 'tests/python-ga-state.test.mjs',
    'ga-python-state-store.mjs', 'feature-stop.ts', 'stop-ui.js',
)
WRITE_FILES = ('restart-optimizer-ui.js',)
ALLOWED_WRITES = WRITE_FILES
BUILD_TEST_FILES = ('tests/python-ga-upstream.test.mjs', 'tests/python-ga-state.test.mjs')
PROTECTED_FILES = ('auth-runtime.js',)
MAX_FILE = 4 * 1024 * 1024
MAX_BUNDLE = 40 * 1024 * 1024
SHA = re.compile(r'[0-9a-f]{64}\Z')


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
    manifest = {'format': 'zoom-label-app-inputs-v1',
        'app_hashes': {name: digest(data) for name, data in files.items()},
        'protected_hashes': {name: digest(read_owned(APP / name)) for name in PROTECTED_FILES}}
    return dict(files, **{'manifest.json': json.dumps(manifest, separators=(',', ':')).encode()})


def write_bundle(stream, files):
    with tarfile.open(fileobj=stream, mode='w|', format=tarfile.USTAR_FORMAT) as archive:
        for name, data in files.items():
            member = tarfile.TarInfo(name)
            member.size, member.mode, member.mtime = len(data), 0o600, 0
            archive.addfile(member, io.BytesIO(data))


def read_bundle(path):
    if path.is_symlink():
        raise CaptureError('bundle_path')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= MAX_BUNDLE:
            raise CaptureError('bundle_bound')
        files = {}
        with tarfile.open(fileobj=stream, mode='r:') as archive:
            for member in archive:
                if (member.name not in (*APP_FILES, 'manifest.json') or member.name in files
                        or not member.isfile() or member.type != tarfile.REGTYPE or member.linkname
                        or member.pax_headers or not 0 < member.size <= MAX_FILE):
                    raise CaptureError('bundle_member')
                reader = archive.extractfile(member)
                if reader is None:
                    raise CaptureError('bundle_member')
                with reader:
                    data = reader.read(MAX_FILE + 1)
                if len(data) != member.size or len(data) > MAX_FILE:
                    raise CaptureError('bundle_member_bound')
                files[member.name] = data
                if len(files) > len(APP_FILES) + 1 or sum(map(len, files.values())) > MAX_BUNDLE:
                    raise CaptureError('bundle_total_bound')
    return files


def read_native_hashes(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 16384:
        raise CaptureError('native_hash_bound')
    value = json.loads(path.read_bytes())
    if (not isinstance(value, dict) or set(value) != {'format', 'worker_hashes', 'code_inputs_sha256'}
            or value['format'] != 'zoom-label-native-hashes-v1'
            or not isinstance(value['worker_hashes'], dict) or not 5 <= len(value['worker_hashes']) <= 64
            or any(not re.fullmatch(r'ga_workers/[A-Za-z_][A-Za-z0-9_]*\.py', name)
                   or not isinstance(sha, str) or not SHA.fullmatch(sha)
                   for name, sha in value['worker_hashes'].items())
            or not isinstance(value['code_inputs_sha256'], str) or not SHA.fullmatch(value['code_inputs_sha256'])):
        raise CaptureError('native_hash_manifest')
    return value


def inspect_inputs(app_bundle, native_hashes):
    files = read_bundle(app_bundle)
    if set(files) != {*APP_FILES, 'manifest.json'}:
        raise CaptureError('app_files')
    manifest = json.loads(files['manifest.json'])
    before = {name: digest(files[name]) for name in APP_FILES}
    if (set(manifest) != {'format', 'app_hashes', 'protected_hashes'}
            or manifest['format'] != 'zoom-label-app-inputs-v1' or manifest['app_hashes'] != before
            or set(manifest['protected_hashes']) != set(PROTECTED_FILES)
            or any(not isinstance(value, str) or not SHA.fullmatch(value) for value in manifest['protected_hashes'].values())):
        raise CaptureError('app_manifest')
    native = read_native_hashes(native_hashes)
    return {'format': 'zoom-label-acceptance-v1', 'status': 'capture_only',
        'release_gate_complete': False, 'production_writes': False,
        'app_before': before, 'app_after': before, 'protected_hashes': manifest['protected_hashes'],
        'worker_hashes': native['worker_hashes'], 'code_inputs_sha256': native['code_inputs_sha256']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--emit-private-bundle', action='store_true')
    args = parser.parse_args()
    try:
        if not args.emit_private_bundle or sys.stdout.isatty():
            raise CaptureError('binary_terminal')
        write_bundle(sys.stdout.buffer, capture())
    except Exception as error:
        label = str(error) if isinstance(error, CaptureError) else 'unexpected_input'
        print('ZOOM_LABEL_RELEASE_CAPTURE_FAILED ' + label, file=sys.stderr)
        raise SystemExit(6)
