#!/usr/bin/env python3
"""Exercise a REAL GA cooperative time deadline in a disposable process."""
import os,time
from ga_workers.full_runtime_adapter import run
from tests.test_full_runtime import sample

os.environ["PP_PY_GA_TIMEOUT_S"]="6"
# Multiple distinct orders and seven resource-dependent steps prevent
# the trivial two-order shortcut from completing before the soft deadline.
model=sample("TIMEGUARD",material=False,setup=False)
model["equipment"]=[{"id":"E"+str(i),"name":"Station","kind":"workstation",
                     "capacity":600,"capacity_unit":"m2"} for i in range(14)]
model["employees"]=[{"id":"P"+str(i),"name":"Operator","role":"operator","shift":"day"} for i in range(5)]
model["orders"]=[{"id":"O"+str(i),"quantity":600,"unit":"m2","technical_process_id":"TP",
                   "parameters":{"color":"A" if i%2 else "B"}} for i in range(12)]
model["technical_processes"]=[{"id":"TP","name":"Seven-stage ceramics","operations":[
  {"id":"OP"+str(i),"name":"Step","sequence":i+1,"duration_min":30,
   "setup_parameter":"color",
   "resource_requirements":[
      {"resource_type":"equipment","resource_ref":"E"+str(i),"resource_refs":["E"+str(i)],
       "match_mode":"specific","quantity":1},
      {"resource_type":"employee","resource_ref":"P"+str(i%5),"resource_refs":["P"+str(i%5)],
       "match_mode":"specific","quantity":1}
   ]} for i in range(7)]}]
model["setup_rules"]=[{"id":"AB","setup_parameter":"color","equipment_ref":"*",
                       "from_state":"A","to_state":"B","duration_min":15},
                      {"id":"BA","setup_parameter":"color","equipment_ref":"*",
                       "from_state":"B","to_state":"A","duration_min":15}]
previews=[]
start=time.monotonic()
def capture(data):
    best=data.get("best_preview") if isinstance(data,dict) else None
    if isinstance(best,dict) and best.get("valid") and best.get("operations"):
        previews.append(float(best["duration_minutes"]))
result=run({"model":model,"options":{
    "generations":15000,"population":100,"seed":17,"objective":"duration"}},capture)
elapsed=time.monotonic()-start
print("GA_COOPERATIVE_DEADLINE_OBSERVED",{"elapsed_s":round(elapsed,2),
      "shortened":bool(result.get("optimization_time_limit_reached")),
      "preview_count":len(previews)},flush=True)
assert result.get("valid") is True and result.get("ok") is True
assert isinstance(result.get("resume_state"),dict)
assert result.get("optimization_time_limit_reached") is True, "optimizer ignored soft deadline"
assert elapsed < 18, "cooperative time limit failed"
assert previews and float(result["duration_minutes"])<=min(previews)+1e-7, "best validated plan regressed"
assert result.get("optimization_completed_early") is True
print("GA_REAL_COOPERATIVE_DEADLINE_PRESERVED_VALID_BEST",{"elapsed_s":round(elapsed,2),
    "validated_previews":len(previews),"best_duration":result["duration_minutes"]},flush=True)
