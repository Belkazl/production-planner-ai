"""Read-only verification of the accepted app manifest and preserved native code."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys

sys.dont_write_bytecode = True

ROOT = Path('/home/liftorbit-ci/liftorbit-migration')
APP = ROOT / 'sources/ovh-app/current'
GA = ROOT / 'sources/current/ga/ga_workers'
APP_NAMES = {'python-ga-upstream.mjs', 'baselines/2026-10-10/aps-setup-bridge/index.ts',
    'restart-optimizer-ui.js', 'Dockerfile', 'build-bridge.ts', 'tenant-model-build.ts',
    'ga-worker-build.ts', 'python-ga-upstream-build.ts', 'auth-runtime.js',
    'tests/python-ga-upstream.test.mjs', 'tests/python-ga-state.test.mjs', 'ga-python-state-store.mjs',
    'feature-stop.ts', 'stop-ui.js'}
WRITES = {'app/python-ga-upstream.mjs', 'app/baselines/2026-10-10/aps-setup-bridge/index.ts', 'app/restart-optimizer-ui.js'}
FIXTURE_WRITES = {'app/tests/python-ga-upstream.test.mjs', 'app/tests/python-ga-state.test.mjs'}
SHA = re.compile('[0-9a-f]{64}\\Z')


def read_regular(path, maximum=4 * 1024 * 1024):
    if path.is_symlink() or not path.parent.resolve(strict=True).is_relative_to(ROOT.resolve(strict=True)):
        raise ValueError()
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_uid not in (0, os.getuid()) or not 0 < before.st_size <= maximum:
            raise ValueError()
        data = stream.read(maximum + 1); after = os.fstat(stream.fileno())
        if (len(data) != before.st_size or len(data) > maximum
                or (before.st_size, before.st_mtime_ns, before.st_ino, before.st_dev)
                != (after.st_size, after.st_mtime_ns, after.st_ino, after.st_dev)):
            raise ValueError()
        return data


def sha(path):
    return hashlib.sha256(read_regular(path)).hexdigest()


def manifest_rows(data):
    if not isinstance(data, bytes) or len(data) > 32768:
        raise ValueError()
    rows = [line.split('\t') for line in data.decode('ascii').splitlines()]
    if not 21 <= len(rows) <= 78 or any(len(row) != 4 for row in rows) or len({row[1] for row in rows}) != len(rows):
        raise ValueError()
    writes = {name for role, name, _, _ in rows if role == 'WRITE'}
    if writes not in (WRITES, WRITES | FIXTURE_WRITES):
        raise ValueError()
    if {name[4:] for _, name, _, _ in rows if name.startswith('app/')} != APP_NAMES:
        raise ValueError()
    for role, name, before, after in rows:
        if role not in {'WRITE', 'PRESERVE'} or not SHA.fullmatch(before) or not SHA.fullmatch(after):
            raise ValueError()
        if role == 'PRESERVE' and before != after:
            raise ValueError()
        if role == 'WRITE' and before == after:
            raise ValueError()
        if not ((name.startswith('app/') and name[4:] in APP_NAMES)
                or (re.fullmatch(r'ga/[A-Za-z_][A-Za-z0-9_]*\.py', name) and role == 'PRESERVE')):
            raise ValueError()
    return rows


def verify(stage, phase):
    if stage.parent != ROOT / 'sources/ovh-app' or not re.fullmatch(r'integrated-setup-release-20261125-[0-9]{1,16}-[0-9]{1,4}', stage.name):
        raise ValueError()
    rows = manifest_rows(read_regular(stage / 'manifest.tsv', 32768))
    workers = {}
    for role, name, before, after in rows:
        if name.startswith('app/'):
            target = APP / name[4:]
        else:
            target = GA / name[3:]; workers['ga_workers/' + name[3:]] = before
        if sha(target) != (before if phase == 'old' else after):
            raise ValueError()
        if role == 'WRITE' and sha(stage / name) != after:
            raise ValueError()
    helper = stage / 'native_input_contract.py'
    expected_helper = read_regular(stage / 'native-contract.sha256', 128).decode('ascii').strip()
    if not SHA.fullmatch(expected_helper) or sha(helper) != expected_helper:
        raise ValueError()
    spec = importlib.util.spec_from_file_location('reviewed_native_input_contract', helper)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    selected, manifest, _ = module.load_owned_inputs()
    if manifest['source_hashes'] != workers:
        raise ValueError()
    expected_code = read_regular(stage / 'code-inputs.sha256', 128).decode('ascii').strip()
    actual_code = hashlib.sha256(json.dumps(selected, separators=(',', ':')).encode()).hexdigest()
    if not SHA.fullmatch(expected_code) or expected_code != actual_code:
        raise ValueError()
    print('INTEGRATED_SETUP_APP_NATIVE_AUTH_HASHES_VERIFIED ' + phase)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('stage', type=Path); parser.add_argument('phase', choices=('old', 'new'))
    args = parser.parse_args()
    try:
        verify(args.stage, args.phase)
    except Exception:
        print('INTEGRATED_SETUP_REMOTE_SOURCE_CONTRACT_REJECTED')
        raise SystemExit(6)
