#!/usr/bin/env python3
"""Synthetic-account acceptance for OVH async GA, no customer project access."""
import json, secrets, time, urllib.error, urllib.request, uuid, sys
import http.cookiejar

base = "http://127.0.0.1:18082"
jar = http.cookiejar.CookieJar()
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def call(path, method="GET", payload=None):
    head={"Origin":"https://app.liftorbit.app", "Sec-Fetch-Site":"same-origin", "Accept":"application/json"}
    raw=None
    if payload is not None:
        head["Content-Type"]="application/json"
        raw=json.dumps(payload,separators=(",",":")).encode()
    req=urllib.request.Request(base+path,method=method,headers=head,data=raw)
    try:
        with client.open(req,timeout=30) as resp:code=resp.status; body=resp.read(250000)
    except urllib.error.HTTPError as e:code=e.code;body=e.read(250000)
    try:value=json.loads(body)
    except:value={}
    return code,value

def verify(yes,label,detail=""):
    if not yes:raise RuntimeError(label+":"+str(detail)[:90])
    print("OVH_GA_ACCEPTANCE_PASS",label,flush=True)

def sample():
    eid,pid,mid,tp="QA_EQ","QA_PERSON","QA_PAINT","QA_TP"
    req=lambda typ,ref:{"resource_type":typ,"match_mode":"specific","resource_ref":ref,"resource_refs":[ref],"quantity":1}
    return {"scheduler_mode":"resource","start":"2026-11-10T08:00:00",
        "equipment":[{"id":eid,"name":"Station","kind":"workstation","capacity":10,"capacity_unit":"pcs"}],
        "employees":[{"id":pid,"name":"Operator","role":"operator","shift":"day"}],
        "shifts":{"day":[["08:00","12:00"],["13:00","17:00"]]},
        "orders":[{"id":"QA_ORD_A","quantity":5,"unit":"pcs","technical_process_id":tp,"parameters":{"color":"A"}},
                  {"id":"QA_ORD_B","quantity":5,"unit":"pcs","technical_process_id":tp,"parameters":{"color":"B"}}],
        "technical_processes":[{"id":tp,"name":"Assembly","operations":[{
            "id":"QA_OP","name":"Press","sequence":1,"duration_min":30,"setup_parameter":"color",
            "resource_requirements":[req("equipment",eid),req("employee",pid),
                {"resource_type":"material","resource_ref":mid,"resource_refs":[mid],"quantity":1,"consumption_rule":"per_unit"}]}]}],
        "materials":[{"id":mid,"name":"Paint","unit":"kg","initial_stock":20,"deliveries":[]}],
        "setup_rules":[{"id":"QA_AB","setup_parameter":"color","equipment_ref":"*","from_state":"A","to_state":"B","duration_min":15},
                       {"id":"QA_BA","setup_parameter":"color","equipment_ref":"*","from_state":"B","to_state":"A","duration_min":15}]}

try:
    user="ovh-async-"+uuid.uuid4().hex+"@liftorbit.invalid"
    status,data=call("/api/auth/register","POST",{"email":user,"password":secrets.token_urlsafe(32),"company":"Migration GA QA"})
    verify(status==200 and data.get("ok") and len(jar)>0,"synthetic_user_registered",status)
    model=sample(); project="ovh-qa-"+uuid.uuid4().hex
    storage={"prodplan.projects.v2":json.dumps([{"id":project,"name":"QA","model":model}]),
             "prodplan.project.active.v2":project}
    status,data=call("/api/db-storage","POST",{"storage":storage})
    verify(status==200 and data.get("ok"),"synthetic_project_saved",status)
    status,data=call("/api/model")
    verify(status==200 and data.get("model",{}).get("orders",[{}])[0].get("id")=="QA_ORD_A","same_account_model_loaded",status)
    status,data=call("/api/plan","POST",{"generations":8,"population":12,"seed":4,"__pp_async_start":True})
    verify(status==202 and data.get("ok") and data.get("started") and data.get("job_id"),"async_start_HTTP_202",status)
    deadline=time.monotonic()+150
    first=None; completed=False
    while time.monotonic()<deadline:
        time.sleep(2)
        status,data=call("/api/plan-progress")
        verify(status==200 and data.get("ok"),"progress_response",status)
        phase=data.get("phase")
        if first is None:
            first=phase
            print("OVH_GA_INITIAL_PHASE",str(phase)[:30],flush=True)
        if phase=="idle":raise RuntimeError("optimization_stuck_in_idle")
        if data.get("running"):continue
        if data.get("success") and data.get("result",{}).get("operations"):
            result=data["result"]
            orders={x.get("order") for x in result["operations"] if x.get("order") is not None}
            verify(bool(orders) and orders.issubset({"QA_ORD_A","QA_ORD_B"}),"tenant_plan_isolated")
            verify(len(result["operations"])>0,"GA_completed_with_plan")
            completed=True
            break
        raise RuntimeError("GA_ended_"+str(phase)+"_"+str(data.get("error"))[:60])
    verify(completed,"GA_async_completion")
    status,data=call("/api/auth/logout","POST",{})
    verify(status==200,"logout")
    print("OVH_PRODUCTION_LIKE_ASYNC_GA_FULL_ACCEPTANCE_OK",flush=True)
except Exception as exc:
    print("OVH_GA_ACCEPTANCE_FAILED",type(exc).__name__,str(exc)[:130],flush=True)
    sys.exit(1)
