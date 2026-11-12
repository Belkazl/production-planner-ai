#!/usr/bin/env python3
"""Real GA schedule validation and bounded supervisor checkpoint unit checks."""
import copy, os, sys, time
from ga_workers.full_runtime_adapter import _namespace, _live_scheduler_preview
from ga_workers.manager import ProcessJobManager

def req(kind,ident):
    return {"resource_type":kind,"match_mode":"specific","resource_ref":ident,
            "resource_refs":[ident],"quantity":1}
model={
    "scheduler_mode":"resource","start":"2026-11-11T08:00:00",
    "equipment":[{"id":"E1","name":"Press","kind":"workstation","capacity":10,"capacity_unit":"pcs"}],
    "employees":[{"id":"P1","name":"Operator","role":"operator","shift":"day"}],
    "shifts":{"day":[["08:00","12:00"],["13:00","17:00"]]},
    "orders":[{"id":"O1","quantity":5,"unit":"pcs","technical_process_id":"TP","parameters":{"color":"A"}},
              {"id":"O2","quantity":5,"unit":"pcs","technical_process_id":"TP","parameters":{"color":"B"}}],
    "technical_processes":[{"id":"TP","name":"Press","operations":[{"id":"OP","name":"Press","sequence":1,"duration_min":30,"resource_requirements":[req("equipment","E1"),req("employee","P1")]}]}],
    "materials":[],"setup_rules":[]
}
def must(test,label):
    if not test:raise AssertionError(label)
    print("GA_SCORE_TIMEOUT_QA",label,"PASS",flush=True)

ga=_namespace()
m=ga["canonicalize_model"](model)
ga["install_model"](m)
sim=ga["_pp_schedule_sequence"](m,["O1","O2"])
sim=ga["_pp_setup_generic_apply"](m,sim)
must(isinstance(sim,dict) and len(sim.get("operations") or [])>0,"real_engine_scheduled")
original=_live_scheduler_preview(sim,m,"duration",ga,[],checkpoint=True)
must(original is not None and original.get("valid") is True,"valid_preview_after_all_constraints")
must(original.get("_pp_verified_checkpoint_v1") is True and
     isinstance(original.get("resume_state"),dict),"portable_verified_checkpoint")
bad_score=copy.deepcopy(sim)
bad_score["duration_minutes"]=float(sim["duration_minutes"])-50
must(_live_scheduler_preview(bad_score,m,"duration",ga,[],checkpoint=True) is None,
     "incorrectly_short_duration_must_not_be_published")
bad_resource=copy.deepcopy(sim)
bad_resource["operations"][0]["equipment_ids"]=["FOREIGN"]
must(_live_scheduler_preview(bad_resource,m,"duration",ga,[],checkpoint=True) is None,
     "foreign_resource_not_presented_as_valid")
bad_overlap=copy.deepcopy(sim)
if len(bad_overlap["operations"])>1:
    first,b=bad_overlap["operations"][0],bad_overlap["operations"][1]
    b["start_min"]=first["start_min"]
    b["end_min"]=first["end_min"]
    must(_live_scheduler_preview(bad_overlap,m,"duration",ga,[],checkpoint=True) is None,
         "overlapping_operation_not_presented_as_valid")

# The worker job supervisor may safely recover only an already verified
# checkpoint belonging to the same account; neither an arbitrary candidate
# nor a preview of some other job is enough.
def make_test(with_checkpoint):
    sup=ProcessJobManager(capacity=1,timeout_s=2,allow_fixture=True)
    try:
        account="TIMEOUT-OWNER-"+str(int(with_checkpoint))
        job=sup.submit(account,{"model":{"account_fixture_tag":account,"orders":[{"id":"O1"}]},
                              "test_cpu_seconds":6})
        deadline=time.monotonic()+5
        while time.monotonic()<deadline:
            data=sup.get(account,job["job_id"])
            if data["status"]=="running":
                break
            time.sleep(0.05)
        must(data["status"]=="running","worker_started_"+str(with_checkpoint))
        if with_checkpoint:
            # The direct GA validation test above established that the marker
            # is only produced after model/resource/material validation.
            snap=copy.deepcopy(original)
            with sup.cv:
                sup.jobs[job["job_id"]].best_preview=snap
        result=sup.wait(account,job["job_id"],timeout=9)
        must(sup.metrics()["active"]==0,"worker_process_reaped_"+str(with_checkpoint))
        if with_checkpoint:
            must(result["status"]=="completed","verified_best_salvaged_at_timeout")
            must(result["result"]["optimization_time_limit_reached"] is True,
                 "early_completion_is_explicitly_labeled")
            must(bool(result["result"]["resume_state"]),"resume_state_retained")
        else:
            must(result["status"]=="timed_out" and result.get("error")=="worker_timeout",
                 "unverified_timeout_still_fails_closed")
    finally:sup.shutdown()
make_test(True)
make_test(False)
print("GA_VERIFIED_PREVIEW_AND_TIMEOUT_SALVAGE_TESTS_OK",flush=True)
