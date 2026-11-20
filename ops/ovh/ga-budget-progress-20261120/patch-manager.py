"""Small guarded patch: report elapsed hard-budget work via native SSE events."""
import pathlib,sys,hashlib
if len(sys.argv)!=3: raise SystemExit("GA_TIME_BUDGET_PATCH_PATHS_REQUIRED")
source=pathlib.Path(sys.argv[1]).read_text()
def replace(a,b):
    global source
    if source.count(a)!=1: raise RuntimeError("GA_TIME_BUDGET_SOURCE_DRIFT:"+str(source.count(a))+":"+a[:72])
    source=source.replace(a,b)
replace(
    'TERMINAL = frozenset({"completed", "cancelled", "failed", "timed_out"})',
    '''TERMINAL = frozenset({"completed", "cancelled", "failed", "timed_out"})

def _budget_progress(now, started_at, timeout_s):
    """Elapsed fraction of the real configured hard compute budget (0..99)."""
    if started_at is None or timeout_s <= 0:
        return 0
    return max(0, min(99, int(99.0 * max(0.0, now-started_at) / timeout_s)))
''')
replace(
    '''            while True:
                if time.monotonic() > deadline:
''',
    '''            while True:
                now = time.monotonic()
                # The hard worker time budget is a real completion boundary.
                # Generation % alone is misleading when a larger requested
                # depth cannot finish before the compute budget expires.
                with self.cv:
                    if job.state == "running" and not job.stop_requested:
                        budget_pct = _budget_progress(now, job.started_at, self.timeout_s)
                        if budget_pct > job.progress:
                            job.progress = budget_pct
                            job.event_seq += 1
                            self.cv.notify_all()
                if now > deadline:
''')
for guard in ["self.cv.notify_all()", "job.event_seq += 1",
              "checkpoint['optimization_termination_reason']='worker_time_budget'"]:
    if guard not in source: raise RuntimeError("GA_BUDGET_REQUIRED_GUARD_MISSING:"+guard)
pathlib.Path(sys.argv[2]).write_text(source)
print("GA_REAL_TIME_BUDGET_PROGRESS_PUSH_GUARDED_SOURCE_PASS",
      hashlib.sha256(source.encode()).hexdigest())
