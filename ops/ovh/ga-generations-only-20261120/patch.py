"""Guarded production patch: GA completion depends on generations, never wall time."""
from pathlib import Path
import sys,hashlib,ast
if len(sys.argv)!=2: raise SystemExit("GA_GENERATIONS_ROOT_REQUIRED")
root=Path(sys.argv[1])
manager=root/"ga_python_workers/ga_workers/manager.py"
server=root/"ga_python_workers/ga_workers/server.py"
source=manager.read_text()
app=server.read_text()
def one(s,a,b,label):
    n=s.count(a)
    if n!=1: raise RuntimeError("GA_GENERATIONS_SOURCE_DRIFT_"+label+"_"+str(n))
    return s.replace(a,b)
source=one(source,
    '    def __init__(self, *, capacity=4, timeout_s=300, max_jobs=200,',
    '    def __init__(self, *, capacity=4, timeout_s=0, max_jobs=200,',
    'default_no_timeout')
source=one(source,
    '        if not 1 <= float(timeout_s) <= 3600:\n            raise ValueError("timeout_s must be 1..3600")',
    '        if not 0 <= float(timeout_s) <= 3600:\n            raise ValueError("timeout_s must be 0..3600 (0 disables deadline)")',
    "optional_zero_deadline")
source=one(source,
    '        deadline = time.monotonic() + self.timeout_s',
    '        deadline = (time.monotonic() + self.timeout_s) if self.timeout_s > 0 else None',
    "no_worker_deadline")
start='                if time.monotonic() > deadline:\n'
end='                if pipe.poll(0.03):\n'
n=source.count(start)
if n!=1:raise RuntimeError("GA_GENERATIONS_TIMEOUT_BEGIN_DRIFT_"+str(n))
i=source.index(start)
j=source.index(end,i)
if j<=i:raise RuntimeError("GA_GENERATIONS_TIMEOUT_END_DRIFT")
original=source[i:j]
required=["checkpoint['optimization_completed_early']=True",
          "checkpoint['optimization_termination_reason']='worker_time_budget'",
          'disposition="completed"','disposition="timed_out"',
          'self._terminate(proc)','break']
for marker in required:
    if marker not in original:raise RuntimeError("GA_GENERATIONS_TIMEOUT_GUARD_MISSING_"+marker)
source=source[:i]+'''                # Explicit timeouts are reserved for isolated test workers.
                # Production passes timeout_s=0 so the GA must finish its
                # configured generation count, or be stopped by the user.
                if deadline is not None and time.monotonic() > deadline:
                    with self.cv:
                        if job.state == "running" and not job.stop_requested:
                            disposition="timed_out"
                            terminal_error="worker_timeout"
                    self._terminate(proc)
                    break
'''+source[j:]
app=one(app,
    '            timeout_s=int(os.getenv("PP_PY_GA_TIMEOUT_S", "600")))',
    '''            # Real GA work is controlled exclusively by the requested
            # number of generations; never turn a deadline into a "completed"
            # plan. User Stop/cancel and worker failures still work normally.
            timeout_s=0)''',
    "production_generations_only")
for name,text in [("manager",source),("server",app)]:
    ast.parse(text,filename=name+".py")
    print("GA_GENERATIONS_COMPILE_PASS",name,hashlib.sha256(text.encode()).hexdigest())
manager.write_text(source)
server.write_text(app)
assert "job.result=checkpoint" not in source
assert 'timeout_s=0)' in app
assert "deadline is not None" in source
print("GA_NO_WORKER_TIME_LIMIT_NO_PARTIAL_SUCCESS_PATCH_PASS")
