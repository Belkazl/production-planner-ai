"""Reproduce the accepted native artifact from public source and live hash metadata."""
import argparse
from pathlib import Path
import runpy
import sys

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from contract import OPS, SHA, TARGET, digest, hashes, read_json, validate_worker_change
from release_guard import load_marker
from verify import app_manifest


def native_manifest(path):
    value = read_json(path, 16384)
    if (not isinstance(value, dict) or set(value) != {'format', 'worker_hashes', 'code_inputs_sha256'}
            or value['format'] != 'shift-aware-native-hashes-v1'
            or not isinstance(value['code_inputs_sha256'], str) or not SHA.fullmatch(value['code_inputs_sha256'])):
        raise ValueError('native_hash_manifest')
    hashes(value['worker_hashes'], workers=True)
    return value


def public_artifact(before):
    original = OPS / 'joint-minibatch-search-20261124/joint_minibatch.py'
    diversity = runpy.run_path(str(OPS / 'joint-search-diversity-20261125/patch.py'))['patch']
    shift = runpy.run_path(str(OPS / 'shift-aware-minibatches-20261125/patch.py'))['patch']
    source = diversity(original.read_text(encoding='utf-8'))
    if digest(source.encode('utf-8')) != before[TARGET]:
        raise ValueError('stage_public_base_mismatch')
    candidate = shift(source).encode('utf-8')
    # Syntax only: the publicly reproduced native module is never executed here.
    compile(candidate, '<accepted-joint-module>', 'exec')
    after = dict(before, **{TARGET: digest(candidate)})
    validate_worker_change(before, after)
    return candidate, after


def stage(marker, root):
    app = app_manifest(root / 'app-hashes.json')
    native = native_manifest(root / 'native-hashes.json')
    before, code_hash = native['worker_hashes'], native['code_inputs_sha256']
    if (app['app_hashes'] != marker['app_hashes'] or app['protected_hashes'] != marker['protected_hashes']
            or before != marker['worker_before'] or code_hash != marker['code_inputs_sha256']):
        raise ValueError('stage_original_hashes')
    candidate, after = public_artifact(before)
    if after != marker['worker_after']:
        raise ValueError('stage_accepted_artifact_mismatch')
    target = root / 'new/ga/joint_minibatch.py'
    target.parent.mkdir(mode=0o700, parents=True)
    target.write_bytes(candidate); target.chmod(0o600)
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
