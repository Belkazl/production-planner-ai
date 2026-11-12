import importlib.util,uuid,secrets,json,time,urllib.request,urllib.error,sys
BASE="https://app.liftorbit.app"
spec=importlib.util.spec_from_file_location("hv","ops/ops/ovh/test-high-volume-ga.py")
# Deliberately do not execute the high-volume acceptance module: it has __main__ actions.
cookie=""
def request(path,method="GET",payload=None):
    global cookie
    headers={"Origin":BASE,"Sec-Fetch-Site":"same-origin","Accept":"application/json"}
    if cookie:headers["Cookie"]=cookie
    if payload is not None:headers["Content-Type"]="application/json"
    req=urllib.request.Request(BASE+path,method=method,headers=headers,data=json.dumps(payload).encode() if payload is not None else None)
    try:
        with urllib.request.urlopen(req,timeout=20) as r:
            status=r.status;raw=r.read(2000000)
            if path=="/api/auth/register":cookie=(r.headers.get("set-cookie") or "").split(";")[0]
    except urllib.error.HTTPError as e:
        status=e.code;raw=e.read(2000000)
    try:data=json.loads(raw)
    except:data={}
    return status,data
req=lambda typ,ref:{"resource_type":typ,"match_mode":"specific","resource_ref":ref,"resource_refs":[ref],"quantity":1}
model={"scheduler_mode":"resource","start":"2026-11-11T08:00:00","equipment":[{"id":"EQ"+str(i),"name":"Machine"+str(i),"kind":"workstation","capacity":600,"capacity_unit":"m2"} for i in range(14)],"employees":[{"id":"EM"+str(i),"name":"Employee"+str(i),"shift":"day"} for i in range(5)],"shifts":{"day":[["08:00","12:00"],["13:00","17:00"]]},"orders":[{"id":"ORD"+str(i),"quantity":600,"unit":"m2","technical_process_id":"TP","parameters":{"color":"A" if i%2 else "B"}} for i in range(12)],"technical_processes":[{"id":"TP","name":"7 steps","operations":[{"id":"OP"+str(j),"name":"Step"+str(j),"sequence":j+1,"duration_min":30,"resource_requirements":[req("equipment","EQ"+str(j)),req("employee","EM"+str(j%5))]} for j in range(7)]}],"materials":[],"setup_rules":[]}
def main():
    email="preview-probe-"+uuid.uuid4().hex+"@liftorbit.invalid"
    status,d=request("/api/auth/register","POST",{"email":email,"password":secrets.token_urlsafe(32),"company":"Temporary preview QA"})
    if status!=200 or not cookie:raise RuntimeError("REGISTER_"+str(status))
    p="preview-probe-"+uuid.uuid4().hex
    status,d=request("/api/db-storage","POST",{"storage":{"prodplan.projects.v2":json.dumps([{"id":p,"name":"QA","model":model}]),"prodplan.project.active.v2":p}})
    if status!=200:raise RuntimeError("STORAGE_"+str(status))
    status,d=request("/api/plan","POST",{"generations":120,"population":32,"seed":1729,"objective":"duration","__pp_async_start":True})
    if status!=202:raise RuntimeError("START_"+str(status)+"_"+str(d.get("error")))
    seen=[]
    try:
        for i in range(20):
            time.sleep(2)
            status,d=request("/api/plan-progress")
            if status!=200:raise RuntimeError("POLL_"+str(status)+"_"+str(d.get("error")))
            b=d.get("best_preview") or {};c=d.get("candidate_preview") or {}
            sample={"pct":d.get("percent"),"phase":d.get("phase"),"running":d.get("running"),"best":len(b.get("operations") or []),"candidate":len(c.get("operations") or []),"done":d.get("done"),"total":d.get("total")}
            seen.append(sample)
            print("PREVIEW_PROBE",json.dumps(sample),flush=True)
            if not d.get("running"):break
    finally:
        if seen and seen[-1].get("running"):
            request("/api/optimizer-stop","POST",{})
    has_pct=any(isinstance(x["pct"],(int,float)) and x["pct"]>=3 for x in seen)
    has_preview=any(x["best"]>0 or x["candidate"]>0 for x in seen if x["running"])
    print("PREVIEW_PROBE_SUMMARY",json.dumps({"progress_gt_3pct":has_pct,"intermediate_received":has_preview,"samples":len(seen)}),flush=True)
if __name__=="__main__":
    try:main()
    except Exception as e:print("PREVIEW_PROBE_FAILED",type(e).__name__,str(e)[:110]);sys.exit(1)
