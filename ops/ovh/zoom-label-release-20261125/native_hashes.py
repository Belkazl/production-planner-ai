"""Build a public read-only program that emits only native code hashes on the host."""
import argparse
import hashlib
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
CONTRACT = HERE.parent / 'native-batching-verify-20261124/native_input_contract.py'
CONTRACT_SHA = 'a98b1bb9af5ce8082106176069ece0e904d78b833b36518fc69ae244c9c27134'


def public_program():
    data = CONTRACT.read_bytes()
    if CONTRACT.is_symlink() or hashlib.sha256(data).hexdigest() != CONTRACT_SHA:
        raise ValueError('native_contract_drift')
    # The frozen selector reads owned code inputs locally. No runtime source,
    # selected configuration, credentials or model data enter stdout.
    return '''import hashlib, json, sys
try:
    namespace = {"__name__": "reviewed_native_code_contract"}
    exec(compile(%r, "native_input_contract.py", "exec"), namespace)
    selected, manifest, _ = namespace["load_owned_inputs"]()
    safe = {"format": "zoom-label-native-hashes-v1", "worker_hashes": manifest["source_hashes"],
        "code_inputs_sha256": hashlib.sha256(json.dumps(selected, separators=(",", ":")).encode()).hexdigest()}
    print(json.dumps(safe, separators=(",", ":")))
except Exception:
    print("ZOOM_LABEL_RELEASE_NATIVE_HASH_CAPTURE_FAILED", file=sys.stderr)
    raise SystemExit(6)
''' % data.decode('utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--emit-program', action='store_true')
    args = parser.parse_args()
    try:
        if not args.emit_program:
            raise ValueError('invocation')
        sys.stdout.write(public_program())
    except Exception:
        print('ZOOM_LABEL_RELEASE_NATIVE_PROGRAM_REJECTED', file=sys.stderr)
        raise SystemExit(6)
