"""Guarded adapter integration; never reads runtime variables or private source."""
import ast
import hashlib
from pathlib import Path
import sys


IMPORT = "from .operation_interleave import install_operation_interleave\n"
ANCHOR = "    if pins:\n        try: pins=make_constrained_scheduler(ga,pins,normalized)"
CALL = (
    "    # Pure unary job-shop candidates may interleave operations before pinning.\n"
    "    install_operation_interleave(ga, normalized, objective=objective, pins=pins)\n"
)
FINAL_ANCHOR = "    _assert_owned(result,normalized)\n"
LEGACY_FINAL = (
    "    interleave_diagnostic=ga.get('_PP_OPERATION_INTERLEAVE_DIAGNOSTIC')\n"
    "    if isinstance(interleave_diagnostic,dict):\n"
    "        result=dict(result)\n"
    "        result['operation_interleave']=copy.deepcopy({key:interleave_diagnostic.get(key) for key in ('version','eligible','improved_candidates','fallback_reason')})\n"
)
FINAL = LEGACY_FINAL.replace("'fallback_reason')", "'fallback_reason','model_field_mismatches')")


def patch(source):
    if LEGACY_FINAL in source:
        if source.count(LEGACY_FINAL) != 1 or FINAL in source or source.count(IMPORT) != 1 or source.count(CALL) != 1:
            raise RuntimeError("INTERLEAVE_PARTIAL_DIAGNOSTICS")
        source = source.replace(LEGACY_FINAL, "", 1)
    if ("result['operation_interleave']" in source or "interleave_diagnostic=" in source) and FINAL not in source:
        raise RuntimeError("INTERLEAVE_PARTIAL_DIAGNOSTICS")
    if IMPORT in source or CALL in source or FINAL in source:
        if source.count(IMPORT) != 1 or source.count(CALL) != 1:
            raise RuntimeError("INTERLEAVE_PARTIAL_INSTALLATION")
        if source.count(FINAL) == 1:
            ast.parse(source)
            return source
        if FINAL in source:
            raise RuntimeError("INTERLEAVE_PARTIAL_INSTALLATION")
        # Upgrade only the exact previous version of our own two additions.
        source = source.replace(IMPORT + "\n", "", 1).replace(CALL, "", 1)
    for required in ("import copy", "def _namespace():", "def run(payload,progress):", "ga['optimize'](gens,population,seed,", "objective=opts.get('objective') or 'duration'", "result['resume_state']"):
        if required not in source:
            raise RuntimeError("INTERLEAVE_ADAPTER_CONTRACT_DRIFT")
    source_anchor = "SOURCE = Path('/tmp/production_planner.py')"
    if source.count(ANCHOR) != 1 or source.count(source_anchor) != 1 or source.count(FINAL_ANCHOR) != 1:
        raise RuntimeError("INTERLEAVE_ANCHOR_DRIFT")
    result = source.replace(source_anchor, IMPORT + "\n" + source_anchor, 1).replace(ANCHOR, CALL + ANCHOR, 1).replace(FINAL_ANCHOR, FINAL_ANCHOR + FINAL, 1)
    if result.replace(IMPORT + "\n", "", 1).replace(CALL, "", 1).replace(FINAL, "", 1) != source:
        raise RuntimeError("INTERLEAVE_UNRELATED_CHANGE")
    ast.parse(result)
    return result


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: python3 patch.py INPUT_ADAPTER.py OUTPUT_ADAPTER.py")
    before = Path(sys.argv[1]).read_text(encoding="utf-8")
    after = patch(before)
    Path(sys.argv[2]).write_text(after, encoding="utf-8")
    print("OPERATION_INTERLEAVE_ADAPTER_PATCH", {"changed": before != after, "old_sha256": hashlib.sha256(before.encode()).hexdigest(), "new_sha256": hashlib.sha256(after.encode()).hexdigest()})
