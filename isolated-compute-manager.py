"""LiftOrbit isolated legacy optimizer process manager.

Each accepted optimization runs in a NEW OS process executing the same original
production gateway code, loaded from PP_BACKEND_START_CMD. No mutable optimizer
globals, progress caches or model data are shared between jobs.

The manager is an internal service, never a public tenant API. All requests
must be authenticated at the LiftOrbit bridge AND carry PP_COMPUTE_SECRET.
"""
import hashlib
import hmac
import http.client
import json
import os
import re
import signal
import socket
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs

SECRET = os.environ.get("PP_COMPUTE_SECRET", "")
BACKEND_COMMAND = os.environ.get("PP_BACKEND_START_CMD", "")
CAPACITY = min(32, max(1, int(os.environ.get("PP_WORKER_POOL_SIZE", "10"))))
MAX_BODY = 2 * 1024 * 1024
MAX_RESPONSE = 12 * 1024 * 1024
START_TIMEOUT = 30
JOB_TIMEOUT = 360
HISTORY_TTL = 120
LOCK = threading.RLock()
ACTIVE = {}
HISTORY = {}
COUNTS = {"started": 0, "finished": 0, "peak": 0, "failed": 0}
JOB_PATTERN = re.compile(r"^[0-9a-f]{32,64}$")
SESSION_PATTERN = re.compile(r"^[0-9a-f]{64}$")

def json_bytes(data):
    return json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

def end_process(process):
    if process is None or process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    except Exception:
        process.terminate()
    try:
        process.wait(timeout=1.2)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except Exception:
            process.kill()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            pass

def allocated_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]

def wait_for_ready(job):
    start = time.monotonic()
    while time.monotonic() - start < START_TIMEOUT:
        if job["process"].poll() is not None:
            raise RuntimeError("backend_exited_before_ready")
        try:
            with socket.create_connection(("127.0.0.1", job["port"]), timeout=.4):
                return
        except OSError:
            time.sleep(.13)
    raise TimeoutError("backend_start_timeout")

def fetch_child(job, path, method="GET", body=None, timeout=20):
    conn = http.client.HTTPConnection("127.0.0.1", job["port"], timeout=timeout)
    headers = {"Connection": "close", "Accept": "application/json",
               "Cookie": job["cookie"], "Content-Type": "application/json"}
    if method == "POST":
        headers["Origin"] = job["origin"]
    try:
        conn.request(method, path, body=body, headers=headers)
        result = conn.getresponse()
        payload = result.read(MAX_RESPONSE + 1)
        if len(payload) > MAX_RESPONSE:
            raise ValueError("backend_response_too_large")
        # Response headers never relay Set-Cookie or sensitive backend metadata.
        return result.status, payload
    finally:
        conn.close()

def purge():
    now = time.monotonic()
    with LOCK:
        for job_id, (finished_at, _) in list(HISTORY.items()):
            if now - finished_at > HISTORY_TTL:
                HISTORY.pop(job_id, None)

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "LiftOrbitComputeIsolation/1.0"

    def log_message(self, format, *args):
        # Do not log cookies, job identifiers or production input.
        pass

    def send_json(self, code, obj):
        self.send_binary(code, json_bytes(obj))

    def send_binary(self, code, body):
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-PP-Compute-Isolation", "os-process-v1")
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def validate(self):
        supplied = self.headers.get("X-PP-Compute-Secret", "")
        if not SECRET or not hmac.compare_digest(SECRET, supplied):
            self.send_json(403, {"ok": False, "error": "forbidden"})
            return None
        owner = self.headers.get("X-PP-Tenant-Key", "")
        job_id = self.headers.get("X-PP-Job-Id", "")
        if not SESSION_PATTERN.fullmatch(owner) or not JOB_PATTERN.fullmatch(job_id):
            self.send_json(400, {"ok": False, "error": "bad_job_identity"})
            return None
        return owner, job_id

    def owned_job(self, owner, job_id):
        with LOCK:
            job = ACTIVE.get(job_id)
            if job is None or job["owner"] != owner:
                return None
            return job

    def do_GET(self):
        path = urlsplit(self.path).path
        # Safe liveness probe does not reveal worker metadata.
        if path == "/health":
            self.send_json(200, {"ok": True, "isolation": "os-process-v1"})
            return
        pair = self.validate()
        if not pair:
            return
        owner, job_id = pair
        if path == "/internal/capacity":
            with LOCK:
                self.send_json(200, {"ok": True, "running": len(ACTIVE),
                    "capacity": CAPACITY, "peak": COUNTS["peak"],
                    "completed": COUNTS["finished"]})
            return
        if path != "/internal/progress":
            self.send_json(404, {"ok": False, "error": "not_found"})
            return
        job = self.owned_job(owner, job_id)
        if job is None:
            self.send_json(404, {"ok": False, "error": "job_not_found"})
            return
        try:
            status, body = fetch_child(job, "/api/plan-progress", timeout=8)
            if status != 200:
                self.send_json(502, {"ok": False, "error": "progress_unavailable"})
                return
            data = json.loads(body)
            if not isinstance(data, dict):
                raise ValueError("bad_progress")
            # A preview is saved only from the process belonging to this job.
            best = data.get("best_preview") or data.get("candidate_preview")
            if isinstance(best, dict) and best.get("operations"):
                with LOCK:
                    if job.get("best") is None or float(best.get("duration_minutes", float("inf"))) < float(job["best"].get("duration_minutes", float("inf"))):
                        job["best"] = best
            self.send_json(200, data)
        except (OSError, TimeoutError, ValueError, json.JSONDecodeError):
            self.send_json(502, {"ok": False, "error": "progress_unavailable"})

    def do_POST(self):
        path = urlsplit(self.path).path
        pair = self.validate()
        if not pair:
            return
        owner, job_id = pair
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            size = -1
        if size < 0 or size > MAX_BODY:
            self.send_json(413, {"ok": False, "error": "invalid_body_size"})
            return
        body = self.rfile.read(size)
        if path == "/internal/stop":
            job = self.owned_job(owner, job_id)
            if job is None:
                self.send_json(404, {"ok": False, "error": "job_not_found"})
                return
            with LOCK:
                best = job.get("best")
                if not best:
                    self.send_json(409, {"ok": False, "error": "no_complete_plan_yet"})
                    return
                job["stopped"] = True
            end_process(job["process"])
            self.send_json(200, {"ok": True, "stopped": True,
                                 "best_preview": best, "variants": [{"plan": best}]})
            return
        if path != "/internal/plan":
            self.send_json(404, {"ok": False, "error": "not_found"})
            return
        cookie = self.headers.get("Cookie", "")
        origin = self.headers.get("X-PP-Client-Origin", "https://app.liftorbit.app")
        if not cookie or len(cookie) > 8192 or not origin.startswith(("https://", "http://")):
            self.send_json(400, {"ok": False, "error": "session_required"})
            return
        if not BACKEND_COMMAND:
            self.send_json(503, {"ok": False, "error": "compute_backend_not_configured"})
            return
        try:
            json.loads(body)
        except (ValueError, UnicodeDecodeError):
            self.send_json(400, {"ok": False, "error": "invalid_plan_json"})
            return
        purge()
        with LOCK:
            if job_id in ACTIVE or job_id in HISTORY:
                self.send_json(409, {"ok": False, "error": "job_id_already_exists"})
                return
            if len(ACTIVE) >= CAPACITY:
                self.send_json(503, {"ok": False, "error": "compute_capacity_reached"})
                return
            if any(j["owner"] == owner for j in ACTIVE.values()):
                self.send_json(409, {"ok": False, "error": "optimization_already_running"})
                return
            port = allocated_port()
            env = os.environ.copy()
            env["PORT"] = str(port)
            env["HOST"] = "127.0.0.1"
            # Backend runtime must retain the original calculation code/DB config.
            process = subprocess.Popen(BACKEND_COMMAND, shell=True,
                start_new_session=True, env=env,
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL)
            job = {"owner": owner, "id": job_id, "cookie": cookie,
                   "origin": origin, "port": port, "process": process,
                   "best": None, "stopped": False, "started": time.monotonic()}
            ACTIVE[job_id] = job
            COUNTS["started"] += 1
            COUNTS["peak"] = max(COUNTS["peak"], len(ACTIVE))
        try:
            wait_for_ready(job)
            result, raw = fetch_child(job, "/api/plan", method="POST", body=body,
                                      timeout=JOB_TIMEOUT)
            if job["stopped"]:
                self.send_json(409, {"ok": False, "stopped": True,
                                     "error": "optimization_stopped"})
            else:
                self.send_binary(result, raw)
        except (OSError, TimeoutError, ValueError, RuntimeError) as exc:
            with LOCK:
                COUNTS["failed"] += 1
            if job["stopped"]:
                self.send_json(409, {"ok": False, "stopped": True, "error": "optimization_stopped"})
            else:
                print("PP_COMPUTE_CHILD_FAILED", type(exc).__name__, flush=True)
                self.send_json(502, {"ok": False, "error": "compute_worker_failed"})
        finally:
            end_process(job["process"])
            with LOCK:
                ACTIVE.pop(job_id, None)
                HISTORY[job_id] = (time.monotonic(), owner)
                COUNTS["finished"] += 1
                job["cookie"] = ""

if __name__ == "__main__":
    if not SECRET:
        raise SystemExit("PP_COMPUTE_SECRET is required")
    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    server.daemon_threads = True
    print("PP_ISOLATED_COMPUTE_MANAGER_READY", CAPACITY, flush=True)
    server.serve_forever(poll_interval=.25)
