#!/usr/bin/env python3
"""Exercise a REAL GA cooperative time deadline in a disposable process."""
import os,time
from ga_workers.full_runtime_adapter import run
from tests.test_full_runtime import sample

os.environ["PP_PY_GA_TIMEOUT_S"]="6"
model=sample("TIMEGUARD",material=True,setup=True)
previews=[]
start=time.monotonic()
def capture(data):
    best=data.get("best_preview") if isinstance(data,dict) else None
    if isinstance(best,dict) and best.get("valid") and best.get("operations"):
        previews.append(float(best["duration_minutes"]))
result=run({"model":model,"options":{
    "generations":15000,"population":100,"seed":17,"objective":"duration"}},capture)
elapsed=time.monotonic()-start
assert result.get("valid") is True and result.get("ok") is True
assert isinstance(result.get("resume_state"),dict)
assert result.get("optimization_time_limit_reached") is True, "optimizer ignored soft deadline"
assert elapsed < 18, "cooperative time limit failed"
assert previews and float(result["duration_minutes"])<=min(previews)+1e-7, "best validated plan regressed"
assert result.get("optimization_completed_early") is True
print("GA_REAL_COOPERATIVE_DEADLINE_PRESERVED_VALID_BEST",{"elapsed_s":round(elapsed,2),
    "validated_previews":len(previews),"best_duration":result["duration_minutes"]},flush=True)
