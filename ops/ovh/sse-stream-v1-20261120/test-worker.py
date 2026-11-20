import sys,threading,time
from pathlib import Path
sys.path.insert(0,str(Path("new/ga_python_workers").resolve()))
from ga_workers.manager import ProcessJobManager,_Job,ForbiddenJob
m=ProcessJobManager(adapter="ga_workers.fixture:run",allow_fixture=True,capacity=1)
account="client-account"
jobid="a"*32
try:
    with m.cv:
        job=_Job(job_id=jobid,account_id=account,payload={})
        job.state="running"
        m.jobs[jobid]=job
        m.by_account[account]=jobid
    result=[]
    def wait():
        result.append(m.stream_wait(account,jobid,0,timeout=3))
    t=threading.Thread(target=wait,daemon=True)
    t.start()
    time.sleep(.16)
    assert t.is_alive(),"should wait for real worker event, not poll"
    with m.cv:
        job.progress=31
        job.stage="optimizing"
        job.event_seq+=1
        m.cv.notify_all()
    t.join(timeout=2)
    assert not t.is_alive()
    assert len(result)==1 and result[0]["progress"]==31
    assert result[0]["seq"]==1 and result[0]["stage"]=="optimizing"
    assert "best_preview" not in result[0] and "result" not in result[0]
    try:
        m.stream_wait("some-other-account",jobid,0,timeout=.1)
        raise AssertionError("foreign account stream must be denied")
    except ForbiddenJob:
        pass
    with m.cv:
        job.state="completed";job.progress=100;job.event_seq+=1
        m.cv.notify_all()
    assert m.stream_wait(account,jobid,1,timeout=.1)["status"]=="completed"
    print("PY_WORKER_CONDITION_NATIVE_PUSH_ACCOUNT_ISOLATION_NO_POLL_PASS")
finally:
    m.shutdown()
