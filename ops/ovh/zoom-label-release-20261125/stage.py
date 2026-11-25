"""Reproduce the accepted single UI insertion privately; never execute native code."""
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
    if (set(manifest) != {'format', 'app_hashes', 'protected_hashes'}
            or manifest.get('format') != 'zoom-label-app-inputs-v1'
            or manifest.get('app_hashes') != before or before != marker['app_before']
            or manifest.get('protected_hashes') != marker['protected_hashes']):
        raise ValueError('stage_original_hashes')
    write_files(root / 'old/app', files)
    write_files(root / 'new/app', files)
    app = root / 'new/app'
    commands = [['node', str(HERE / 'patch.mjs'), str(app)],
                ['node', '--check', str(app / 'restart-optimizer-ui.js')]]
    with (root / 'stage-private.log').open('wb') as log:
        for command in commands:
            subprocess.run(command, env={'PATH': os.environ.get('PATH', '/usr/local/bin:/usr/bin:/bin')},
                cwd=app, stdout=log, stderr=subprocess.STDOUT, timeout=45, check=True)
    names = {path.relative_to(app).as_posix() for path in app.rglob('*') if path.is_file()}
    if names != set(capture.APP_FILES) or any(path.is_symlink() for path in app.rglob('*')):
        raise ValueError('stage_extra_files')
    after = {name: capture.digest((app / name).read_bytes()) for name in capture.APP_FILES}
    if after != marker['app_after'] or {name for name in after if before[name] != after[name]} != set(capture.WRITE_FILES):
        raise ValueError('stage_accepted_artifact_mismatch')
    rows = [('WRITE' if before[name] != after[name] else 'PRESERVE', 'app/' + name, before[name], after[name]) for name in capture.APP_FILES]
    rows += [('PRESERVE', 'app/' + name, sha, sha) for name, sha in marker['protected_hashes'].items()]
    rows += [('PRESERVE', 'ga/' + name.removeprefix('ga_workers/'), sha, sha) for name, sha in marker['worker_hashes'].items()]
    (root / 'manifest.tsv').write_text(''.join('\t'.join(row) + '\n' for row in rows))
    (root / 'code-inputs.sha256').write_text(marker['code_inputs_sha256'] + '\n')
    contract = REPO / 'ops/ovh/native-batching-verify-20261124/native_input_contract.py'
    (root / 'native-contract.sha256').write_text(capture.digest(contract.read_bytes()) + '\n')
    print('ZOOM_LABEL_RELEASE_EXACT_APP_ARTIFACT_VERIFIED writes=1')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('marker', type=Path); parser.add_argument('stage', type=Path)
    args = parser.parse_args()
    try:
        stage(load_marker(args.marker), args.stage)
    except Exception:
        print('ZOOM_LABEL_RELEASE_STAGE_REJECTED')
        raise SystemExit(6)
