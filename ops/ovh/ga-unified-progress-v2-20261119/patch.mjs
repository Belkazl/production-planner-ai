import {readFileSync,writeFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=process.argv[2];
if(!root)throw Error("UNIFIED_GA_PROGRESS_ROOT_REQUIRED");
const file=resolve(root,"restart-optimizer-ui.js");
const original=readFileSync(file,"utf8");
for(const marker of ["ppSmoothVerifiedProgressV1","ppTruthfulSmoothGaPercentV1",
 "ppGaTerminalHundredV1","__PP_STOP_DEBUG__","ppUnifiedGanttV2",
 "ppAutomaticIntermediatePreviewV1"])
 if(!original.includes(marker))throw Error("UNIFIED_GA_PROGRESS_BASELINE_MISSING_"+marker);
if(original.includes("ppUnifiedOptimizerProgressV2"))
 throw Error("UNIFIED_GA_PROGRESS_ALREADY_INSTALLED");
const addon=readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),"runtime.js"),"utf8");
for(const marker of ["ppUnifiedOptimizerProgressV2","verified-progress-with-activity",
 "data?.phase!==\"completed\"","data.result.operations.length===0",
 "window.__PP_TRUTHFUL_SMOOTH_GA_PERCENT_V1__?.stop","window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__?.dispose",
 "window.__PP_GA_TERMINAL_100_V1__?.dispose",
 "lastIncrease>=5200","finishAnimated"])
 if(!addon.includes(marker))throw Error("UNIFIED_GA_PROGRESS_BAD_ADDON_"+marker);
writeFileSync(file,original+"\n;"+addon+"\n");
console.log("UNIFIED_GA_PROGRESS_V2_PATCHED",JSON.stringify({sourceBytes:original.length,addonBytes:addon.length,fullBytes:original.length+addon.length+3}));
