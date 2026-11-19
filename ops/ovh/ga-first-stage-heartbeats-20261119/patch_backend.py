#!/usr/bin/env python3
"""Guarded OVH-only patch: truthful first-plan *stages*, never invented percentages."""
from pathlib import Path
from hashlib import sha256
import sys

if len(sys.argv) != 2:
    raise SystemExit("GA_STAGE_ROOT_REQUIRED")
root=Path(sys.argv[1])
adapter=root/"ga_workers"/"full_runtime_adapter.py"
manager=root/"ga_workers"/"manager.py"
upstream=root/"python-ga-upstream.mjs"
if not all(p.is_file() for p in (adapter,manager,upstream)):
    raise SystemExit("GA_STAGE_EXPECTED_BACKEND_FILES_MISSING")

def once(src,old,new,label):
    n=src.count(old)
    if n!=1:
        raise RuntimeError("GA_STAGE_SOURCE_DRIFT_"+label+"_matches_"+str(n))
    return src.replace(old,new)

a=adapter.read_text()
m=manager.read_text()
u=upstream.read_text()
if sha256(a.encode()).hexdigest() != "74c3b7ce22867b01259572926e16350b2d0fa60a54684bb9e9000eedad031d13":
    raise RuntimeError("GA_STAGE_ADAPTER_PIN_MISMATCH")
if sha256(u.encode()).hexdigest() != "e552a2e213a5b9308e423c3cb94700e87b97ff2684dc4179433b33f3210834ad":
    raise RuntimeError("GA_STAGE_UPSTREAM_PIN_MISMATCH")
if "pp_ga_initial_stage_v1" in a+m+u:
    raise RuntimeError("GA_STAGE_ALREADY_APPLIED")

# The already-authenticated account's OS process is the only source of stage.
# Preserve percent semantics (1 until the GA publishes actual work), Stop,
# best-preview ownership, model hash, and the final completed=100 handshake.
a=once(a,
"    continuing=bool(opts.get('continue') or opts.get('continue_run'))\n    ga=_namespace()",
"    continuing=bool(opts.get('continue') or opts.get('continue_run'))\n"
"    progress({'percent':0,'phase':'starting','stage':'loading_runtime','running':True})\n"
"    ga=_namespace()", "ADAPTER_LOADING")
a=once(a,
"    normalized=ga['canonicalize_model'](original)",
"    progress({'percent':0,'phase':'starting','stage':'validating_model','running':True})\n"
"    normalized=ga['canonicalize_model'](original)","ADAPTER_VALIDATING")
a=once(a,
"    ga['CURRENT_MODEL']=normalized\n    ga['install_model'](normalized)",
"    ga['CURRENT_MODEL']=normalized\n"
"    progress({'percent':0,'phase':'starting','stage':'installing_model','running':True})\n"
"    ga['install_model'](normalized)","ADAPTER_INSTALL")
a=once(a,
"    progress({'percent':1,'phase':'starting','running':True})",
"    # pp_ga_initial_stage_v1: no guessed percent during the expensive first candidate.\n"
"    progress({'percent':1,'phase':'starting','stage':'building_first_plan','running':True})",
"ADAPTER_FIRST_CANDIDATE")
a=once(a,
"    last=(-1,0)\n    while task.is_alive():",
"    last=(-1,0)\n    last_stage_beat=time.monotonic()\n    while task.is_alive():",
"ADAPTER_HEARTBEAT_CLOCK")
a=once(a,
"                preview={'percent':min(99,max(1,pct)),'phase':snap.get('phase','optimizing'),'running':True}",
"                preview={'percent':min(99,max(1,pct)),'phase':snap.get('phase','optimizing'),\n"
"                         'stage':'optimizing' if pct>1 or best is not None else 'building_first_plan',\n"
"                         'running':True}",
"ADAPTER_ACTUAL_WORK_STAGE")
a=once(a,
"                last=(pct,1 if best is not None else 0)\n        except Exception:",
"                last=(pct,1 if best is not None else 0)\n"
"            # Heartbeats prove the first plan is actively being built. They\n"
"            # do not change the truthful percent or fabricate a schedule.\n"
"            if pct<=1 and best is None and time.monotonic()-last_stage_beat>=1.0:\n"
"                progress({'percent':1,'phase':'starting','stage':'building_first_plan','running':True})\n"
"                last_stage_beat=time.monotonic()\n"
"        except Exception:",
"ADAPTER_REAL_STAGE_HEARTBEAT")
a=once(a,
"    result=state.get('result')",
"    progress({'percent':min(99,max(1,last[0])),'phase':'finalizing','stage':'finalizing','running':True})\n"
"    result=state.get('result')","ADAPTER_FINALIZING")
a=once(a,
"    progress({'percent':100,'phase':'complete','running':False,'best_preview':result})",
"    progress({'percent':100,'phase':'complete','stage':'completed','running':False,'best_preview':result})",
"ADAPTER_COMPLETED")

m=once(m,
"    progress: int = 0\n    result: Optional[dict]",
"    progress: int = 0\n    stage: str = 'queued'  # pp_ga_initial_stage_v1; no account data\n    result: Optional[dict]",
"MANAGER_STAGE_FIELD")
m=once(m,
'        result = {"job_id": job.job_id, "status": job.state, "progress": job.progress,\n                  "running": job.state == "running", "pid": job.pid,',
'        result = {"job_id": job.job_id, "status": job.state, "progress": job.progress,\n                  "stage": job.stage, "running": job.state == "running", "pid": job.pid,',
"MANAGER_PUBLIC_SNAPSHOT")
m=once(m,
'                            job.progress = min(99, max(job.progress, int(data.get("percent", 0))))\n                            if isinstance(data.get("best_preview"), dict):',
'                            job.progress = min(99, max(job.progress, int(data.get("percent", 0))))\n'
'                            stage=data.get("stage")\n'
'                            if stage in {"loading_runtime","validating_model","installing_model",\n'
'                                         "building_first_plan","optimizing","finalizing","completed"}:\n'
'                                job.stage=stage\n'
'                            if isinstance(data.get("best_preview"), dict):',
"MANAGER_STAGE_RECEIVE")
m=once(m,
'                    if job.state == "completed":\n                        job.progress = 100\n                    else:\n                        job.error = terminal_error or "worker_exited_without_result"',
'                    if job.state == "completed":\n                        job.progress = 100\n                        job.stage = "completed"\n'
'                    else:\n                        job.stage = job.state\n                        job.error = terminal_error or "worker_exited_without_result"',
"MANAGER_TERMINAL")

u=once(u,
"  const response = (body, status=200) => Response.json(body,{status,headers:{'cache-control':'no-store'}});",
"  // pp_ga_initial_stage_v1: one cheap, validated response header avoids\n"
"  // reparsing multi-megabyte GA plans just to show startup activity.\n"
"  const stages=new Set(['queued','loading_runtime','validating_model','installing_model',\n"
"    'building_first_plan','optimizing','finalizing','completed']);\n"
"  const response = (body, status=200) => Response.json(body,{status,headers:{\n"
"    'cache-control':'no-store',\n"
"    ...(stages.has(body?.stage)?{'x-liftorbit-ga-stage':body.stage}:{})\n"
"  }});",
"UPSTREAM_RESPONSE_HEADER")
u=once(u,
"    const running=['queued','running'].includes(status.status),pct=Math.max(0,Math.min(100,Number(status.progress)||0));\n    return response({ok:true,running,success:status.status==='completed',done:pct,total:100,",
"    const running=['queued','running'].includes(status.status),pct=Math.max(0,Math.min(100,Number(status.progress)||0));\n"
"    const stage=stages.has(status.stage)?status.stage:(running?'queued':'completed');\n"
"    return response({ok:true,running,stage,success:status.status==='completed',done:pct,total:100,",
"UPSTREAM_STAGE_PAYLOAD")
# Keep all original public APIs, ownership checks, and final decisions in place.
for needle in ("async function progress(req)","account_plan_mismatch",
               "if(status.status==='completed')","rememberWorkerBest",
               "await save(principal,state)"):
    if needle not in u:raise RuntimeError("GA_STAGE_UPSTREAM_ORIGINAL_GUARD_MISSING_"+needle)

for path,content in [(adapter,a),(manager,m),(upstream,u)]:
    path.write_text(content)
print("GA_INITIAL_STAGE_BACKEND_PATCHED",{
  "adapter_sha":sha256(a.encode()).hexdigest()[:16],
  "manager_sha":sha256(m.encode()).hexdigest()[:16],
  "upstream_sha":sha256(u.encode()).hexdigest()[:16]})
