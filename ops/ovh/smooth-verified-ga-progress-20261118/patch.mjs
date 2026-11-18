import {readFileSync,writeFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=process.argv[2];
if(!root)throw Error("SMOOTH_GA_UI_ROOT_REQUIRED");
const file=resolve(root,"restart-optimizer-ui.js");
const source=readFileSync(file,"utf8");
for(const guard of ["ppUnifiedGanttV2","ppStopRestorePreviousPlanV1","ppHideGaTechnicalLabelsV1","ppAutomaticIntermediatePreviewV1","__PP_KPI_FIRST_BEST_V1__","__PP_CONTINUATION_SEED_V2__","quick:Object.freeze({generations:10,population:12})"])
 if(!source.includes(guard))throw Error("SMOOTH_GA_UI_GUARD_MISSING_"+guard);
if(source.includes("ppSmoothVerifiedProgressV1"))throw Error("SMOOTH_GA_UI_ALREADY_INSTALLED");
const addon=readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),"runtime.js"),"utf8");
if(!addon.includes("confirmed-only")||!addon.includes("pp-opt-running")||!addon.includes("never run ahead"))throw Error("SMOOTH_GA_UI_MUST_USE_VERIFIED_SERVER_PROGRESS");
writeFileSync(file,source+"\n;"+addon+"\n");
console.log("SMOOTH_GA_VERIFIED_PROGRESS_UI_PATCHED",source.length,addon.length);
