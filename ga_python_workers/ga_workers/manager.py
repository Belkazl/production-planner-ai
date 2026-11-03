"""Per-account, bounded OS-process supervisor with cooperative progress and hard cancellation.

The caller must supply an account_id it has *already authenticated*. The
manager deliberately does not parse request cookies or accept an account ID
from an untrusted optimization payload.

Each job runs in its own fresh Python process, with no mutable global model or
optimizer state shared between accounts. Cancellation uses SIGTERM followed
by SIGKILL if necessary. A production GA is provided through a trusted adapter
module configured by the service operator, not the caller.
"""
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
import importlib
import multiprocessing
import os
import threading
import time
import uuid
from typing import Optional


class JobConflict(Exception):
    pass


class JobNotFound(Exception):
    pass


class ForbiddenJob(Exception):
    pass


class ServiceBusy(Exception):
    pass


TERMINAL = frozenset({"completed", "cancelled", "failed", "timed_out"})


def _worker(conn, adapter_path, payload):
    """Runs in a separate OS process, not inside an HTTP request thread."""
    try:
        module_name, name = adapter_path.split(":", 1)
        callback = getattr(importlib.import_module(module_name), name)

        def progress(snapshot):
            if isinstance(snapshot, dict):
                try:
                    conn.send({"type": "progress", "data": snapshot})
                except (BrokenPipeError, EOFError, OSError):
                    pass

        result = callback(payload, progress)
        conn.send({"type": "result", "data": result})
    except BaseException as exc:
        try:
            # Never return a traceback or environment variables to API clients.
            conn.send({"type": "error", "error": type(exc).__name__})
        except (BrokenPipeError, EOFError, OSError):
            pass
    finally:
        conn.close()


@dataclass
class _Job:
    job_id: str
    account_id: str
    payload: dict = field(repr=False)
    state: str = "queued"
    submitted_at: float = field(default_factory=time.monotonic)
    started_at: Optional[float] = None
    ended_at: Optional[float] = None
    pid: Optional[int] = None
    best_preview: Optional[dict] = field(default=None, repr=False)
    progress: int = 0
    result: Optional[dict] = field(default=None, repr=False)
    error: Optional[str] = None
    proc: Optional[multiprocessing.Process] = field(default=None, repr=False)
    pipe: object = field(default=None, repr=False)
    stop_requested: bool = False
    reaped: bool = False


class ProcessJobManager:
    def __init__(self, *, capacity=4, timeout_s=300, max_jobs=200,
                 adapter="ga_workers.fixture:run", allow_fixture=False):
        if not 1 <= int(capacity) <= 32:
            raise ValueError("capacity must be 1..32")
        if not 1 <= float(timeout_s) <= 3600:
            raise ValueError("timeout_s must be 1..3600")
        if adapter == "ga_workers.fixture:run" and not allow_fixture:
            raise ValueError("fixture adapter is forbidden in production")
        if not isinstance(adapter, str) or ":" not in adapter:
            raise ValueError("adapter must be a trusted module:function")
        self.capacity = int(capacity)
        self.timeout_s = float(timeout_s)
        self.max_jobs = int(max_jobs)
        self.adapter = adapter
        self.ctx = multiprocessing.get_context("spawn")
        self.jobs = {}
        self.by_account = {}
        self.queue = deque()
        self.active = 0
        self.peak = 0
        self.closed = False
        self.lock = threading.RLock()
        self.cv = threading.Condition(self.lock)
        self.dispatcher = threading.Thread(target=self._dispatch, daemon=True, name="ga-worker-dispatch")
        self.dispatcher.start()

    def submit(self, account_id, payload):
        if not isinstance(account_id, str) or not account_id.strip() or len(account_id) > 256:
            raise ValueError("authenticated account_id required")
        if not isinstance(payload, dict) or not isinstance(payload.get("model"), dict):
            raise ValueError("account-owned model required")
        if not isinstance(payload["model"].get("orders"), list) or not payload["model"]["orders"]:
            raise ValueError("nonempty model orders required")
        with self.cv:
            if self.closed:
                raise RuntimeError("manager closed")
            existing_id = self.by_account.get(account_id)
            if existing_id and self.jobs[existing_id].state not in TERMINAL:
                raise JobConflict("account already has an active or queued optimization")
            self._reap_completed_locked()
            if len(self.jobs) >= self.max_jobs:
                raise ServiceBusy("job limit reached")
            job = _Job(job_id=uuid.uuid4().hex, account_id=account_id, payload=payload)
            self.jobs[job.job_id] = job
            self.by_account[account_id] = job.job_id
            self.queue.append(job.job_id)
            self.cv.notify_all()
            return self._snapshot_locked(job)

    def _get_owned_locked(self, account_id, job_id):
        job = self.jobs.get(job_id)
        if job is None:
            raise JobNotFound(job_id)
        if job.account_id != account_id:
            raise ForbiddenJob("job belongs to a different account")
        return job

    def get(self, account_id, job_id, *, include_plan=False):
        with self.cv:
            return self._snapshot_locked(self._get_owned_locked(account_id, job_id), include_plan)

    def stop(self, account_id, job_id):
        proc = None
        with self.cv:
            job = self._get_owned_locked(account_id, job_id)
            if job.state in TERMINAL:
                return self._snapshot_locked(job, include_plan=True)
            job.stop_requested = True
            job.state = "cancelled"
            job.ended_at = time.monotonic()
            if self.by_account.get(account_id) == job_id:
                self.by_account.pop(account_id, None)
            proc = job.proc
            self.cv.notify_all()
            snapshot = self._snapshot_locked(job, include_plan=True)
        if proc:
            self._terminate(proc)
            # Do not acknowledge stop while this account still occupies a
            # process slot. This only waits for its own watcher, never another
            # tenant's calculation.
            with self.cv:
                deadline = time.monotonic() + 4
                while not job.reaped and time.monotonic() < deadline:
                    self.cv.wait(timeout=0.05)
        return snapshot

    def _terminate(self, proc):
        try:
            if proc.is_alive():
                proc.terminate()
                proc.join(timeout=0.5)
                if proc.is_alive():
                    proc.kill()
                    proc.join(timeout=0.5)
        except (OSError, AssertionError, ValueError):
            pass

    def _snapshot_locked(self, job, include_plan=False):
        result = {"job_id": job.job_id, "status": job.state, "progress": job.progress,
                  "running": job.state == "running", "pid": job.pid,
                  "error": job.error, "best_preview": job.best_preview,
                  "duration_ms": (round(((job.ended_at or time.monotonic()) - job.started_at) * 1000)
                                  if job.started_at else None)}
        if include_plan and job.state == "completed":
            result["result"] = job.result
        return result

    def metrics(self):
        with self.cv:
            counts = {state: sum(j.state == state for j in self.jobs.values())
                      for state in ["queued", "running", "completed", "cancelled", "failed", "timed_out"]}
            return {"capacity": self.capacity, "active": self.active,
                    "peak": self.peak, "queue_depth": len([x for x in self.queue if self.jobs[x].state == "queued"]),
                    "total": len(self.jobs), "counts": counts}

    def _reap_completed_locked(self):
        if len(self.jobs) < self.max_jobs:
            return
        finished = sorted((j for j in self.jobs.values() if j.state in TERMINAL),
                          key=lambda j: j.ended_at or 0)
        for job in finished[:max(1, self.max_jobs // 4)]:
            self.jobs.pop(job.job_id, None)

    def _dispatch(self):
        while True:
            with self.cv:
                self.cv.wait_for(lambda: self.closed or (self.queue and self.active < self.capacity))
                if self.closed:
                    return
                job = self.jobs.get(self.queue.popleft())
                if job is None or job.state != "queued":
                    continue
                recv, send = self.ctx.Pipe(duplex=False)
                proc = self.ctx.Process(target=_worker, args=(send, self.adapter, job.payload), daemon=False)
                try:
                    proc.start()
                except BaseException:
                    recv.close()
                    send.close()
                    job.state = "failed"
                    job.error = "worker_start_failed"
                    job.ended_at = time.monotonic()
                    self.by_account.pop(job.account_id, None)
                    continue
                send.close()
                job.proc, job.pipe, job.pid = proc, recv, proc.pid
                job.payload = {}  # bound in the child; avoid retaining large models
                job.started_at, job.state = time.monotonic(), "running"
                self.active += 1
                self.peak = max(self.peak, self.active)
                threading.Thread(target=self._watch, args=(job,), daemon=True,
                                 name="ga-worker-watch-" + job.job_id[:8]).start()

    def _watch(self, job):
        proc, pipe = job.proc, job.pipe
        deadline = time.monotonic() + self.timeout_s
        disposition = None
        terminal_error = None
        try:
            while True:
                if time.monotonic() > deadline:
                    with self.cv:
                        if job.state == "running" and not job.stop_requested:
                            disposition = "timed_out"
                            terminal_error = "worker_timeout"
                    self._terminate(proc)
                    break
                if pipe.poll(0.03):
                    try:
                        msg = pipe.recv()
                    except (EOFError, OSError):
                        break
                    with self.cv:
                        if job.state != "running":
                            continue
                        if msg.get("type") == "progress":
                            data = msg.get("data") or {}
                            job.progress = min(99, max(job.progress, int(data.get("percent", 0))))
                            if isinstance(data.get("best_preview"), dict):
                                job.best_preview = data["best_preview"]
                        elif msg.get("type") == "result":
                            # A result is not externally terminal until the OS
                            # process is reaped and its worker slot is released.
                            job.result = msg.get("data")
                            disposition = "completed"
                        elif msg.get("type") == "error":
                            disposition = "failed"
                            terminal_error = str(msg.get("error") or "worker_failed")[:128]
                if disposition is not None:
                    break
                with self.cv:
                    if job.state in TERMINAL:
                        break
                if not proc.is_alive() and not pipe.poll():
                    break
        finally:
            self._terminate(proc)
            try:
                pipe.close()
            except OSError:
                pass
            with self.cv:
                self.active = max(0, self.active - 1)
                job.reaped = True
                if job.state == "running":
                    job.state = disposition or "failed"
                    if job.state == "completed":
                        job.progress = 100
                    else:
                        job.error = terminal_error or "worker_exited_without_result"
                    job.ended_at = time.monotonic()
                if self.by_account.get(job.account_id) == job.job_id:
                    self.by_account.pop(job.account_id, None)
                self.cv.notify_all()

    def wait(self, account_id, job_id, timeout=15):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            snap = self.get(account_id, job_id, include_plan=True)
            if snap["status"] in TERMINAL:
                return snap
            time.sleep(0.02)
        raise TimeoutError("job did not reach terminal state")

    def shutdown(self):
        with self.cv:
            self.closed = True
            for job in self.jobs.values():
                if job.state not in TERMINAL:
                    job.state = "cancelled"
                    job.ended_at = time.monotonic()
            procs = [j.proc for j in self.jobs.values() if j.proc is not None]
            self.cv.notify_all()
        for proc in procs:
            self._terminate(proc)
        self.dispatcher.join(timeout=1)