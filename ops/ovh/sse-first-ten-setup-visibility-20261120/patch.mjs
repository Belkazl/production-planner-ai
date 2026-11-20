import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
const original=process.argv[2],target=process.argv[3];
if(!original||!target)throw Error("SSE_FIRST10_ZOOM_FILES_REQUIRED");
let s=readFileSync(original,"utf8");
const old1=`    const productionCount=selected.filter(op=>!isSetup(op)).length;
    const setupCount=selected.length-productionCount;`;
const new1=`    const productionCount=selected.filter(op=>!isSetup(op)).length;
    const setupCount=selected.length-productionCount;
    // Use the VISIBLE first-ten-operation window for the interim time axis.
    // Keeping the complete optimization duration here compresses every real
    // changeover into a near-invisible sliver at the far left of the Gantt.
    // Full-candidate metrics still arrive separately in _pp_preview_kpis.
    const visibleEnd=Math.max(1,Math.ceil(Math.max(...selected.map(op=>Number(op.end_min)))));`;
const old2=`      start:plan.start||model.start||null,
      duration_minutes:plan.duration_minutes||null,
      _pp_preview_kpis:metrics`;
const new2=`      start:plan.start||model.start||null,
      duration_minutes:visibleEnd,
      _pp_preview_full_duration_minutes:plan.duration_minutes||null,
      _pp_preview_kpis:metrics`;
if(s.includes(new1)&&s.includes(new2))
 throw Error("SSE_FIRST10_ZOOM_ALREADY_DEPLOYED");
for(const [from,to] of [[old1,new1],[old2,new2]]){
 const n=s.split(from).length-1;
 if(n!==1)throw Error("SSE_FIRST10_ZOOM_SOURCE_DRIFT_"+n+"_"+from.slice(0,60));
 s=s.replace(from,to);
}
const guards={
 bounded:s.includes("const boundedPreview = (plan,model) =>"),
 chronological:s.includes("for(const entry of entries.slice(0,10))"),
 detached:s.includes("const detached=[];"),
 kpis:s.includes("_pp_preview_kpis:metrics"),
 oldTenJobs:s.includes("entries.slice(0,last+1)"),
 setupArray:s.includes("setup_operations"),
 totalOps:s.length
};
console.log("SSE_FIRST10_SOURCE_VERSION_GUARDS",JSON.stringify(guards));
if(!guards.bounded||!guards.chronological||!guards.detached||!guards.kpis)
 throw Error("SSE_FIRST10_ZOOM_SECURITY_OR_FIRST_TEN_GUARD_FAILED");
const canonical=readFileSync("ops/ovh/sse-stream-v1-20261120/backend-stream.js.txt","utf8");
if(!s.includes(canonical))throw Error("SSE_FIRST10_ZOOM_MUST_MATCH_TESTED_CANONICAL");
writeFileSync(target,s);
console.log("SSE_FIRST10_ZOOM_GUARDED_SOURCE_READY",createHash("sha256").update(s).digest("hex"));
