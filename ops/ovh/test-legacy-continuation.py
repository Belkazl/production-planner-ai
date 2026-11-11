#!/usr/bin/env python3
"""Real isolated-worker acceptance for GA continuation from pre-migration saved plan.

No user data is accessed or modified. Synthetic account only.
"""
import json,uuid,secrets,time,urllib.request,urllib.error,sys
BASE="http://127.0.0.1:18082"
cookie=""
def call(path,method="GET",body=None):
    global cookie
    headers={"origin":"https://app.liftorbit.app","sec-fetch-site":"same-origin","accept":"application/json"}
    if cookie: headers["cookie"]=cookie
    if body is not None:headers["content-type"]="application/json"
    req=urllib.request.Request(BASE+path,method=method,headers=headers,data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req,timeout=30) as r:
            status=r.status;raw=r.read(1000000)
            if path=="/api/auth/register":cookie=(r.headers.get("set-cookie") or "").split(";")[0]
    except urllib.error.HTTPError as e:
        status=e.code;raw=e.read(1000000)
    try:data=json.loads(raw)
    except ValueError:data={}
    return status,data
def must(yes,label,detail=""):
    print("LEGACY_CONTINUATION_QA",label,"PASS" if yes else "FAIL",str(detail)[:80],flush=True)
    if not yes:raise RuntimeError(label)
req=lambda typ,ref:{"resource_type":typ,"match_mode":"specific","resource_ref":ref,"resource_refs":[ref],"quantity":1}
model={
    "scheduler_mode":"resource","start":"2026-11-11T08:00:00",
    "equipment":[{"id":"EQ1","name":"Test press","kind":"workstation","capacity":10,"capacity_unit":"pcs"}],
    "employees":[{"id":"E1","name":"Operator","shift":"day"}],
    "shifts":{"day":[["08:00","12:00"],["13:00","17:00"]]},
    "orders":[{"id":oid,"quantity":5,"unit":"pcs","technical_process_id":"TP","parameters":{"color":oid}} for oid in ["OA","OB"]],
    "technical_processes":[{"id":"TP","name":"Press","operations":[{"id":"OP","name":"Press","sequence":1,"duration_min":30,
       "resource_requirements":[req("equipment","EQ1"),req("employee","E1")]}]}],
    "setup_rules":[],"materials":[]
}
# This plan has no resume_state; it represents a valid saved incumbent from the old UI.
saved_plan={"valid":True,"ok":True,"duration_minutes":180,"optimization_run":5,"total_generations":240,
    "operations":[{"order":"OA","start_min":0,"end_min":60,"equipment_ids":["EQ1"]},
                  {"order":"OB","start_min":60,"end_min":120,"equipment_ids":["EQ1"]}]}
seed={"order_sequence":["OA","OB"],"duration_minutes":180,"optimization_run":5,"total_generations":240}
def finish(label):
    for i in range(22):
        time.sleep(1)
        code,data=call("/api/plan-progress")
        must(code==200 and data.get("ok"),label+"_progress_http",code)
        if data.get("success"):
            result=data.get("result") or {}
            ids={str(o.get("order")) for o in result.get("operations") or []}
            must(ids=={"OA","OB"},label+"_valid_account_plan",str(sorted(ids)))
            must(isinstance(result.get("resume_state"),dict),label+"_portable_state_created")
            return
        if not data.get("running") and data.get("phase") in ("failed","cancelled","interrupted","timed_out"):
            raise RuntimeError(label+"_terminal_"+str(data.get("error"))[:60])
    raise RuntimeError(label+"_timed_out")
try:
    code,data=call("/api/auth/register","POST",{"email":"legacy-resume-"+uuid.uuid4().hex+"@liftorbit.invalid",
       "password":secrets.token_urlsafe(32),"company":"Synthetic legacy continuation QA"})
    must(code==200 and data.get("ok") and cookie,"registered",code)
    project_id="legacy-"+uuid.uuid4().hex
    stored=json.dumps([{"id":project_id,"name":"Legacy synthetic","revision":1,"model":model,"lastPlan":saved_plan}])
    storage={"prodplan.projects.v2":stored,"prodplan.project.active.v2":project_id}
    code,data=call("/api/db-storage","POST",{"storage":storage})
    must(code==200 and data.get("ok"),"saved_legacy_project",code)
    # Fail safely before a worker starts if a continuation has no seed at all.
    code,data=call("/api/plan","POST",{"continue":True,"objective":"duration",
         "generations":2,"population":4,"__pp_async_start":True})
    must(code==409 and data.get("error")=="continuation_seed_missing_or_invalid",
         "unseeded_continue_rejected_without_worker",str(code)+":"+str(data.get("error")))
    code,data=call("/api/plan","POST",{"continue":True,"objective":"duration","resume_plan":seed,
         "generations":2,"population":4,"__pp_async_start":True})
    must(code==202 and data.get("started"),"legacy_plan_seed_accepted",code)
    finish("legacy_seed")
    # Subsequent continuation should resume using account-owned persisted resume_state.
    code,data=call("/api/plan","POST",{"continue":True,"objective":"duration",
         "generations":2,"population":4,"__pp_async_start":True})
    must(code==202 and data.get("started"),"account_state_reused",code)
    finish("account_state")
    code,data=call("/api/db-storage")
    must(code==200 and data.get("storage",{}).get("prodplan.projects.v2")==stored,
         "legacy_project_and_saved_plan_untouched",code)
    print("LEGACY_CONTINUATION_END_TO_END_OK",flush=True)
except Exception as e:
    print("LEGACY_CONTINUATION_TEST_FAILED",type(e).__name__,str(e)[:100],flush=True)
    sys.exit(1)
