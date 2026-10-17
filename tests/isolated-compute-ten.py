import concurrent.futures,json,os,time,urllib.request,urllib.error
HOST="http://127.0.0.1:8099";SECRET="local-fixture-secret"
def hit(method,path,owner,job,data=None):
 body=json.dumps(data).encode() if data is not None else (b"{}" if method=="POST" else None)
 req=urllib.request.Request(HOST+path,data=body,method=method,headers={
 "X-PP-Compute-Secret":SECRET,"X-PP-Tenant-Key":owner,"X-PP-Job-Id":job,
 "Cookie":"pp_demo_auth="+owner[:12],"X-PP-Client-Origin":"http://127.0.0.1:8080",
 "Content-Type":"application/json"})
 try:
  with urllib.request.urlopen(req,timeout=50) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:return e.code,json.load(e)
def run(i):
 owner=f"{i:064x}";job=f"{i:032x}"
 return i,hit("POST","/internal/plan",owner,job,{"fixture_owner":"tenant"+str(i)})
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
 fs=[pool.submit(run,i) for i in range(1,11)]
 time.sleep(.9)
 st,cap=hit("GET","/internal/capacity",f"{1:064x}",f"{1:032x}")
 assert st==200 and cap["peak"]==10,cap
 st,p=hit("GET","/internal/progress",f"{2:064x}",f"{2:032x}")
 assert st==200 and p["best_preview"]["operations"][0]["order"]=="tenant2",(st,p)
 st,foreign=hit("GET","/internal/progress",f"{3:064x}",f"{2:032x}")
 assert st==404,(st,foreign)
 for f in fs:
  i,(st,data)=f.result(timeout=35)
  assert st==200 and data["optimizer_tenant"]=="tenant"+str(i),(i,st,data)
  assert data["duration_minutes"]==i*30,(i,data)
print("TEN_ISOLATED_OS_PROCESSES_PASS",cap,flush=True)
