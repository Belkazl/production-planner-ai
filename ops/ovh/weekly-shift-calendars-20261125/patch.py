"""Stage the weekly calendar changes; never deploy automatically."""
import ast
import hashlib
from pathlib import Path
import re
import sys

ROOT=Path(__file__).parent
EXPECTED_JOINT="9ddfde67f8ebf723c401d3849b0bf88004ebb6c8a6b537dbd157e7dc6920a6f5"

def replace_once(src,old,new):
    if src.count(old)!=1:raise ValueError("weekly_calendar_anchor_drift")
    return src.replace(old,new,1)

def patch_joint(source):
    if hashlib.sha256(source.encode()).hexdigest()!=EXPECTED_JOINT:
        raise ValueError("weekly_calendar_native_baseline_drift")
    helper=(ROOT/"weekly_calendar.py").read_text()
    source=replace_once(source,"def _shift_align_native_windows(ga, model):",
                       helper+"\n\ndef _shift_align_native_windows(ga, model):")
    source=replace_once(source,"    if offset == 0 or not model.get('employees') or not model.get('shifts'):",
                       "    if (offset == 0 and not model.get('shift_calendars')) or not model.get('employees') or not model.get('shifts'):")
    source=replace_once(source,"            ctx['emp_windows'] = corrected",
                       "            ctx['emp_windows'] = _wc_native_windows(model, origin, windows, corrected)")
    source=replace_once(source,"            blocks = shifts.get(name) if isinstance(name, str) else None",
                       "            if name in (model.get('shift_calendars') or {}):\n"
                       "                if not _wc_contains(model['shift_calendars'][name], origin, float(start), float(end)):\n"
                       "                    return True\n"
                       "                continue\n"
                       "            blocks = shifts.get(name) if isinstance(name, str) else None")
    # Calendar start hints should use the actual native windows for explicitly configured employees.
    anchor="        shifts = model.get('shifts')\n        if not isinstance(shifts, dict):\n            return sorted(result)"
    source=replace_once(source,anchor,
        "        if model.get('shift_calendars'):\n"
        "            windows = context.get('emp_windows') or {}\n"
        "            starts = sorted({float(a) for pairs in windows.values() for a, b in pairs\n"
        "                             if ready <= float(a) <= latest})\n"
        "            return sorted(result | set(starts[:MAX_SHIFT_STARTS-1]))\n"+anchor)
    ast.parse(source)
    return source

def patch_adapter(source):
    # Match the exact canonicalization assignment, independently of whitespace and quote choice.
    pattern=r"(?m)^([ \t]*)normalized\s*=\s*ga\[['\"]canonicalize_model['\"]\]\(original\)[ \t]*$"
    matches=list(re.finditer(pattern,source))
    if len(matches)!=1 or "from .joint_minibatch import _wc_prepare_model" in source:
        raise ValueError("weekly_calendar_adapter_anchor_drift")
    m=matches[0]; p=m.group(1)
    replacement="\n".join((p+"from .joint_minibatch import _wc_prepare_model, _wc_restore_model",
                           p+"original = _wc_prepare_model(original)",
                           m.group(0),p+"normalized = _wc_restore_model(normalized, original)"))
    result=source[:m.start()]+replacement+source[m.end():]
    ast.parse(result)
    return result

if __name__=="__main__":
    if len(sys.argv)!=5:raise SystemExit("usage: patch.py JOINT ADAPTER NEW_JOINT NEW_ADAPTER")
    joint,adapter,outjoint,outadapter=map(Path,sys.argv[1:])
    staged_joint=patch_joint(joint.read_text()); staged_adapter=patch_adapter(adapter.read_text())
    outjoint.write_text(staged_joint);outadapter.write_text(staged_adapter)
    print("WEEKLY_CALENDAR_NATIVE_STAGED")
