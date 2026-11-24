"""Read-only verification and local preparation of the exact release sources."""
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(HERE))
from release_guard import load_marker
from prepare_overlay import prepare


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else "MISSING"


def prepare_native(marker, stage):
    module_path = REPO / "ops/ovh/native-batching-verify-20261124/verify_native.py"
    spec = importlib.util.spec_from_file_location("joint_release_native_verifier", module_path)
    verifier = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = verifier
    spec.loader.exec_module(verifier)
    captured = stage / "native"
    captured.mkdir(mode=0o700)
    _, manifest = verifier.unpack_private_bundle(stage / "private.bundle", captured)
    if (manifest["source_hashes"] != marker["package_before"]
            or manifest["code_inputs_sha256"] != marker["code_inputs_sha256"]):
        raise ValueError("release_native_input_drift_since_verified_run")
    (stage / "new").mkdir(mode=0o700, exist_ok=True)
    output = stage / "new/ga_workers"
    report = prepare(captured / "ga_workers", output)
    after = {"ga_workers/" + key: value for key, value in report["source_after"].items()}
    if after != marker["package_after"]:
        raise ValueError("release_native_output_differs_from_verified_run")
    for path in output.iterdir():
        ast.parse(path.read_bytes(), filename=path.name)
    print("JOINT_RELEASE_EXACT_NATIVE_OVERLAY_VERIFIED")


def make_manifest(marker, stage):
    rows = []
    changed = {"full_runtime_adapter.py", "joint_minibatch.py", "joint_continuation.py"}
    for name, digest in sorted(marker["package_after"].items()):
        short = name.removeprefix("ga_workers/")
        old = marker["package_before"].get(name, "MISSING")
        if sha(stage / "native/ga_workers" / short) != old or sha(stage / "new/ga_workers" / short) != digest:
            raise ValueError("release_staged_worker_hash_drift")
        rows.append(("WRITE" if short in changed else "PRESERVE", "ga/" + short, old, digest))
    for name in ("auth-runtime.js", "python-ga-upstream.mjs", "python-ga-upstream-build.ts", "restart-optimizer-ui.js"):
        old, new = sha(stage / "old/app" / name), sha(stage / "new/app" / name)
        if "MISSING" in (old, new):
            raise ValueError("release_app_source_missing")
        role = "WRITE" if name in ("python-ga-upstream.mjs", "restart-optimizer-ui.js") else "PRESERVE"
        if role == "PRESERVE" and old != new:
            raise ValueError("release_protected_ui_source_changed")
        rows.append((role, "app/" + name, old, new))
    if len([row for row in rows if row[0] == "WRITE"]) != 5:
        raise ValueError("release_write_allowlist_invalid")
    (stage / "manifest.tsv").write_text("".join("\t".join(row) + "\n" for row in rows))
    (stage / "code-inputs.sha256").write_text(marker["code_inputs_sha256"] + "\n")
    print("JOINT_RELEASE_MANIFEST_AND_UI_PRESERVATION_VERIFIED")


if __name__ == "__main__":
    if len(sys.argv) != 4 or sys.argv[1] not in ("native", "manifest"):
        raise SystemExit("usage: stage.py native|manifest RELEASE_JSON STAGE")
    try:
        marker = load_marker(sys.argv[2])
        stage = Path(sys.argv[3])
        (prepare_native if sys.argv[1] == "native" else make_manifest)(marker, stage)
    except Exception as error:
        print("JOINT_RELEASE_STAGE_FAILED", str(error) if type(error) is ValueError else type(error).__name__)
        raise SystemExit(1)
