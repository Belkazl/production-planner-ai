// OVH-only guard: do not turn an outdated HTML compatibility transformer
// into HTTP 502 for an already authenticated LiftOrbit account.
// This patch is applied to the pinned application source copy before image build.
import {readFileSync,writeFileSync} from "node:fs";
import {resolve,join} from "node:path";
const root=resolve(process.argv[2]||"");
if(!root.endsWith("/app"))throw Error("REPAIR_REQUIRES_PINNED_APP_WORKTREE");
const file=join(root,"auth-runtime.js");
let source=readFileSync(file,"utf8");
function once(oldText,newText,label){
 const n=source.split(oldText).length-1;
 if(n!==1)throw Error("REPAIR_ANCHOR_"+label+"_"+n);
 source=source.replace(oldText,newText);
}
const liveOptimizerPreviewInline='<script id="pp-ovh-live-optimizer-preview">'+readFileSync(new URL("./live-optimizer-preview.js",import.meta.url),"utf8")+'</script>';
const legacyResumeSeedScript="<script id=\"pp-ovh-portable-legacy-continuation\">\n(function(){\n\"use strict\";\nwindow.__ppLegacyContinuationSeed=function(){\n try{\n  // An explicit fresh restart must never inherit the previous incumbent.\n  if(window.__ppFreshRestartPending||(window.__ppFreshRestartMode&&!window.__ppFreshReferencePlan))return null;\n  const key=localStorage.getItem(\"prodplan.project.active.v2\");\n  const list=JSON.parse(localStorage.getItem(\"prodplan.projects.v2\")||\"[]\");\n  const project=Array.isArray(list)?list.find(p=>p&&p.id===key):null;\n  if(!project)return null;\n  const plan=window.__ppFreshReferencePlan||window.__ppOptimizerCommittedPlan||window.__ppTabPlan||window.__ppResumeSavedPlan||project.lastPlan;\n  if(!plan||plan.valid===false||plan.partial)return null;\n  if(plan._revision!=null&&Number(plan._revision)!==Number(project.revision))return null;\n  let sequence=Array.isArray(plan.order_sequence)&&plan.order_sequence.length?plan.order_sequence.map(String):[];\n  if(!sequence.length){\n   const rows=Array.isArray(plan.generic_operations)&&plan.generic_operations.length?plan.generic_operations:plan.operations;\n   if(!Array.isArray(rows)||!rows.length)return null;\n   const seen=new Set();\n   sequence=rows.filter(x=>x&&x.order!=null&&!x.is_setup&&String(x.phase||\"\").toLowerCase()!==\"setup\")\n     .sort((a,b)=>(Number(a.start_min)||0)-(Number(b.start_min)||0)||(Number(a.end_min)||0)-(Number(b.end_min)||0))\n     .map(x=>String(x.order))\n     .filter(x=>{if(seen.has(x))return false;seen.add(x);return true});\n  }\n  if(!sequence.length||sequence.length>5000||new Set(sequence).size!==sequence.length)return null;\n  const duration=Number(plan.duration_minutes);\n  const runs=Number(plan.optimization_run);\n  const trials=Number(plan.total_generations);\n  return {order_sequence:sequence,\n   duration_minutes:Number.isFinite(duration)&&duration>=0?duration:null,\n   optimization_run:Number.isInteger(runs)&&runs>=1&&runs<=1000000?runs:1,\n   total_generations:Number.isInteger(trials)&&trials>=0&&trials<=100000000?trials:0};\n }catch{return null}\n};\n})();\n</script>";
const fallback=`
async function ppSafePlannerUiForAuthenticatedUser(req){
 try{
  return await handler(req);
 }catch(error){
  // A legacy HTML-rewrite module expects exact source anchors from the old
  // planner. If a newer planner does not contain them, serve its own page.
  // Never catch auth errors, API errors, arbitrary exceptions, or data writes.
  const code=String(error?.message||"");
  if(code!=="PP_OPT_ETALON_DECISION_ANCHOR_MISSING")throw error;
  console.warn("LIFTORBIT_UI_COMPATIBILITY_FALLBACK",code);
  const upstream=await fetch(PP_PLANNER_HTML_ORIGIN+"/",{
   method:"GET",
   headers:{"accept":"text/html"},
   redirect:"error",
   signal:AbortSignal.timeout(20000),
   cache:"no-store"
  });
  if(!upstream.ok)throw error;
  const type=(upstream.headers.get("content-type")||"").toLowerCase();
  if(!type.includes("text/html"))throw error;
  const raw=await upstream.text();
  if(!/<!doctype html|<html[\\s>]/i.test(raw)||!/<\\/body>/i.test(raw))throw error;
  // Legacy native UI starts GA with GET /api/plan?generations=...
  // This request was previously delegated to the global planner gateway, but
  // the tenant-isolated OVH auth gateway correctly rejects it (404).
  // Convert that one native button call to a same-origin authenticated POST;
  // never make GET an optimizer-mutating endpoint or expose a global plan.
  const legacyStart="const url='/api/plan?generations=120&population=80&continue='";
  const legacyFetch="fetch(url,{cache:'no-store'})";
  if(raw.split(legacyStart).length!==2||raw.split(legacyFetch).length!==2)throw error;
  const safePost="fetch('/api/plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify((()=>{const q=new URL(url,location.href).searchParams;const continuing=q.get('continue')==='1';return {generations:Math.min(60,Math.max(1,Number(q.get('generations'))||60)),population:Math.min(32,Math.max(2,Number(q.get('population'))||32)),continue:continuing,resume_plan:continuing&&window.__ppLegacyContinuationSeed?window.__ppLegacyContinuationSeed():null,__pp_fresh_recovery:!continuing,seed:Number(q.get('seed'))||1729,objective:q.get('objective')||'duration'};})()),cache:'no-store'})";
  const originalTransport=typeof PP_ASYNC_PLAN_INLINE==="string"?PP_ASYNC_PLAN_INLINE:"";
  // A transient empty/non-JSON proxy response must not finish the running GA.
  // Retry the same authenticated route; do not mutate or replace the plan.
  const gaProgressRecovery=JSON.parse(decodeURIComponent("%5B%5B%22const%20deadline%3DDate.now()%2B15*60*1000%3Blet%20transient%3D0%3B%22%2C%22const%20deadline%3DDate.now()%2B15*60*1000%3Blet%20transient%3D0%2CbadProgressAt%3D0%3B%22%5D%2C%5B%22if(signal%3F.aborted)throw%20err%3Bif(%2B%2Btransient%3C5)continue%3B%22%2C%22if(signal%3F.aborted)throw%20err%3Bif(!badProgressAt)badProgressAt%3DDate.now()%3Bif(Date.now()-badProgressAt%3C60000)continue%3B%22%5D%2C%5B%22if(!data)%7B%5Cn%20%20%20%20if(%2B%2Btransient%3C5)continue%3B%5Cn%20%20%20%20return%20%7Bstatus%3A502%2Cdata%3A%7Bok%3Afalse%2Cerror%3A%5C%22ga_progress_invalid_json%5C%22%7D%7D%3B%5Cn%20%20%20%7D%22%2C%22if(!data)%7B%5Cn%20%20%20%20if(%2B%2Btransient%3D%3D%3D3)console.warn(%5C%22PP_GA_PROGRESS_NON_JSON%5C%22%2Cr.status%2C(r.headers.get(%5C%22content-type%5C%22)%7C%7C%5C%22%5C%22).slice(0%2C48))%3B%5Cn%20%20%20%20if(!badProgressAt)badProgressAt%3DDate.now()%3B%5Cn%20%20%20%20if(Date.now()-badProgressAt%3C60000)continue%3B%5Cn%20%20%20%20return%20%7Bstatus%3A502%2Cdata%3A%7Bok%3Afalse%2Cerror%3A%5C%22ga_progress_response_unavailable%5C%22%7D%7D%3B%5Cn%20%20%20%7D%22%5D%2C%5B%22if(%2B%2Btransient%3C5%26%26r.status%3E%3D500)continue%3B%22%2C%22if(r.status%3E%3D500)%7Bif(!badProgressAt)badProgressAt%3DDate.now()%3Bif(Date.now()-badProgressAt%3C60000)continue%3B%7D%22%5D%2C%5B%22%20%20%20transient%3D0%3B%5Cn%20%20%20if(data.running)continue%3B%22%2C%22%20%20%20transient%3D0%3BbadProgressAt%3D0%3B%5Cn%20%20%20if(data.running%7C%7Cdata.phase%3D%3D%3D'fresh_ready'%7C%7Cdata.phase%3D%3D%3D'fresh_starting'%7C%7Cdata.phase%3D%3D%3D'queued')continue%3B%22%5D%5D"));
  if(!originalTransport||raw.split("</head>").length!==2)throw error;
  let gaTransport=originalTransport;
  for(const [before,after] of gaProgressRecovery){
   if(gaTransport.split(before).length!==2)throw new Error("PP_GA_PROGRESS_RECOVERY_ANCHOR_CHANGED");
   gaTransport=gaTransport.replace(before,after);
  }
  const legacyPoll="timer=setInterval(poll,220)";
  if(raw.split(legacyPoll).length!==2)throw error;
  const restoredNative=raw.replace(legacyFetch,safePost).replace(legacyPoll,"timer=setInterval(poll,2000)").replace("</head>",gaTransport+"</head>");
  // The verified upstream fallback was missing all etalon UI modules. Restore
  // *the same frozen module assets already built into the pinned app* without
  // changing models, saved plans, auth, database persistence or GA endpoints.
  const modules=[
    ["gantt",typeof PP_GANTT_INLINE==="string"?PP_GANTT_INLINE:""],
    ["secondary",typeof PP_SECONDARY_GANTTS_INLINE==="string"?PP_SECONDARY_GANTTS_INLINE:""],
    ["stop",typeof PP_STOP_INLINE==="string"?PP_STOP_INLINE:""],
    ["details",typeof PP_GANTT_DETAILS_INLINE==="string"?PP_GANTT_DETAILS_INLINE:""],
    ["orders",typeof PP_ORDER_STACKED_UI_INLINE==="string"?PP_ORDER_STACKED_UI_INLINE:""],
    ["restart",typeof PP_START_OVER_INLINE==="string"?PP_START_OVER_INLINE.replace("Сохранённая оптимизация|Saved optimization","Сохранённая оптимизация|Сохранённый расчёт|Saved optimization|Saved calculation"):""],
    ["documents",typeof PP_DOCUMENTS_INLINE==="string"?PP_DOCUMENTS_INLINE:""],
    ["language",typeof PP_LANGUAGE_INLINE==="string"?PP_LANGUAGE_INLINE:""]
  ];
  const required=["gantt","stop","restart","language"];
  if(required.some(name=>!modules.find(m=>m[0]===name)?.[1]))throw error;
  const restoreExistingPlan='<script id="pp-ovh-etalon-state-restore"> (function(){ "use strict"; let lastKey="",attempts=0; function restore(){ if(++attempts>20)return; if(window.__ppFreshRestartPending||(window.__ppFreshRestartMode&&!window.__ppFreshReferencePlan)||window.__ppOptimizationInFlight)return; try{ const key=localStorage.getItem("prodplan.project.active.v2"); const projects=JSON.parse(localStorage.getItem("prodplan.projects.v2")||"[]"); const project=Array.isArray(projects)?projects.find(p=>p&&p.id===key):null; const plan=window.__ppTabPlan||window.__ppOptimizerCommittedPlan||project?.lastPlan; const ops=plan&&(plan.operations||plan.generic_operations||[]); if(!key||!project||!plan||plan.valid===false||!Array.isArray(ops)||!ops.length)return; if(Number.isFinite(Number(plan._revision))&&Number(plan._revision)!==Number(project.revision))return; if(typeof renderPlan==="function"&&lastKey!==key){ renderPlan(plan);lastKey=key; window.__ppTabPlan=plan; window.__ppOptimizerCommittedPlan=plan; } const button=document.getElementById("opt"); const busyNow=window.__PP_STOP_DEBUG__?.().running===true; const ready=typeof model!=="undefined"&&!!model&&Array.isArray(model.orders)&&model.orders.length>0&& (Array.isArray(model.equipment)&&model.equipment.length>0|| Array.isArray(model.autoclaves)&&model.autoclaves.length>0); if(!button||busyNow||!ready)return; if(typeof modelReady!=="undefined")modelReady=true; if(typeof hasResult!=="undefined")hasResult=true; if(typeof busy!=="undefined")busy=false; button.disabled=false; button.textContent="Продолжить оптимизацию"; const badge=document.getElementById("valid"); if(badge&&/Нужны данные|Data required|Waiting for data/i.test(badge.textContent||"")) badge.textContent="Готово к расчёту"; }catch(e){console.warn("PP_ETALON_STATE_RESTORE_SKIPPED",String(e).slice(0,90))} } for(const delay of [0,200,800,1600,3000])setTimeout(restore,delay); })(); </script>';
  const enhanced=restoredNative.replace("</body>",${JSON.stringify(legacyResumeSeedScript)}+modules.map(m=>m[1]).join("")+${JSON.stringify(liveOptimizerPreviewInline)}+restoreExistingPlan+"</body>");
  return new Response(enhanced,{
   status:200,
   headers:{"content-type":"text/html; charset=utf-8",
            "cache-control":"no-store","x-liftorbit-ui":"etalon-modules-compat"}
  });
 }
}
`;
once("async function ppAuthenticatedHandler(req){",fallback+"\nasync function ppAuthenticatedHandler(req){","safe_wrapper_inject");
once(' if(req.method==="GET"&&path==="/"){\n  const res=await handler(req);',
     ' if(req.method==="GET"&&path==="/"){\n  const res=await ppSafePlannerUiForAuthenticatedUser(req);',
     "protected_root_only");
if(!source.includes("ppSafePlannerUiForAuthenticatedUser(req)")||!source.includes('if(code!=="PP_OPT_ETALON_DECISION_ANCHOR_MISSING")'))
 throw Error("REPAIR_GUARD_MISSING");
writeFileSync(file,source);
console.log("OVH_AUTHENTICATED_HTML_COMPATIBILITY_GUARD_APPLIED");
