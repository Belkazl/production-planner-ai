from pathlib import Path
import hashlib
import sys

if len(sys.argv) != 3:
    raise SystemExit("usage: python3 patch.py SOURCE.py DEST.py")
source=Path(sys.argv[1])
destination=Path(sys.argv[2])
original=source.read_text(encoding="utf-8")
expected="74c3b7ce22867b01259572926e16350b2d0fa60a54684bb9e9000eedad031d13"
actual=hashlib.sha256(original.encode()).hexdigest()
if actual!=expected:
    raise SystemExit("FIRST_STAGE_SOURCE_DRIFT_"+actual)

changes=[
    ("    pins=_extract_locks(payload,original,opts)\n",
     "    # First genuine milestone: payload and order validation finished.\n"
     "    progress({'percent':1,'phase':'loading_optimizer','running':True})\n"
     "    pins=_extract_locks(payload,original,opts)\n"),
    ("    ga=_namespace()\n",
     "    ga=_namespace()\n"
     "    # Full original optimizer is loaded in this isolated worker process.\n"
     "    progress({'percent':2,'phase':'normalizing_model','running':True})\n"),
    ("    normalized=ga['canonicalize_model'](original)\n",
     "    normalized=ga['canonicalize_model'](original)\n"
     "    progress({'percent':3,'phase':'validating_resources','running':True})\n"),
    ("    ga['install_model'](normalized)\n",
     "    ga['install_model'](normalized)\n"
     "    progress({'percent':4,'phase':'configuring_optimizer','running':True})\n"),
    ("    progress({'percent':1,'phase':'starting','running':True})\n",
     "    # The first full candidate may take much longer than following ones.\n"
     "    # This is a real completed preparation milestone, not a timer-based %.\n"
     "    progress({'percent':5,'phase':'building_first_plan','running':True})\n"),
]
updated=original
for old,new in changes:
    if updated.count(old)!=1:
        raise SystemExit("FIRST_STAGE_ANCHOR_MISMATCH_"+old.strip())
    updated=updated.replace(old,new,1)
if not all(x in updated for x in ["loading_optimizer","normalizing_model","validating_resources","configuring_optimizer","building_first_plan"]):
    raise SystemExit("FIRST_STAGE_MARKERS_MISSING")
destination.parent.mkdir(parents=True,exist_ok=True)
destination.write_text(updated,encoding="utf-8")
print("FIRST_STAGE_BACKEND_PATCH_READY",{"old_sha":actual,"new_sha":hashlib.sha256(updated.encode()).hexdigest(),"added":len(updated)-len(original)})
