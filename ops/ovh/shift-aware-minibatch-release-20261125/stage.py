"""Reproduce the one accepted native artifact without executing native code."""
import argparse
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from contract import OPS, TARGET, digest, native_bundle
from release_guard import load_marker
from verify import app_manifest, build_overlay


def stage(marker, root):
    app = app_manifest(root / 'app-hashes.json')
    files, before, code_hash = native_bundle(root / 'native.bundle')
    if (app['app_hashes'] != marker['app_hashes'] or app['protected_hashes'] != marker['protected_hashes']
            or before != marker['worker_before'] or code_hash != marker['code_inputs_sha256']):
        raise ValueError('stage_original_hashes')
    after = build_overlay(files, root / 'candidate', root / 'stage-private.log')
    if after != marker['worker_after']:
        raise ValueError('stage_accepted_artifact_mismatch')
    target = root / 'new/ga/joint_minibatch.py'
    target.parent.mkdir(mode=0o700, parents=True)
    target.write_bytes((root / 'candidate' / TARGET).read_bytes()); target.chmod(0o600)
    rows = [('PRESERVE', 'app/' + name, sha, sha) for name, sha in marker['app_hashes'].items()]
    rows += [('PRESERVE', 'app/' + name, sha, sha) for name, sha in marker['protected_hashes'].items()]
    rows += [('WRITE' if name == TARGET else 'PRESERVE', 'ga/' + name.removeprefix('ga_workers/'), sha, after[name])
             for name, sha in before.items()]
    (root / 'manifest.tsv').write_text(''.join('\t'.join(row) + '\n' for row in rows))
    (root / 'code-inputs.sha256').write_text(code_hash + '\n')
    helper = OPS / 'native-batching-verify-20261124/native_input_contract.py'
    (root / 'native-contract.sha256').write_text(digest(helper.read_bytes()) + '\n')
    print('SHIFT_AWARE_EXACT_ARTIFACT_VERIFIED writes=1')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('marker', type=Path); parser.add_argument('stage', type=Path)
    args = parser.parse_args()
    try:
        stage(load_marker(args.marker), args.stage)
    except Exception:
        print('SHIFT_AWARE_STAGE_REJECTED')
        raise SystemExit(6)
