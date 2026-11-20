import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
const root=process.argv[2];if(!root)throw Error("PREVIEW_PATCH_ROOT_REQUIRED");
const target=n=>resolve(root,n);
const here="ops/ovh/four-second-fog-preview-20261120/";
const repl=(s,old,updated,label)=>{
 if(s.split(old).length!==2)throw Error("PREVIEW_SOURCE_DRIFT_"+label);
 return s.replace(old,updated);
};
const hash=s=>createHash("sha256").update(s).digest("hex");
let manager=readFileSync(target("ga_python_workers/ga_workers/manager.py"),"utf8");
manager=repl(manager,
 "    best_preview: Optional[dict] = field(default=None, repr=False)",
 "    best_preview: Optional[dict] = field(default=None, repr=False)\n    candidate_preview: Optional[dict] = field(default=None, repr=False)\n    candidate_serial: int = 0\n    preview_probe: Optional[dict] = field(default=None, repr=False)","manager_fields");
manager=repl(manager,
 '                  "error": job.error, "best_preview": job.best_preview,',
 '                  "error": job.error, "best_preview": job.best_preview,\n                  "candidate_preview": job.candidate_preview,\n                  "candidate_serial": job.candidate_serial,\n                  "preview_probe": job.preview_probe,',"manager_status");
manager=repl(manager,
 '                            if isinstance(data.get("best_preview"), dict):\n                                job.best_preview = data["best_preview"]',
 '                            if isinstance(data.get("best_preview"), dict):\n                                job.best_preview = data["best_preview"]\n                            if isinstance(data.get("candidate_preview"), dict):\n                                candidate = data["candidate_preview"]\n                                if (candidate.get("_pp_preview_limited") is True and\n                                    0 < len(candidate.get("operations") or []) <= 140):\n                                    job.candidate_preview = candidate\n                                    job.candidate_serial += 1\n                            if isinstance(data.get("preview_probe"),dict):\n                                job.preview_probe=data["preview_probe"]',"manager_progress");
let worker=readFileSync(target("ga_python_workers/ga_workers/full_runtime_adapter.py"),"utf8");
const capture=readFileSync(here+"worker-hook.py.txt","utf8");
worker=repl(worker,"    state={}\n    def compute():",capture+"    state={}\n    def compute():","worker_capture");
worker=repl(worker,
 "    last=(-1,0)\n    last_stage_beat=time.monotonic()",
 "    last=(-1,0)\n    last_candidate_serial=0\n    last_stage_beat=time.monotonic()","worker_tick_init");
worker=repl(worker,
 "            if (pct,last[1] if best is not None else 0)!=last:",
 "            current_serial=preview_slot['serial']\n            if (pct,last[1] if best is not None else 0)!=last or current_serial!=last_candidate_serial:","worker_tick_if");
worker=repl(worker,
 "                if isinstance(best,dict) and best.get('operations'):\n                    preview['best_preview']=best\n                progress(preview)\n                last=(pct,1 if best is not None else 0)",
 "                if isinstance(best,dict) and best.get('operations'):\n                    preview['best_preview']=best\n                if current_serial!=last_candidate_serial and isinstance(preview_slot['plan'],dict):\n                    preview['candidate_preview']=preview_slot['plan']\n                    last_candidate_serial=current_serial\n                preview['preview_probe']={\n                    'calls':preview_slot['calls'],'kind':preview_slot['kind'],\n                    'shape':preview_slot['shape'],'available':bool(schedule)}\n                progress(preview)\n                last=(pct,1 if best is not None else 0)","worker_tick_send");
let backend=readFileSync(target("python-ga-upstream.mjs"),"utf8");
const ownedPreview=readFileSync(here+"owned-preview.js.txt","utf8");
backend=repl(backend,"  async function progress(req){",ownedPreview+"  async function progress(req){","backend_preview_validator");
backend=repl(backend,
 "    if(state.state==='completed'&&state.result){",
 '    const query=new URL(req.url).searchParams;\n    const previewOnly=query.has("ppPreview");\n    const lightOnly=query.has("ppLight");\n    if(lightOnly&&["queued","running"].includes(state.state))return response({\n      ok:true,job_id:state.id,running:true,success:false,\n      percent:state.progress||0,done:state.progress||0,total:100,\n      phase:state.state,stage:state.stage||"optimizing",\n      best_preview:null,candidate_preview:null,result:null,error:null});\n    if(state.state===\'completed\'&&state.result){',"backend_light");
backend=repl(backend,
 "      return response({ok:true,running:false,success:true,done:100,total:100,percent:100,phase:'completed',",
 "      if(previewOnly)return response({ok:true,job_id:state.id,running:false,\n        success:true,percent:100,done:100,total:100,phase:'completed',\n        best_preview:null,candidate_preview:null,result:null,error:null});\n      return response({ok:true,running:false,success:true,done:100,total:100,percent:100,phase:'completed',","backend_done_preview");
backend=repl(backend,
 "    if(status.candidate_preview){\n      const liveCandidate=publicPlan(status.candidate_preview);\n      if(owned(liveCandidate,model))state.candidate=liveCandidate;",
 "    if(status.candidate_preview){\n      const liveCandidate=publicPlan(status.candidate_preview);\n      if(ownedCandidatePreview(liveCandidate,model))state.candidate=liveCandidate;","backend_candidate_accept");
backend=repl(backend,
 "    const running=['queued','running'].includes(status.status),pct=Math.max(0,Math.min(100,Number(status.progress)||0));",
 "    const running=['queued','running'].includes(status.status),pct=Math.max(0,Math.min(100,Number(status.progress)||0));\n    if(previewOnly)return response({ok:true,job_id:state.id,running,\n      stage:status.stage||null,success:status.status==='completed',\n      done:pct,total:100,percent:pct,phase:status.status,\n      candidate_preview:running?(state.candidate||null):null,\n      candidate_serial:status.candidate_serial||0,\n      preview_probe:status.preview_probe||null,\n      best_preview:null,result:null,error:state.error||null});","backend_return_preview");
backend=repl(backend,
 "    if(terminal||!state.lastPersistedAt||stamp-state.lastPersistedAt>=2000){",
 "    if(terminal||(!previewOnly&&(!state.lastPersistedAt||stamp-state.lastPersistedAt>=2000))){",
 "backend_no_heavy_preview_db_write");
let frontend=readFileSync(target("restart-optimizer-ui.js"),"utf8");
if(frontend.includes("ppFourSecondFogPreviewV1"))throw Error("FRONTEND_ALREADY_PATCHED");
for(const marker of ["ppNativeOneOwnerProgressV4","ppUnifiedGanttV2",
 "ppLargeGaProgressLoadShedV1","ppAutomaticIntermediatePreviewV1"])
 if(!frontend.includes(marker))throw Error("FRONTEND_REQUIRED_MARKER_"+marker);
// Full completion remains worker-verified; accelerate the artificial catch-up
// so that the displayed progress does not sit at 24% while GA is already at 80.
frontend=repl(frontend,
 "stepMs=Math.min(700,Math.max(110,Math.round(Math.min(11500,elapsed*1.3)/gap)));",
 "stepMs=Math.min(250,Math.max(50,Math.round(Math.min(3700,elapsed)/gap)));",
 "progress_native_250ms");
frontend=repl(frontend,
 "const ms=Math.min(145,Math.max(60,Math.round(6500/Math.max(1,100-n))));",
 "const ms=Math.min(65,Math.max(35,Math.round(1800/Math.max(1,100-n))));",
 "progress_final_1800ms");
frontend=repl(frontend,
 'window.addEventListener("pp:optimizer-started",()=>{if(disposed)return;reset();queueMicrotask(()=>{attach();capture()})});',
 'window.addEventListener("pp:ga-light-progress",event=>{\n if(disposed||!wasRunning||!active())return;\n const number=clamp(event.detail?.percent);\n if(confirmed===null||number<=confirmed)return;\n const gap=Math.max(1,number-(shown||0));\n confirmed=number;lastNativeAt=Date.now();updates++;\n stepMs=Math.min(250,Math.max(50,Math.round(3000/gap)));\n button?.classList.remove("pp-ga-v4-busy");\n button?.removeAttribute("data-pp-ga-v4-label");\n});\nwindow.addEventListener("pp:optimizer-started",()=>{if(disposed)return;reset();queueMicrotask(()=>{attach();capture()})});',
 "progress_light_event");
frontend+="\n;"+readFileSync(here+"runtime.js","utf8")+"\n";
const files=[
 ["ga_python_workers/ga_workers/manager.py",manager],
 ["ga_python_workers/ga_workers/full_runtime_adapter.py",worker],
 ["python-ga-upstream.mjs",backend],
 ["restart-optimizer-ui.js",frontend]];
for(const [path,source] of files){
 writeFileSync(target(path),source);
 console.log("PREVIEW_PATCHED_FILE",path,hash(source),source.length);
}
execFileSync(process.execPath,[here+"auth-preview-route.mjs",root],{stdio:"inherit"});

