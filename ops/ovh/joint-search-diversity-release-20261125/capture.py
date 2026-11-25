"""Read-only, fixed app/auth SHA capture; no application source leaves the host."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

ROOT = Path('/home/liftorbit-ci/liftorbit-migration')
APP = ROOT / 'sources/ovh-app/current'
APP_FILES = (
    'python-ga-upstream.mjs', 'baselines/2026-10-10/aps-setup-bridge/index.ts',
    'restart-optimizer-ui.js', 'Dockerfile', 'build-bridge.ts', 'tenant-model-build.ts',
    'ga-worker-build.ts', 'python-ga-upstream-build.ts', 'tests/python-ga-upstream.test.mjs',
    'tests/python-ga-state.test.mjs', 'ga-python-state-store.mjs', 'feature-stop.ts', 'stop-ui.js',
)
PROTECTED_FILES = ('auth-runtime.js',)


def read_owned(path):
    if path.is_symlink() or not path.parent.resolve(strict=True).is_relative_to(ROOT.resolve(strict=True)):
        raise ValueError('source_path')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_uid not in (0, os.getuid()) or not 0 < before.st_size <= 4 * 1024 * 1024:
            raise ValueError('source_kind')
        data = stream.read(4 * 1024 * 1024 + 1); after = os.fstat(stream.fileno())
        if (len(data) != before.st_size or (before.st_size, before.st_mtime_ns, before.st_ino, before.st_dev)
                != (after.st_size, after.st_mtime_ns, after.st_ino, after.st_dev)):
            raise ValueError('source_changed')
        return data


def capture():
    return {'format': 'joint-search-diversity-app-hashes-v1',
        'app_hashes': {name: hashlib.sha256(read_owned(APP / name)).hexdigest() for name in APP_FILES},
        'protected_hashes': {name: hashlib.sha256(read_owned(APP / name)).hexdigest() for name in PROTECTED_FILES}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--app-hashes', action='store_true')
    args = parser.parse_args()
    try:
        if not args.app_hashes:
            raise ValueError('invocation')
        print(json.dumps(capture(), separators=(',', ':')))
    except Exception:
        print('JOINT_DIVERSITY_APP_HASH_CAPTURE_FAILED', file=sys.stderr)
        raise SystemExit(6)
