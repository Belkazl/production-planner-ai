import {readFileSync,writeFileSync} from "node:fs";
import assert from "node:assert/strict";
const [oldPath,newPath]=process.argv.slice(2);
if(!oldPath||!newPath)throw Error("KPI_LATEST_BASELINE_FILE_ARGS_REQUIRED");
const old=readFileSync(oldPath,"utf8");
const from=`function readyContinue(){
 const p=project();
 if(!p)return;
 try{
  const record=JSON.parse(localStorage.getItem(storeKey(p))||"null");
  if(!record||String(record.projectId)!==String(p.id)||
   Number(record.revision)!==Number(p.revision)||record.compare===true||
   !keys.every(k=>Number.isFinite(record.metrics?.[k])))return;
  save(p,record.metrics,true,record.selectedSource||"accepted");
  window.__PP_KPI_FIRST_BEST_V1__?.sync?.();
 }catch(_){}
}`;
const to=`function readyContinue(){
 const p=project();
 if(!p)return;
 try{
  const record=JSON.parse(localStorage.getItem(storeKey(p))||"null");
  const sameReference=record&&String(record.projectId)===String(p.id)&&
    Number(record.revision)===Number(p.revision)&&
    keys.every(k=>Number.isFinite(record.metrics?.[k])&&record.metrics[k]>=0);
  // An explicitly chosen Stop result is authoritative even if it was not
  // written to project.lastPlan. This is the very next Continue's baseline.
  const selectedByUser=sameReference&&record.compare===false&&
   ["explicit_selection","stop_selected","stop_previous"].includes(record.selectedSource);
  let base=selectedByUser?record.metrics:null;
  // Otherwise snapshot the latest accepted plan for EACH new continuation.
  // Do not reuse the first historical comparison record across multiple runs.
  if(!base){
   const lastAccepted=[p.lastPlan,window.__ppOptimizerCommittedPlan,
     window.__ppTabPlan,window.__ppManualPlan]
     .find(plan=>accepted(plan,p));
   if(lastAccepted)base=metrics(lastAccepted);
  }
  if(!base&&sameReference)base=record.metrics;
  if(!base)return;
  save(p,base,true,selectedByUser?record.selectedSource:"latest_accepted");
  window.__PP_KPI_FIRST_BEST_V1__?.sync?.();
 }catch(_){}
}`;
assert.equal(old.split(from).length,2,"KPI_READY_CONTINUE_SOURCE_CHANGED");
for(const marker of ["function ppFixedFirstBestKpiDelta(){","function ppSelectedPlanKpiReferenceV2(){","window.__PP_KPI_SELECTED_REFERENCE_V2__=","quick:Object.freeze({generations:3,population:6})"]){
 assert(old.includes(marker),"KPI_GUARD_MISSING_"+marker);
}
const updated=old.replace(from,to);
assert.equal(updated.replace(to,from),old,"KPI_PATCH_MUST_CHANGE_EXACTLY_ONE_FUNCTION");
writeFileSync(newPath,updated);
console.log("KPI_LATEST_BASELINE_ONE_FUNCTION_PATCH_PASS",JSON.stringify({oldChars:old.length,newChars:updated.length}));
