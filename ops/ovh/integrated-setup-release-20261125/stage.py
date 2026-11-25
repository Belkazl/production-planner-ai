"""Reproduce accepted runtime and necessary fixture bytes; never execute native code."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(HERE))
import capture
from verify import write_files
from release_guard import load_marker


def stage(marker, root):
    files = capture.read_bundle(root / 'app.bundle')
    if set(files) != {*capture.APP_FILES, 'manifest.json'}:
        raise ValueError('stage_sources')
    manifest = json.loads(files['manifest.json'])
    before = {name: capture.digest(files[name]) for name in capture.APP_FILES}
    if (manifest.get('format') != 'integrated-setup-app-inputs-v1' or manifest.get('app_hashes') != before
            or before != marker['app_before'] or manifest.get('protected_hashes') != marker['protected_hashes']):
        raise ValueError('stage_original_hashes')
    write_files(root / 'old/app', files)
    write_files(root / 'new/app', files)
    app = root / 'new/app'
    env = {'PATH': os.environ.get('PATH', '/usr/local/bin:/usr/bin:/bin')}
    commands = [
        ['node', str(REPO / 'ops/ovh/integrated-setup-result-20261125/patch.mjs'), str(app)],
        ['node', str(REPO / 'ops/ovh/integrated-setup-preview-20261125/patch.mjs'), str(app / 'python-ga-upstream.mjs'), str(app / 'python-ga-upstream.mjs')],
    ]
    if marker['build_fixtures_updated']:
        commands.append(['node', str(REPO / 'ops/ovh/integrated-setup-result-20261125/build-fixtures.mjs'), str(app)])
    commands += [['node', '--check', str(app / name)] for name in
                 ('python-ga-upstream.mjs', 'restart-optimizer-ui.js', *capture.BUILD_TEST_FILES)]
    with (root / 'stage-private.log').open('wb') as log:
        for command in commands:
            subprocess.run(command, env=env, cwd=app, stdout=log, stderr=subprocess.STDOUT, timeout=45, check=True)
    names = {path.relative_to(app).as_posix() for path in app.rglob('*') if path.is_file()}
    if names != set(capture.APP_FILES) or any(path.is_symlink() for path in app.rglob('*')):
        raise ValueError('stage_extra_files')
    after = {name: capture.digest((app / name).read_bytes()) for name in capture.APP_FILES}
    if after != marker['app_after']:
        raise ValueError('stage_accepted_artifact_mismatch')
    rows = [('WRITE' if before[name] != after[name] else 'PRESERVE', 'app/' + name, before[name], after[name]) for name in capture.APP_FILES]
    rows += [('PRESERVE', 'app/' + name, sha, sha) for name, sha in marker['protected_hashes'].items()]
    rows += [('PRESERVE', 'ga/' + name.removeprefix('ga_workers/'), sha, sha) for name, sha in marker['worker_hashes'].items()]
    (root / 'manifest.tsv').write_text(''.join('\t'.join(row) + '\n' for row in rows))
    (root / 'code-inputs.sha256').write_text(marker['code_inputs_sha256'] + '\n')
    contract = REPO / 'ops/ovh/native-batching-verify-20261124/native_input_contract.py'
    (root / 'native-contract.sha256').write_text(capture.digest(contract.read_bytes()) + '\n')
    print('INTEGRATED_SETUP_EXACT_APP_ARTIFACT_VERIFIED writes=' + str(sum(row[0] == 'WRITE' for row in rows)))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('marker', type=Path); parser.add_argument('stage', type=Path)
    args = parser.parse_args()
    try:
        stage(load_marker(args.marker), args.stage)
    except Exception:
        print('INTEGRATED_SETUP_STAGE_REJECTED')
        raise SystemExit(6)
