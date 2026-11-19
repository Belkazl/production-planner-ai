#!/usr/bin/env python3
"""Offline regression against pinned production adapter/manager copies, no secrets."""
import sys,time
from pathlib import Path

root=Path(sys.argv[1])
sys.path.insert(0,str(root))
from ga_workers import full_runtime_adapter as adapter
from ga_workers import manager

job=manager._Job(job_id="a"*32,account_id="account-a",payload={"model":{"orders":[{"id":"O1"}]}})
snap=manager.ProcessJobManager._snapshot_locked(None,job)
assert snap["status"]=="queued" and snap["stage"]=="queued" and snap["progress"]==0
job.stage="building_first_plan"
assert manager.ProcessJobManager._snapshot_locked(None,job)["stage"]=="building_first_plan"
print("GA_INITIAL_STAGE_MANAGER_ACCOUNT_OWNED_SNAPSHOT_PASS")

result={"ok":True,"valid":True,"partial":False,
        "operations":[{"order":"O1","start_min":0,"end_min":20,
                       "equipment_ids":["E1"],"employee_ids":[],"material_ids":[]}],
        "generic_operations":[{"order":"O1","start_min":0,"end_min":20,
                       "equipment_ids":["E1"],"employee_ids":[],"material_ids":[]}],
        "duration_minutes":20}
model={"orders":[{"id":"O1"}],"equipment":[{"id":"E1"}],
       "employees":[],"materials":[]}
data={"percent":0,"phase":"starting","best_preview":None}
def optimize(*_):
    # The first candidate can be computationally expensive. Advance *only*
    # when the fake worker reports real progress, not with a wall-clock guess.
    time.sleep(2.25)
    data.update({"percent":25,"phase":"optimizing","best_preview":result})
    time.sleep(0.35)
    return result
ga={
    "canonicalize_model":lambda x:x,
    "model_ready":lambda x:True,
    "install_model":lambda x:None,
    "_pp_generic_declared":lambda x:False,
    "_pp_progress_snapshot":lambda:data.copy(),
    "optimize":optimize
}
adapter._namespace=lambda:ga
received=[]
t0=time.monotonic()
out=adapter.run({"model":model,"options":{"generations":10,"population":12}},lambda p:received.append((time.monotonic()-t0,dict(p))))
assert out["valid"] is True
stages=[p.get("stage") for _,p in received]
for expected in ("loading_runtime","validating_model","installing_model",
                 "building_first_plan","optimizing","finalizing","completed"):
    assert expected in stages,(expected,stages)
heartbeat=[(t,p) for t,p in received if p.get("stage")=="building_first_plan"]
assert len(heartbeat)>=2,heartbeat
assert any(t>=1.0 for t,p in heartbeat),heartbeat
assert all(p.get("percent",0)<=1 for _,p in heartbeat),heartbeat
assert any(p.get("percent")==25 and p.get("stage")=="optimizing" for _,p in received)
assert received[-1][1]["percent"]==100 and received[-1][1]["stage"]=="completed"
assert received[-1][0] >= 2.3
print("GA_INITIAL_STAGE_REAL_PREPARATION_HEARTBEAT_PASS",{"stages":stages,"beforeFirstPlan":len(heartbeat),"seconds":round(received[-1][0],2)})
