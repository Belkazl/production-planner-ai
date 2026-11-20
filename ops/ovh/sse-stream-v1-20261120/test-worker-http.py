import os,sys,json,threading,time,urllib.request,urllib.error
from pathlib import Path
sys.path.insert(0,str(Path("new/ga_python_workers").resolve()))
from ga_workers.manager import ProcessJobManager,_Job
from ga_workers.server import make_server
secret="s"*80
os.environ["PP_WORKER_INTERNAL_TOKEN"]=secret
principal="safe-account"
job_id="f"*32
manager=ProcessJobManager(adapter="ga_workers.fixture:run",allow_fixture=True,capacity=1)
server=None
try:
    with manager.cv:
        job=_Job(job_id=job_id,account_id=principal,payload={})
        job.state="running"
        job.event_seq=1
        manager.jobs[job_id]=job
        manager.by_account[principal]=job_id
    server=make_server(bind="127.0.0.1",port=0,manager=manager)
    thread=threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    url="http://127.0.0.1:%d/internal/jobs/%s/events" % (server.server_port,job_id)
    try:
        urllib.request.urlopen(urllib.request.Request(url),timeout=4)
        raise AssertionError("must refuse unauthenticated stream")
    except urllib.error.HTTPError as e:
        assert e.code==401
    req=urllib.request.Request(url,headers={"Authorization":"Bearer "+secret,
        "X-Authenticated-Account":principal,"Accept":"text/event-stream"})
    with urllib.request.urlopen(req,timeout=5) as response:
        assert response.status==200 and "text/event-stream" in response.headers.get("Content-Type","")
        first=[response.readline().decode().strip() for i in range(4)]
        assert any("event: progress" in line for line in first),first
        def change():
            time.sleep(.17)
            with manager.cv:
                job.progress=42;job.stage="optimizing";job.event_seq+=1
                manager.cv.notify_all()
            time.sleep(.19)
            with manager.cv:
                job.state="completed";job.progress=100;job.stage="completed";job.event_seq+=1
                manager.cv.notify_all()
        threading.Thread(target=change,daemon=True).start()
        frames=[]
        until=time.monotonic()+4
        while time.monotonic()<until:
            line=response.readline().decode(errors="replace").strip()
            if line.startswith("data: "):
                frames.append(json.loads(line[6:]))
                if frames[-1]["status"]=="completed":break
        assert frames and any(x["progress"]==42 for x in frames),frames
        assert frames[-1]["progress"]==100 and frames[-1]["status"]=="completed",frames
        assert all(not any(k in x for k in ("best_preview","result","operations","model")) for x in frames)
        print("PY_WORKER_HTTP_CHUNKED_SSE_ACCOUNT_AUTH_NATIVE_EVENT_PUSH_PASS")
finally:
    if server:
        server.shutdown()
        server.server_close()
    manager.shutdown()
