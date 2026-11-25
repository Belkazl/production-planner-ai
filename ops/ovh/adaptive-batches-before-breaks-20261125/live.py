#!/usr/bin/env python3
"""Synthetic live acceptance for break-aware GA batching. Never reads a customer project."""
import json
import math
import os
import secrets
import time
import urllib.error
import urllib.request
import uuid

BASE=os.getenv("PP_QA_BASE","https://app.liftorbit.app")
COOKIE=""
def call(path,method="GET",body=None):
    global COOKIE
    headers={"Origin":BASE,"Sec-Fetch-Site":"same-origin","Accept":"application/json"}
    if COOKIE: headers["Cookie"]=COOKIE
    if body is not None: headers["Content-Type"]="application/json"
    request=urllib.request.Request(BASE+path,method=method,headers=headers,
        data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(request,timeout=30) as response:
            status=response.status; raw=response.read(8_000_000)
            if path=="/api/auth/register": COOKIE=(response.headers.get("set-cookie") or "").split(";")[0]
    except urllib.error.HTTPError as exc:
        status=exc.code; raw=exc.read(8_000_000)
    try: data=json.loads(raw)
    except ValueError: data={}
    return status,data

def check(ok,label,detail=None):
    print("BATCH_BREAK_QA",label,"PASS" if ok else "FAIL",json.dumps(detail,ensure_ascii=True),flush=True)
    if not ok: raise AssertionError(label)

def req(kind,ref):
    return {"resource_type":kind,"resource_ref":ref,"resource_refs":[ref],"match_mode":"specific","quantity":1}
def model_base(start,capacity,profile=None):
    eq={"id":"QA_EQ","name":"QA workstation","kind":"workstation","capacity":capacity,"capacity_unit":"pcs"}
    if profile is not None: eq["timing_profile"]=profile
    return {"scheduler_mode":"resource","start":start,
        "equipment":[eq],"employees":[{"id":"QA_EM","name":"QA operator","shift":"day"}],
        "shifts":{"day":[["08:00","12:00"],["13:00","17:00"]]},
        "orders":[],"technical_processes":[],"materials":[],"setup_rules":[]}

def add_order(model,oid,qty,duration):
    process="TP_"+oid
    model["orders"].append({"id":oid,"quantity":qty,"unit":"pcs","technical_process_id":process})
    model["technical_processes"].append({"id":process,"name":oid,"operations":[
        {"id":"OP_"+oid,"name":oid,"sequence":1,"duration_min":duration,
         "resource_requirements":[req("equipment","QA_EQ"),req("employee","QA_EM")]}]})

def prepare(model,label):
    global COOKIE
    COOKIE=""
    status,data=call("/api/auth/register","POST",{"email":"batch-break-"+uuid.uuid4().hex+"@liftorbit.invalid",
        "password":secrets.token_urlsafe(32),"company":"Disposable batch break acceptance"})
    check(status==200 and data.get("ok") and bool(COOKIE),label+"_register",status)
    project="batch-break-"+uuid.uuid4().hex
    storage={"prodplan.projects.v2":json.dumps([{"id":project,"name":label,"model":model,"revision":1}]),
             "prodplan.project.active.v2":project}
    status,data=call("/api/db-storage","POST",{"storage":storage})
    check(status==200 and data.get("ok"),label+"_store",status)
    status,data=call("/api/model")
    canonical=data.get("model") or {}
    check(status==200 and len(canonical.get("orders",[]))==len(model["orders"]),label+"_model",status)
    # Synthetic data only; log canonical timing keys and values, no account identifiers.
    print("BATCH_BREAK_CANONICAL",label,json.dumps({"equipment":canonical.get("equipment"),
          "operations":canonical.get("technical_processes")},ensure_ascii=True),flush=True)
    return canonical

def run(label,seed,continuing=False):
    status,data=call("/api/plan","POST",{"generations":3,"population":6,"seed":seed,"objective":"duration",
        "continue":continuing,"__pp_async_start":True})
    check(status==202 and data.get("started"),label+"_start",{"status":status,"error":data.get("error")})
    try:
        for _ in range(100):
            time.sleep(1)
            status,data=call("/api/plan-progress")
            if status!=200: raise AssertionError(label+"_progress_http_"+str(status))
            if data.get("success") and not data.get("running"):
                result=data.get("result") or {}
                check(result.get("valid") is True,label+"_valid")
                return result
            if not data.get("running") and data.get("phase") in ("failed","cancelled","interrupted","timed_out","stale","invalid"):
                raise AssertionError(label+"_terminal_"+str(data.get("error")))
        raise AssertionError(label+"_qa_wait_exceeded")
    finally:
        # Stop ONLY the disposable QA account if it is still running.
        if data.get("running"): call("/api/optimizer-stop","POST",{})

def audit(plan,model,start_offset,label):
    operations=plan.get("generic_operations") or plan.get("operations") or []
    rows=[r for r in operations if not r.get("is_setup")]
    check(bool(rows),label+"_nonempty")
    quantities={}
    intervals=[]
    for r in rows:
        s,e=float(r["start_min"]),float(r["end_min"])
        q=float(r.get("batch_quantity",r.get("quantity",0)))
        check(math.isfinite(q) and q>0 and q<=model["equipment"][0]["capacity"]+1e-6,label+"_capacity",q)
        quantities[str(r["order"])]=quantities.get(str(r["order"]),0)+q
        check(e>s and s>=0,label+"_positive_interval",[s,e])
        # Each fixture is on one day; the shift windows are relative to the model start.
        check(any(s>=a-1e-6 and e<=b+1e-6 for a,b in [(0,240-start_offset),(300-start_offset,540-start_offset)]),
              label+"_no_break_overlap",[s,e])
        intervals.append((s,e,q,str(r["order"])))
    intervals.sort()
    for left,right in zip(intervals,intervals[1:]):
        check(left[1]<=right[0]+1e-6,label+"_no_resource_overlap")
    check(all(abs(quantities.get(str(o["id"]),0)-o["quantity"])<1e-6 for o in model["orders"]),
          label+"_all_volume_conserved",quantities)
    check(abs(float(plan["duration_minutes"])-max(x[1] for x in intervals))<1e-6,label+"_real_finish")
    print("BATCH_BREAK_PLAN",label,json.dumps({"finish":plan["duration_minutes"],"rows":intervals}),flush=True)
    return intervals

def ready_work():
    m=model_base("2026-11-25T08:00:00",200)
    for oid,duration in [("LONG",205),("TOO_LONG",40),("FITS",30)]: add_order(m,oid,200,duration)
    prepare(m,"ready_work")
    result=run("ready_work",17)
    rows=audit(result,m,0,"ready_work")
    check(float(result["duration_minutes"])<=340+1e-6,"ready_work_fills_35_minute_window",rows)

def proportional_work():
    # 235 working minutes remain before lunch at 08:05. A 250-piece
    # order with a 200-piece capacity and 60 pcs/h requires at least
    # three mini-batches to use the 35-minute remainder before lunch.
    profile={"mode":"throughput","type":"throughput","value":60,"throughput":60,
             "throughput_per_hour":60,"unit":"pcs/h"}
    m=model_base("2026-11-25T08:05:00",200,profile)
    add_order(m,"VOLUME",250,200)
    prepare(m,"proportional_work")
    result=run("proportional_work",19)
    rows=audit(result,m,5,"proportional_work")
    check(all(abs((e-s)-q)<1e-5 for s,e,q,_ in rows),"proportional_profile_recognized",rows)
    check(len(rows)>=3,"proportional_search_splits_below_maximum",rows)
    check(float(result["duration_minutes"])<=310+1e-6,"proportional_fills_before_lunch",rows)

if __name__=="__main__":
    failures=[]
    for case in (ready_work,proportional_work):
        try: case()
        except Exception as exc:
            failures.append(case.__name__)
            print("BATCH_BREAK_QA_CASE_FAILED",case.__name__,type(exc).__name__,str(exc)[:200],flush=True)
    if failures: raise SystemExit("BATCH_BREAK_QA_FAILED "+",".join(failures))
    print("BATCH_BREAK_QA_PASS")
