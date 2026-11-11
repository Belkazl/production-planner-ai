#!/usr/bin/env python3
"""Run large synthetic LiftOrbit model and storage load without touching customer accounts."""
import json, secrets, time, urllib.error, urllib.request, uuid, sys
BASE="http://127.0.0.1:18082"
cookie=""
def call(path,method="GET",body=None):
  global cookie
  headers={"Origin":"https://app.liftorbit.app","Sec-Fetch-Site":"same-origin","Accept":"application/json"}
  if cookie: headers["Cookie"]=cookie
  data=None
  if body is not None:
    headers["Content-Type"]="application/json"
    data=json.dumps(body,separators=(",",":")).encode()
  req=urllib.request.Request(BASE+path,headers=headers,data=data,method=method)
  started=time.monotonic()
  try:
    with urllib.request.urlopen(req,timeout=30) as r:
      status=r.status;raw=r.read(18_000_000)
      if path=="/api/auth/register":cookie=(r.headers.get("set-cookie") or "").split(";")[0]
  except urllib.error.HTTPError as e:
    status=e.code;raw=e.read(18_000_000)
  try:obj=json.loads(raw)
  except:obj={}
  return status,obj,round((time.monotonic()-started)*1000)
def check(ok,label,extra=None):
  print("HIGH_VOLUME_GA_TEST",label,"pass" if ok else "FAIL",str(extra or "")[:100],flush=True)
  if not ok:raise RuntimeError(label)
def model():
  req=lambda typ,ref:{"resource_type":typ,"match_mode":"specific","resource_ref":ref,"resource_refs":[ref],"quantity":1}
  eq=[{"id":"QA_EQ_"+str(n),"name":"Machine "+str(n),"kind":"workstation","capacity":600,"capacity_unit":"m2"} for n in range(14)]
  staff=[{"id":"QA_EMP_"+str(n),"name":"Operator "+str(n),"role":"operator","shift":"day"} for n in range(5)]
  ops=[{"id":"QA_OP_"+str(n),"name":"Stage "+str(n),"sequence":n+1,"duration_min":30,
       "setup_parameter":"color","resource_requirements":[req("equipment","QA_EQ_"+str(n)),req("employee","QA_EMP_"+str(n%5)),
       {"resource_type":"material","resource_ref":"QA_MAT","resource_refs":["QA_MAT"],"quantity":1,"consumption_rule":"per_unit"}]} for n in range(7)]
  orders=[{"id":"QA_ORD_"+str(n).zfill(2),"quantity":600,"unit":"m2","technical_process_id":"QA_TP",
      "parameters":{"color":"A" if n%2 else "B"}} for n in range(12)]
  return {"scheduler_mode":"resource","start":"2026-11-10T08:00:00","equipment":eq,"employees":staff,
          "shifts":{"day":[["08:00","12:00"],["13:00","17:00"]]},"orders":orders,
          "technical_processes":[{"id":"QA_TP","name":"Seven-stage ceramics QA","operations":ops}],
          "materials":[{"id":"QA_MAT","name":"Glaze","unit":"kg","initial_stock":200000,"deliveries":[]}],
          "setup_rules":[{"id":"QA_AB","setup_parameter":"color","equipment_ref":"*","from_state":"A","to_state":"B","duration_min":15},
                         {"id":"QA_BA","setup_parameter":"color","equipment_ref":"*","from_state":"B","to_state":"A","duration_min":15}]}
try:
  email="stress-ga-"+uuid.uuid4().hex+"@liftorbit.invalid"
  status,r,_=call("/api/auth/register","POST",{"email":email,"password":secrets.token_urlsafe(32),"company":"Discardable stress QA"})
  check(status==200 and r.get("ok") and cookie,"registered")
  m=model();project="qa-"+uuid.uuid4().hex
  fake=[{"order":"QA_ORD_"+str(i%12).zfill(2),"operation_name":"Stage "+str(i%7),
         "start_min":i*10,"end_min":i*10+10,"equipment_ids":["QA_EQ_"+str(i%14)],
         "notes":"synthetic_non_customer_data_"+"x"*120} for i in range(882)]
  saved=[{"id":"QA_SAVED_"+str(i),"valid":True,"operations":fake,"duration_minutes":4500} for i in range(6)]
  storage={"prodplan.projects.v2":json.dumps([{"id":project,"name":"Synthetic high volume","model":m}]),
       "prodplan.project.active.v2":project,"qa.synthetic.saved_plans":json.dumps(saved)}
  status,r,ms=call("/api/db-storage","POST",{"storage":storage})
  check(status==200 and r.get("ok"),"saved_many_large_plans","status="+str(status)+" error="+str(r.get("error","none"))[:50]+" size="+str(round(len(json.dumps(storage))/1e6,2))+"MB")
  status,r,ms=call("/api/auth/me");check(status==200,"fast_session_verification",str(ms)+"ms")
  status,r,ms=call("/api/model");check(status==200 and len(r.get("model",{}).get("orders",[]))==12,"large_model_loaded",str(ms)+"ms")
  status,r,ms=call("/api/plan","POST",{"generations":2,"population":4,"seed":4,"__pp_async_start":True})
  check(status==202 and r.get("started"),"async_12_order_start",str(ms)+"ms")
  phases=[];last=None
  for k in range(6):
    time.sleep(2)
    status,r,ms=call("/api/plan-progress")
    check(status==200 and r.get("ok"),"large_progress_"+str(k),str(ms)+"ms")
    phase=r.get("phase");phases.append(phase)
    if not r.get("running"):
      check(r.get("success"),"large_job_completed",str(phase)+":"+str(r.get("error")))
      break
    last=r
  print("HIGH_VOLUME_GA_TEST phases",json.dumps(phases),flush=True)
  if last is None:
    status,r,ms=call("/api/optimizer-reset","POST",{})
    check(status==200 and r.get("ok"),"fresh_reset_after_completion",str(ms)+"ms")
    status,r,ms=call("/api/plan","POST",{"generations":500,"population":64,"seed":7,
      "__pp_async_start":True,"__pp_fresh_recovery":True})
    check(status==202 and r.get("started"),"long_ga_started_for_cancellation",str(ms)+"ms")
  status,r,ms=call("/api/optimizer-stop","POST",{})
  check(status==200 and r.get("ok") is True,"stop_heavy_job",str(ms)+"ms")
  status,r,ms=call("/api/plan-progress")
  check(status==200 and r.get("ok"),"progress_after_stop",str(ms)+"ms")
  print("HIGH_VOLUME_GA_TEST_OK",flush=True)
except Exception as e:
  print("HIGH_VOLUME_GA_TEST_FAILED",type(e).__name__,str(e)[:100],flush=True)
  sys.exit(1)
