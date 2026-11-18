import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
const root=process.argv[2];
if(!root)throw Error("KPI_SELECTED_TIMING_ROOT_REQUIRED");
const path=resolve(root,"restart-optimizer-ui.js");
let source=readFileSync(path,"utf8");
const oldStart=" queueMicrotask(()=>{\n  if(modal.classList.contains(\"pp-open\"))return;";
const newStart=" setTimeout(()=>{\n  if(modal.classList.contains(\"pp-open\"))return;";
const oldFinish="  recordSelection(chosen,reason);\n });";
const newFinish="  recordSelection(chosen,reason);\n },0);";
for(const needle of [oldStart,oldFinish])if(source.split(needle).length!==2)throw Error("KPI_SELECTED_TIMING_SOURCE_DRIFT");
for(const marker of ["ppSelectedPlanKpiReferenceV2","__PP_KPI_FIRST_BEST_V1__","ppAutomaticIntermediatePreviewV1","__PP_CONTINUATION_SEED_V2__","__PP_GA_OBJECTIVE_FLOOR_V1__"]){
 if(!source.includes(marker))throw Error("KPI_SELECTED_TIMING_GUARD_MISSING_"+marker);
}
source=source.replace(oldStart,newStart).replace(oldFinish,newFinish);
if(source.split(newStart).length!==2||source.split(newFinish).length!==2)throw Error("KPI_SELECTED_TIMING_POSTCONDITION");
writeFileSync(path,source);
console.log("KPI_SELECTED_STOP_MODAL_AFTER_CLICK_COMMIT_PATCHED");
