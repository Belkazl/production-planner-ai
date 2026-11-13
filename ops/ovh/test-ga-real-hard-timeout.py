"""End-to-end real Python GA hard deadline with verified checkpoint, synthetic tenant."""
import os, json, time, uuid

# Code-only environment from an ephemeral runner, never customer records.
code_file=os.getenv("PP_GA_CODE_FILE")
if code_file:
    with open(code_file,encoding="utf8") as f:
        os.environ.update(json.load(f))

from ga_workers.manager import ProcessJobManager,ForbiddenJob

def req(kind,ref):
    return {"resource_type":kind,"resource_ref":ref,"resource_refs":[ref],
            "match_mode":"specific","quantity":1}

def model(qty=600):
    eq=[{"id":"QA_EQ_"+str(i),"name":"Equipment","kind":"workstation",
         "capacity":600,"capacity_unit":"m2"} for i in range(14)]
    staff=[{"id":"QA_EM_"+str(i),"name":"Employee","role":"operator",
            "shift":"day"} for i in range(5)]
    operations=[{"id":"OP"+str(i),"name":"Step","sequence":i+1,
                 "duration_min":30,"setup_parameter":"color",
                 "resource_requirements":[req("equipment","QA_EQ_"+str(i)),
                                         req("employee","QA_EM_"+str(i%5)),
                                         {"resource_type":"material","resource_ref":"MAT",
                                          "resource_refs":["MAT"],"quantity":1,
                                          "consumption_rule":"per_unit"}]}
                for i in range(7)]
    orders=[{"id":"QA_O"+str(i),"quantity":qty,"unit":"m2",
             "technical_process_id":"TP",
             "parameters":{"color":"A" if i%2 else "B"}} for i in range(12)]
    return {"scheduler_mode":"resource","start":"2026-11-13T08:00:00",
            "equipment":eq,"employees":staff,
            "shifts":{"day":[["08:00","12:00"],["13:00","17:00"]]},
            "orders":orders,
            "technical_processes":[{"id":"TP","name":"Synthetic QA",
                                    "operations":operations}],
            "materials":[{"id":"MAT","name":"Glaze","unit":"kg",
                          "initial_stock":20000000,"deliveries":[]}],
            "setup_rules":[{"id":"AB","setup_parameter":"color","equipment_ref":"*",
                            "from_state":"A","to_state":"B","duration_min":15},
                           {"id":"BA","setup_parameter":"color","equipment_ref":"*",
                            "from_state":"B","to_state":"A","duration_min":15}]}

def exercise(quantity,hard_seconds):
    account="GA-TIMEOUT-QA-"+uuid.uuid4().hex
    manager=ProcessJobManager(capacity=1,timeout_s=hard_seconds,
        adapter="ga_workers.full_runtime_adapter:run")
    try:
        payload={"model":model(quantity),"options":{
                 "generations":15000,"population":80,
                 "seed":12345,"objective":"duration"}}
        job=manager.submit(account,payload)
        print("HARD_TIMEOUT_QA_STARTED","batch_quantity",quantity,
              "limit_s",hard_seconds,flush=True)
        observed_valid=False
        deadline=time.monotonic()+hard_seconds+15
        while time.monotonic()<deadline:
            state=manager.get(account,job["job_id"],include_plan=True)
            preview=state.get("best_preview")
            if isinstance(preview,dict) and preview.get("_pp_verified_checkpoint_v1"):
                observed_valid=True
            if state["status"] in ("completed","timed_out","failed","cancelled"):
                break
            time.sleep(.12)
        print("HARD_TIMEOUT_QA_TERMINAL",
              "state",state["status"],
              "error",state.get("error") or "none",
              "valid_preview",observed_valid,
              "operations",len((state.get("result") or {}).get("operations") or []),
              "timelimit",bool((state.get("result") or {}).get("optimization_time_limit_reached")),
              flush=True)
        assert state["status"]=="completed",state.get("error") or state["status"]
        result=state["result"]
        assert result.get("valid") is True
        assert isinstance(result.get("resume_state"),dict)
        assert result.get("optimization_time_limit_reached") is True
        assert len(result.get("operations") or [])>=84
        assert observed_valid
        assert manager.metrics()["active"]==0
        try:
            manager.get("OTHER-QA-ACCOUNT",job["job_id"])
            raise AssertionError("cross_account_job_exposed")
        except ForbiddenJob:
            pass
        print("HARD_TIMEOUT_QA_VERIFIED_RESUMABLE_PLAN",
              "ops",len(result["operations"]),
              "duration",round(result.get("duration_minutes",0)),
              "account_isolated",True,flush=True)
        # The returned checkpoint must actually seed the next isolated GA run,
        # not merely contain an unused resume_state object.
        continued={"model":model(quantity),"options":{
                   "continue":True,"resume_state":result["resume_state"],
                   "generations":2,"population":4,"seed":2345,"objective":"duration"}}
        next_job=manager.submit(account,continued)
        next_end=time.monotonic()+hard_seconds+16
        while time.monotonic()<next_end:
            following=manager.get(account,next_job["job_id"],include_plan=True)
            if following["status"] in ("completed","timed_out","failed","cancelled"):
                break
            time.sleep(.1)
        print("HARD_TIMEOUT_QA_RESUME",
              "state",following["status"],
              "error",following.get("error") or "none",
              "result_ops",len((following.get("result") or {}).get("operations") or []),flush=True)
        assert following["status"]=="completed",following.get("error") or following["status"]
        assert (following.get("result") or {}).get("valid") is True
        assert len((following.get("result") or {}).get("operations") or [])>=84
        assert manager.metrics()["active"]==0

    finally:manager.shutdown()

if __name__=="__main__":
    exercise(600,8)
    exercise(7200,12)
    print("HARD_TIMEOUT_QA_ALL_GREEN",flush=True)
