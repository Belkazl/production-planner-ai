import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
const root=process.argv[2];
if(!root)throw Error("PP_SINGLE_PROGRESS_V5_ROOT_REQUIRED");
const path=resolve(root,"restart-optimizer-ui.js");
let source=readFileSync(path,"utf8");
if(!source.includes("ppLightweightLiveGanttV2")||!source.includes("ppNativeOneOwnerProgressV4")||
 !source.includes("ppLargeGaProgressLoadShedV1"))
 throw Error("PP_PROGRESS_V5_SOURCE_BASELINE_DRIFT");
const modules=[
 ["ppAutomaticIntermediatePreviewV1","__PP_AUTO_INTERMEDIATE_PREVIEW_V1__"],
 ["ppTruthfulSmoothGaPercentV1","__PP_TRUTHFUL_SMOOTH_GA_PERCENT_V1__"],
 ["ppSmoothVerifiedProgressV1","__PP_SMOOTH_VERIFIED_PROGRESS_V1__"],
 ["ppResolveDuplicateGaProgress20261118","__PP_SINGLE_GA_PROGRESS_RENDERER_V1__"],
 ["ppGaTerminalHundredV1","__PP_GA_TERMINAL_100_V1__"],
 ["ppUnifiedOptimizerProgressV2","__PP_UNIFIED_OPTIMIZER_PROGRESS_V2__"],
 ["ppNativeOneOwnerProgressV4","__PP_GA_PROGRESS_V4__"],
 ["ppLargeGaProgressLoadShedV1","__PP_GA_PROGRESS_LOAD_SHED_V1__"]
];
for(const [module,marker] of modules){
 const startMarker=";(function "+module+"(){";
 const at=source.indexOf(startMarker);
 if(at<0||source.indexOf(startMarker,at+1)>=0)throw Error("PP_V5_MODULE_NOT_UNIQUE_"+module);
 let next=source.indexOf("\n;(function ",at+startMarker.length);
 if(next<0)next=source.length;
 const close=module==="ppLargeGaProgressLoadShedV1"?
  source.indexOf("\n})();",at):source.lastIndexOf("\n})();",next);
 if(close<=at||close-at>35000)throw Error("PP_V5_MODULE_CLOSING_DRIFT_"+module);
 const removed=source.slice(at,close+6);
 if(!removed.includes(marker))throw Error("PP_V5_MODULE_ID_MISMATCH_"+module);
 if(module==="ppLargeGaProgressLoadShedV1"&&removed.length>4500)
  throw Error("PP_V5_STATUS_SHED_CLOSURE_TOO_LONG");
 source=source.slice(0,at)+source.slice(close+6);
 console.log("RETIRED_PROGRESS_OR_PREVIEW_OWNER",module,removed.length);
}
if(source.includes("ppNativeOneOwnerProgressV4")||source.includes("ppLargeGaProgressLoadShedV1")||
 source.includes("ppAutomaticIntermediatePreviewV1"))throw Error("PP_V5_OLD_CONTROLLER_SURVIVED");
const oldEmit='const emit=p=>{\n if(p?.running!==true)return;';
const newEmit=[
 'const emit=p=>{',
 ' window.dispatchEvent(new CustomEvent("pp:ga-light-status",{detail:{',
 '  ok:p?.ok,phase:p?.phase,running:p?.running,success:p?.success,',
 '  percent:p?.percent,done:p?.done,total:p?.total,stage:p?.stage,',
 '  job_id:p?.job_id,snapshot_age_ms:p?.snapshot_age_ms,',
 '  candidate_serial:p?.candidate_serial',
 ' }}));',
 ' if(p?.running!==true)return;'
].join("\n");
if(source.split(oldEmit).length!==2)throw Error("PP_V5_LIVE_PROGRESS_EVENT_DRIFT");
source=source.replace(oldEmit,newEmit);
const oldEvent='  percent:latestPercent,stage:p.stage||null,job_id:p.job_id||null';
const newEvent='  percent:latestPercent,stage:p.stage||null,job_id:p.job_id||null,\n  snapshot_age_ms:p.snapshot_age_ms??null,phase:p.phase||null,running:true';
if(source.split(oldEvent).length!==2)throw Error("PP_V5_META_EVENT_DRIFT");
source=source.replace(oldEvent,newEvent);
// Only two owners now exist: lightweight read-only status/preview and a
// single, separate visualization of the server-verified percentage.
source+="\n;"+readFileSync("ops/ovh/single-progress-v5-20261120/runtime.js","utf8")+"\n";
if(!source.includes("ppSingleServerProgressV5")||
 !source.includes("ppLightweightLiveGanttV2")||
 !source.includes("ppUnifiedGanttV2"))throw Error("PP_V5_REQUIRED_ENGINE_MISSING");
writeFileSync(path,source);
console.log("PP_PROGRESS_V5_EXCLUSIVE_OWNER_PATCHED",createHash("sha256").update(source).digest("hex"),source.length);
