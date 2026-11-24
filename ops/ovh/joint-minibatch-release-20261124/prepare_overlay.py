"""Prepare only the public joint-search and continuation changes on a copy.

INPUT_PACKAGE and OUTPUT_PACKAGE are ga_workers directories.  Input is a
verified ephemeral bundle package; output must not exist.  No service is run.
"""
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
PY_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\.py\Z")
REQUIRED = {"__init__.py", "compile_legacy_ga.py", "full_runtime_adapter.py", "continuation.py",
            "constraints.py", "operation_interleave.py", "batch_size_diagnostics.py"}
ALLOWED_CHANGES = {"full_runtime_adapter.py", "joint_minibatch.py", "joint_continuation.py"}
PUBLIC_FILES = (
    "ops/ovh/joint-minibatch-release-20261124/prepare_overlay.py",
    "ops/ovh/joint-minibatch-search-20261124/patch.py",
    "ops/ovh/joint-minibatch-search-20261124/joint_minibatch.py",
    "ops/ovh/native-batching-continuation-20261124/patch_worker.py",
    "ops/ovh/native-batching-continuation-20261124/joint_continuation.py",
)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_package(path):
    if path.is_symlink() or not path.is_dir():
        raise ValueError("overlay_input_directory_invalid")
    files = {}
    for entry in path.iterdir():
        if not PY_NAME.fullmatch(entry.name) or entry.is_symlink() or not entry.is_file():
            raise ValueError("overlay_package_entry_invalid")
        if entry.stat().st_size > 4 * 1024 * 1024:
            raise ValueError("overlay_package_file_too_large")
        files[entry.name] = entry.read_bytes()
    if not REQUIRED.issubset(files) or not 7 <= len(files) <= 64 or sum(map(len, files.values())) > 32 * 1024 * 1024:
        raise ValueError("overlay_package_contract_invalid")
    return files


def load_patcher(path, name):
    if path.is_symlink() or not path.is_file():
        raise ValueError("overlay_public_patcher_missing")
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    sys.modules[name] = loaded
    spec.loader.exec_module(loaded)
    if not callable(getattr(loaded, "patch", None)):
        raise ValueError("overlay_public_patcher_contract")
    return loaded.patch


def verify_integration(source):
    tree = ast.parse(source)
    run = next((node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "run"), None)
    if run is None:
        raise ValueError("overlay_run_missing")
    calls = [node for node in ast.walk(run) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)]
    installers = [node for node in calls if node.func.id == "install_joint_minibatch_search"]
    loads = [node for node in calls if node.func.id == "load_resume_state"]
    if len(installers) != 1 or not loads or installers[0].lineno >= min(node.lineno for node in loads):
        raise ValueError("overlay_joint_install_order_invalid")
    for marker in ("install_operation_interleave(ga, normalized, objective=objective, pins=pins)",
                   "install_batch_size_diagnostics(ga, normalized)", "def _live_scheduler_preview(",
                   "_assert_owned(result,normalized)", "pp_joint_continuation_v1"):
        if marker not in source:
            raise ValueError("overlay_existing_worker_guard_missing")


def prepare(input_package, output_package):
    before = read_package(input_package)
    if output_package.exists() or output_package.is_symlink():
        raise ValueError("overlay_output_must_not_exist")
    joint_root = REPO / "ops/ovh/joint-minibatch-search-20261124"
    continuation_root = REPO / "ops/ovh/native-batching-continuation-20261124"
    search_patch = load_patcher(joint_root / "patch.py", "joint_overlay_search_patch")
    continuation_patch = load_patcher(continuation_root / "patch_worker.py", "joint_overlay_continuation_patch")
    updated = search_patch(before["full_runtime_adapter.py"].decode("utf-8"))
    updated = continuation_patch(updated)
    if continuation_patch(search_patch(updated)) != updated:
        raise ValueError("overlay_patch_not_idempotent")
    verify_integration(updated)
    after = dict(before, **{"full_runtime_adapter.py": updated.encode("utf-8")})
    for name, public_path in (("joint_minibatch.py", joint_root / "joint_minibatch.py"),
                              ("joint_continuation.py", continuation_root / "joint_continuation.py")):
        content = public_path.read_bytes()
        if name in before and before[name] != content:
            raise ValueError("overlay_unrecognized_existing_joint_module")
        ast.parse(content, filename=name)
        after[name] = content
    changed = {name for name in after if before.get(name) != after[name]}
    if changed - ALLOWED_CHANGES or before["compile_legacy_ga.py"] != after["compile_legacy_ga.py"]:
        raise ValueError("overlay_unrelated_source_change")
    if before != read_package(input_package):
        raise ValueError("overlay_input_changed")
    output_package.mkdir(mode=0o700)
    for name, content in after.items():
        with open(output_package / name, "xb") as handle:
            os.chmod(output_package / name, 0o600)
            handle.write(content)
    return {"changed_files": sorted(changed),
            "source_before": {name: sha(content) for name, content in sorted(before.items())},
            "source_after": {name: sha(content) for name, content in sorted(after.items())},
            "public_sources": {name: sha((REPO / name).read_bytes()) for name in PUBLIC_FILES}}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: prepare_overlay.py INPUT_PACKAGE OUTPUT_PACKAGE")
    try:
        prepared = prepare(Path(sys.argv[1]), Path(sys.argv[2]))
    except Exception as error:
        # These helpers execute no private engine. Still keep error output
        # bounded and omit source excerpts, exception values and file paths.
        print("JOINT_OVERLAY_PREPARE_FAILED", type(error).__name__)
        raise SystemExit(1)
    print("JOINT_OVERLAY_PREPARED", json.dumps(prepared, separators=(",", ":")))
