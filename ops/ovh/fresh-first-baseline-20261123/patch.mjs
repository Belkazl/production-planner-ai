import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
const oldPath=process.argv[2],newPath=process.argv[3];
if(!oldPath||!newPath)throw Error("FRESH_BASELINE_SOURCE_TARGET_REQUIRED");
let source=readFileSync(oldPath,"utf8");
const currentSha=createHash("sha256").update(source).digest("hex");
for(const required of [
 "if(window.__ppFreshOptimizerUiInstalled)return;",
 'fresh.id="ppOptimizerStartOver";',
 'method:"POST",cache:"no-store",credentials:"same-origin",',
 'window.__ppFreshRestartPending=true;',
 'window.__ppFreshReferencePlan=null;',
 'function ppUnifiedGanttV2(){',
 'window.__PP_KPI_FIRST_BEST_V1__=',
 'function ppOneSseProgressAndGantt(){'
]){
 if(!source.includes(required))throw Error("FRESH_BASELINE_EXPECTED_LIVE_MODULE_MISSING_"+required);
}
const change=(from,to,count=1)=>{
 const got=source.split(from).length-1;
 if(got!==count)throw Error("FRESH_BASELINE_SOURCE_DRIFT_"+got+"_EXPECTED_"+count+"_"+from.slice(0,80));
 source=source.replace(from,to);
};
// Remove the old plan from the fresh-run path entirely. Saved plans remain
// untouched, and the first new plan is the only reference for later runs.
change(
 [
  '  const previous=window.__ppOptimizerCommittedPlan||window.__ppTabPlan||window.__ppManualPlan||storedLastPlan();',
  '  try{window.__ppFreshDisplayBaseline=previous?JSON.parse(JSON.stringify(previous)):null}catch(_){window.__ppFreshDisplayBaseline=previous||null}'
 ].join("\n"),
 [
  '  // There is no prior incumbent or comparison for the first iteration.',
  '  window.__ppFreshDisplayBaseline=null;'
 ].join("\n")
);
// Remove obsolete display-only baseline helpers that repainted the old Gantt.
const obsoleteStart="function storedLastPlan(){";
const obsoleteEnd="function resetVisiblePlan(){";
const begin=source.indexOf(obsoleteStart),end=source.indexOf(obsoleteEnd,begin);
if(begin<0||end<=begin||source.indexOf(obsoleteStart,begin+1)!==-1)
 throw Error("FRESH_BASELINE_LEGACY_DISPLAY_BLOCK_DRIFT");
const old=source.slice(begin,end);
for(const needle of ["function storedLastPlan(){","function showFreshDisplayBaseline(){",
 "renderPlan(p);","__ppFreshDisplayBaseline;"]){
 if(!old.includes(needle))throw Error("FRESH_BASELINE_OBSOLETE_GUARD_"+needle);
}
source=source.slice(0,begin)+source.slice(end);
change(
 ['  resetVisiblePlan();','  showFreshDisplayBaseline();'].join("\n"),
 [
  '  resetVisiblePlan();',
  '  // New search starts from EMPTY Gantt; old work must not be repainted.',
  '  window.dispatchEvent(new CustomEvent("pp:fresh-gantt-cleared",{',
  '   detail:{project_id:currentProject()}',
  '  }));'
 ].join("\n")
);
// The unified Gantt also falls back to project.lastPlan on tab switches.
// Scope the suppression to the current fresh project only.
change(
 ['function getPlan(){',
  ' if(window.__ppOptimizationInFlight===true&&lastReal)return lastReal;'].join("\n"),
 [
  'function getPlan(){',
  ' let freshScope=false;',
  ' try{freshScope=window.__ppFreshRestartMode===true&&',
  '   window.__ppFreshRestartProject===localStorage.getItem("prodplan.project.active.v2")}',
  ' catch(_){}',
  ' if(freshScope){',
  '  // Show only a fresh GA preview or a newly accepted full result.',
  '  // Ignore project.lastPlan from BEFORE Start optimization again.',
  '  const accepted=window.__ppFreshReferencePlan||window.__ppOptimizerCommittedPlan;',
  '  return accepted||(lastReal?.partial===true?lastReal:null);',
  ' }',
  ' if(window.__ppOptimizationInFlight===true&&lastReal)return lastReal;'
 ].join("\n")
);
if(source.includes("showFreshDisplayBaseline")||
 source.includes("function storedLastPlan()")||
 !source.includes("pp:fresh-gantt-cleared")||
 !source.includes("return accepted||(lastReal?.partial===true?lastReal:null);"))
 throw Error("FRESH_BASELINE_PATCH_VALIDATION_FAILED");
writeFileSync(newPath,source);
console.log("FRESH_FIRST_OPTIMIZATION_NO_PRIOR_PLAN_GUARDED_PATCH",
 JSON.stringify({old:currentSha,new:createHash("sha256").update(source).digest("hex"),
 oldBytes:readFileSync(oldPath,"utf8").length,newBytes:source.length}));
