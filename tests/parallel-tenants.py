import concurrent.futures, json, time, urllib.request, urllib.error
BASE="http://127.0.0.1:8080"
def get(path,who,method="GET",body=None):
 h={"Cookie":"pp_demo_auth="+who,"Accept":"application/json"}
 if method=="POST":h.update({"Origin":BASE,"Content-Type":"application/json"})
 b=json.dumps(body or {}).encode() if method=="POST" else None
 req=urllib.request.Request(BASE+path,data=b,headers=h,method=method)
 try:
  with urllib.request.urlopen(req,timeout=90) as r:return r.status,json.loads(r.read())
 except urllib.error.HTTPError as e:return e.code,json.loads(e.read())
def submit(i):return get("/api/plan","tenant"+str(i),"POST",{"generations":12,"population":4})
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
 futures={pool.submit(submit,i):i for i in range(1,11)}
 time.sleep(.65)
 st,capacity=get("/api/optimizer-capacity","tenant1")
 assert st==200 and capacity["active"]==10,capacity
 for i in range(1,11):
  who="tenant"+str(i)
  st,p=get("/api/plan-progress",who)
  assert st==200 and p["running"] and p["best_preview"] is None,(who,p)
  assert "SHARED_GLOBAL" not in json.dumps(p),p
 st,conflict=get("/api/plan","tenant1","POST",{})
 assert st==409 and conflict["error"]=="optimization_already_running",(st,conflict)
 for f,i in futures.items():
  st,data=f.result(timeout=60)
  assert st==200 and data["optimizer_tenant"]=="tenant"+str(i),(i,st,data)
  assert data["duration_minutes"]==i*30,(i,data)
  assert data["operations"][0]["order"]=="tenant"+str(i),(i,data)
 st,capacity=get("/api/optimizer-capacity","tenant1")
 assert capacity["peak"]>=10,capacity
 for i in range(1,11):
  st,p=get("/api/plan-progress","tenant"+str(i))
  assert st==200 and p["success"] and p["best_preview"]["optimizer_tenant"]=="tenant"+str(i),(i,p)
 st,cross=get("/api/tenant-plan-result?job_id="+p["job_id"],"tenant1")
 assert st==404,(st,cross)
print("TEN_INDEPENDENT_PARALLEL_TENANT_PLANS_PASS",capacity,flush=True)
