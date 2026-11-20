"""Real OS-process regression: no wall-clock completion for a running GA."""
import sys,time
from pathlib import Path
sys.path.insert(0,str(Path("new/ga_python_workers").resolve()))
from ga_workers.manager import ProcessJobManager

def sample(tag,cpu):
    return {
        "model":{"account_fixture_tag":tag,"orders":[{"id":"ORDER-"+tag}]},
        "test_cpu_seconds":cpu
    }

def run_case(timeout_s,cpu,expected):
    manager=ProcessJobManager(adapter="ga_workers.fixture:run",allow_fixture=True,
                              capacity=1,timeout_s=timeout_s)
    t=time.monotonic()
    try:
        job=manager.submit("one-account-"+str(timeout_s),sample(str(timeout_s),cpu))
        snap=manager.wait("one-account-"+str(timeout_s),job["job_id"],timeout=18)
        duration=round(time.monotonic()-t,2)
        assert snap["status"]==expected,(expected,snap["status"],duration)
        if expected=="completed":
            assert snap["progress"]==100
            assert snap["result"]["valid"] is True
            assert duration >= cpu*0.7,(duration,cpu)
        else:
            assert not snap.get("result"),"Never return a partial plan as a successful result"
            assert snap["progress"]!=100,"100% is reserved for actual completion"
        print("GA_GENERATION_ONLY_PROCESS_RESULT",{"timeout":timeout_s,
             "requested_cpu":cpu,"elapsed_s":duration,"status":snap["status"],
             "percent":snap["progress"]},flush=True)
    finally:
        manager.shutdown()

if __name__=="__main__":
    run_case(timeout_s=0,cpu=2.5,expected="completed")
    run_case(timeout_s=1,cpu=3.5,expected="timed_out")
    print("GA_RUN_UNTIL_COMPLETE_WITHOUT_TIME_LIMIT_AND_NO_EARLY_SUCCESS_PASS")
