"""Run the existing Railway Python planner in a fresh child process per job.

This adapter only reads the legacy code from Railway env variables inside the
worker; it never exports that code or credentials. It must be tested with
production-compatible inputs before it can be enabled on the public app.
"""
import ctypes
import json
import os
import signal
import socket
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.request import Request, urlopen
from urllib.error import URLError

class LegacyGAError(RuntimeError):
    pass

def request(base, path, method="GET", body=None, timeout=5):
    encoded=None if body is None else json.dumps(body).encode("utf-8")
    req=Request(base+path, encoded, method=method, headers={"Content-Type":"application/json","Accept":"application/json"})
    with urlopen(req,timeout=timeout) as resp:
        return json.loads(resp.read(16_000_000))

def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1",0))
        return sock.getsockname()[1]

def death_signal():
    if sys.platform=="linux":
        try:ctypes.CDLL("libc.so.6").prctl(1,signal.SIGKILL)
        except Exception:pass

def safe_environment(port):
    allowed=("PATH","HOME","LANG","PYTHONPATH","PYTHONUNBUFFERED")
    prefixes=("PP_RUNTIME_SRC_","PP_GENERIC_","PP_OBJECTIVE_","PP_REAL_OPT_","PP_CAPACITY_","CAP_BATCH_PATCH","PP_CHANGEOVER_")
    env={k:v for k,v in os.environ.items() if k in allowed or k.startswith(prefixes)}
    for key in list(env):
        if any(t in key.upper() for t in ("SECRET","TOKEN","PASSWORD","API_KEY","DB_URL","DATABASE","POSTGRES","GROQ","OPENAI","STRIPE")):
            del env[key]
    env.update(PORT=str(port),HOST="127.0.0.1",PYTHONUNBUFFERED="1")
    return env

def verify_owned(plan, model):
    orders={str(x.get("id")) for x in model.get("orders",[])}
    operations=plan.get("generic_operations") or plan.get("operations") or []
    if not isinstance(operations,list) or not operations:
        raise LegacyGAError("plan_operations_missing")
    if any(x.get("order") is not None and str(x["order"]) not in orders for x in operations):
        raise LegacyGAError("foreign_orders_in_plan")
    return plan

def run(payload, progress):
    model=payload.get("model") if isinstance(payload,dict) else None
    if not isinstance(model,dict) or not model.get("orders"):
        raise LegacyGAError("account_model_required")
    if not os.environ.get("PP_GENERIC_RESTORE_LAUNCH_V2"):
        raise LegacyGAError("legacy_ga_source_unavailable")
    port=free_port()
    env=safe_environment(port)
    child=None
    try:
        child=subprocess.Popen([sys.executable,"-c","import os;exec(os.environ['PP_GENERIC_RESTORE_LAUNCH_V2'])"],
            env=env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
            start_new_session=True,preexec_fn=death_signal if sys.platform=="linux" else None)
        base="http://127.0.0.1:"+str(port)
        deadline=time.monotonic()+float(os.environ.get("PP_PY_LEGACY_BOOT_TIMEOUT_S","60"))
        while True:
            if child.poll() is not None:raise LegacyGAError("legacy_ga_boot_failed")
            try:
                request(base,"/api/model",timeout=.4)
                break
            except (URLError,TimeoutError,ValueError):
                if time.monotonic()>deadline:raise LegacyGAError("legacy_ga_boot_timeout")
                time.sleep(.15)
        imported=request(base,"/api/project/model/import","POST",{"model":model},timeout=20)
        if imported.get("ok") is False:raise LegacyGAError("legacy_ga_import_rejected")
        options=payload.get("options") or {}
        if not isinstance(options,dict):raise LegacyGAError("invalid_options")
        with ThreadPoolExecutor(max_workers=1) as pool:
            future=pool.submit(request,base,"/api/plan","POST",options,300)
            while not future.done():
                try:
                    status=request(base,"/api/plan-progress",timeout=1)
                    if isinstance(status,dict) and status.get("ok"):
                        for k in ("candidate_preview","best_preview"):
                            if isinstance(status.get(k),dict):verify_owned(status[k],model)
                        progress(status)
                except (URLError,TimeoutError,ValueError):pass
                time.sleep(.2)
            result=future.result()
        if not isinstance(result,dict) or result.get("ok") is False:
            raise LegacyGAError("legacy_ga_plan_failed")
        return verify_owned(result,model)
    finally:
        if child is not None and child.poll() is None:
            try:os.killpg(child.pid,signal.SIGTERM);child.wait(timeout=2)
            except (OSError,subprocess.TimeoutExpired):
                try:os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=1)
                except Exception:pass
