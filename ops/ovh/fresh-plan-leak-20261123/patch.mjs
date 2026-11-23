// Patch two production client files only; do not alter saved projects or GA worker.
import {readFileSync,writeFileSync} from "node:fs";
const [oldUi,oldHtml,newUi,newHtml]=process.argv.slice(2);
if(!oldUi||!oldHtml||!newUi||!newHtml)throw Error("FRESH_LEAK_PATHS_REQUIRED");
const one=(s,old,next,label)=>{
 const count=s.split(old).length-1;
 if(count!==1)throw Error("FRESH_LEAK_"+label+"_DRIFT_"+count);
 return s.replace(old,next);
};
let ui=readFileSync(oldUi,"utf8");
let html=readFileSync(oldHtml,"utf8");
const origUi=ui,origHtml=html;
const originalBlock=[
 "const floor=()=>{",
 " const project=current();",
 " if(!project)return null;",
 " const options=[project.lastPlan];"
].join("\n");
const correctedBlock=[
 "const floor=()=>{",
 " const project=current();",
 " if(!project)return null;",
 " // Start optimization again keeps stored projects and saved plans untouched,",
 " // but no PRE-RESET plan can be used as the best result of this fresh run.",
 " // Only an already accepted plan from the new search may be a comparator.",
 " if(window.__ppFreshRestartMode===true&&",
 "    String(window.__ppFreshRestartProject)===String(project.id)){",
 "   const currentFreshPlan=window.__ppFreshReferencePlan;",
 "   return belong(currentFreshPlan,project)?currentFreshPlan:null;",
 " }",
 " const options=[project.lastPlan];"
].join("\n");
ui=one(ui,originalBlock,correctedBlock,"CLIENT_FLOOR");
const oldPersist="if(window.__ppFreshRestartPending&&d&&d.valid!==false&&(d.operations||d.generic_operations||[]).length){window.__ppFreshReferencePlan=d;window.__ppFreshReferenceProject=id}";
const newPersist="if(window.__ppFreshRestartMode===true&&window.__ppFreshRestartProject===id&&!window.__ppFreshReferencePlan&&d&&d.valid!==false&&(d.operations||d.generic_operations||[]).length){window.__ppFreshReferencePlan=d;window.__ppFreshReferenceProject=id}";
html=one(html,oldPersist,newPersist,"NATIVE_FIRST_RESULT_REFERENCE");
const oldCheck="if(!window.__ppFreshRestartPending&&prev&&prev.valid!==false&&Number(prev._revision??entry.revision)";
const newCheck="if(!(window.__ppFreshRestartMode===true&&window.__ppFreshRestartProject===id)&&prev&&prev.valid!==false&&Number(prev._revision??entry.revision)";
html=one(html,oldCheck,newCheck,"NATIVE_PERSISTED_LASTPLAN");
for(const [src,label] of [[ui,"UI"],[html,"HTML"]]){
 for(const mark of ["__ppFreshRestartMode","__ppFreshReferencePlan","__ppFreshRestartProject"]){
   if(!src.includes(mark))throw Error("FRESH_LEAK_"+label+"_MISSING_"+mark);
 }
}
for(const mark of ["function ppOneSseProgressAndGantt(){","window.__PP_CONTINUATION_SEED_V2__","window.__PP_GA_OBJECTIVE_FLOOR_V1__","quick:Object.freeze({generations:3,population:6})","ppOptimizerStartOver"]){
 if(!ui.includes(mark))throw Error("FRESH_LEAK_RUNTIME_GUARD_MISSING_"+mark);
}
if(html.includes(oldPersist)||html.includes(oldCheck))throw Error("FRESH_LEAK_OLD_NATIVE_GUARDS_REMAIN");
if(ui===origUi||html===origHtml)throw Error("FRESH_LEAK_NO_CHANGE");
writeFileSync(newUi,ui);writeFileSync(newHtml,html);
console.log("FRESH_LEAK_CLIENT_AND_NATIVE_TWO_PATH_PATCH_PASS",JSON.stringify({uiSize:ui.length,htmlSize:html.length,preservesQuick:true,retainsSavedPlans:true}));
