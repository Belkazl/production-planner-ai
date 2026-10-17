"""Isolated authenticated tenants: overlapping plan requests cannot share progress or stop."""
import concurrent.futures, json, time, urllib.request, urllib.error
ROOT="http://127.0.0.1:8080"
def call(path, tenant, method="GET", payload=None):
    headers={"Cookie":"pp_demo_auth="+tenant,"Accept":"application/json"}
    if method=="POST":
        headers["Origin"]=ROOT
        headers["Content-Type"]="application/json"
        payload=json.dumps(payload or {}).encode()
    req=urllib.request.Request(ROOT+path,headers=headers,method=method,data=payload)
    try:
        with urllib.request.urlopen(req,timeout=90) as r:return r.status,json.loads(r.read())
    except urllib.error.HTTPError as e:return e.code,json.loads(e.read())
def run(tenant):
    return call("/api/plan",tenant,"POST",{"generations":1,"population":2})
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    first=pool.submit(run,"tenantA")
    time.sleep(1)
    second=pool.submit(run,"tenantB")
    time.sleep(0.5)
    a_status,a_progress=call("/api/plan-progress","tenantA")
    b_status,b_progress=call("/api/plan-progress","tenantB")
    assert a_status==200 and b_status==200,(a_status,b_status)
    assert b_progress.get("phase")=="queued" and b_progress.get("best_preview") is None,b_progress
    bad_status,bad=call("/api/optimizer-stop","tenantB","POST",{})
    assert bad_status==200 and bad.get("queued") and bad.get("stopped"),(bad_status,bad)
    a_status,a_result=first.result(timeout=60)
    b_status,b_result=second.result(timeout=60)
    assert a_status==200 and a_result.get("error")=="synthetic_slow_ga_finished",(a_status,a_result)
    assert b_status==409 and b_result.get("stopped"),(b_status,b_result)
    assert a_result!=b_result
    a_status,a_after=call("/api/plan-progress","tenantA")
    b_status,b_after=call("/api/plan-progress","tenantB")
    assert a_after.get("best_preview") is None and b_after.get("best_preview") is None
    assert a_after.get("phase")=="failed" and b_after.get("stopped"),(a_after,b_after)
print("TENANT_CONCURRENT_JOB_ISOLATION_PASS",flush=True)
