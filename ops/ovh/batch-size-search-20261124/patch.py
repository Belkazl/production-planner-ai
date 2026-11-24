"""Exact, reversible integration into the public native worker adapter."""
import ast
import hashlib
from pathlib import Path
import sys


IMPORT = "from .batch_size_diagnostics import install_batch_size_diagnostics, finalize_batch_size_diagnostics\n"
IMPORT_ANCHOR = "SOURCE = Path('/tmp/production_planner.py')"
ANCHOR = "    if pins:\n        try: pins=make_constrained_scheduler(ga,pins,normalized)"
CALL = (
    "    # Observe existing batching only; preserve each native candidate object.\n"
    "    install_batch_size_diagnostics(ga, normalized)\n"
)
FINAL_ANCHOR = "    _assert_owned(result,normalized)\n"
FINAL = (
    "    batch_size_diagnostic=finalize_batch_size_diagnostics(ga, result, normalized)\n"
    "    if isinstance(batch_size_diagnostic,dict):\n"
    "        result=dict(result)\n"
    "        result['batch_size_diagnostics']=batch_size_diagnostic\n"
)


def patch(source):
    parts = (IMPORT + "\n", CALL, FINAL)
    present = any(part in source for part in parts)
    if present:
        if any(source.count(part) != 1 for part in parts):
            raise RuntimeError("BATCH_DIAGNOSTICS_PARTIAL_INSTALLATION")
        if source.count("result['batch_size_diagnostics']") != 1:
            raise RuntimeError("BATCH_DIAGNOSTICS_PARTIAL_INSTALLATION")
        ast.parse(source)
        return source
    if "batch_size_diagnostics" in source or "batch_size_diagnostic=" in source:
        raise RuntimeError("BATCH_DIAGNOSTICS_SOURCE_DRIFT")
    for required in ("import copy", "def _namespace():", "def run(payload,progress):",
                     "ga['optimize'](gens,population,seed,", "objective=opts.get('objective') or 'duration'",
                     "result['resume_state']"):
        if required not in source:
            raise RuntimeError("BATCH_DIAGNOSTICS_ADAPTER_CONTRACT_DRIFT")
    if any(source.count(anchor) != 1 for anchor in (IMPORT_ANCHOR, ANCHOR, FINAL_ANCHOR)):
        raise RuntimeError("BATCH_DIAGNOSTICS_ANCHOR_DRIFT")
    result = source.replace(IMPORT_ANCHOR, IMPORT + "\n" + IMPORT_ANCHOR, 1)
    result = result.replace(ANCHOR, CALL + ANCHOR, 1).replace(FINAL_ANCHOR, FINAL_ANCHOR + FINAL, 1)
    reversed_result = result
    for part in parts:
        reversed_result = reversed_result.replace(part, "", 1)
    if reversed_result != source:
        raise RuntimeError("BATCH_DIAGNOSTICS_UNRELATED_CHANGE")
    ast.parse(result)
    return result


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: python3 patch.py INPUT_ADAPTER.py OUTPUT_ADAPTER.py")
    source = Path(sys.argv[1]).read_text(encoding="utf-8")
    result = patch(source)
    Path(sys.argv[2]).write_text(result, encoding="utf-8")
    print("BATCH_SIZE_DIAGNOSTICS_ADAPTER_PATCH", {"changed": source != result,
          "old_sha256": hashlib.sha256(source.encode()).hexdigest(),
          "new_sha256": hashlib.sha256(result.encode()).hexdigest()})
