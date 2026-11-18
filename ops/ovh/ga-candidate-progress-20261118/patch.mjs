import {readFileSync,writeFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=process.argv[2]; if(!root)throw Error("GA_SMOOTH_PROGRESS_APP_ROOT_REQUIRED");
const path=resolve(root,"restart-optimizer-ui.js");
const old=readFileSync(path,"utf8");
for(const marker of ["ppUnifiedGanttV2","ppStopRestorePreviousPlanV1","ppHideGaTechnicalLabelsV1","ppAutomaticIntermediatePreviewV1","quick:Object.freeze({generations:10,population:12})"])
 if(!old.includes(marker))throw Error("GA_SMOOTH_PROGRESS_EXPECTED_LIVE_FEATURE_MISSING_"+marker);
if(old.includes("ppTruthfulSmoothGaPercentV1"))throw Error("GA_SMOOTH_PROGRESS_ALREADY_INSTALLED");
const addon=readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),"smooth-progress.js"),"utf8");
for(const marker of ["const intervalMs=85","shown+=1","serverUpdates","pp-opt-progress-line","function readNative()"])
 if(!addon.includes(marker))throw Error("GA_SMOOTH_PROGRESS_BAD_ADDON_"+marker);
writeFileSync(path,old+"\n;"+addon+"\n");
console.log("GA_SMOOTH_CONFIRMED_PERCENT_ONE_BY_ONE_PATCHED",addon.length);
