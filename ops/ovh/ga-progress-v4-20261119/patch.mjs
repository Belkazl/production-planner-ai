import {readFileSync,writeFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=process.argv[2];if(!root)throw Error("GA_PROGRESS_V4_ROOT_REQUIRED");
const folder=dirname(fileURLToPath(import.meta.url));
const file=resolve(root,"restart-optimizer-ui.js");
const original=readFileSync(file,"utf8");
const prior=readFileSync(resolve(folder,"../ga-inline-progress-v3-20261119/runtime.js"),"utf8");
const suffix="\n;"+prior+"\n";
if(!original.endsWith(suffix))throw Error("GA_PROGRESS_V4_SOURCE_DRIFT_OR_OLD_OWNER_MISSING");
for(const feature of ["ppUnifiedGanttV2","ppAutomaticIntermediatePreviewV1",
 "ppStopRestorePreviousPlanV1","ppTruthfulSmoothGaPercentV1",
 "ppSmoothVerifiedProgressV1","ppGaTerminalHundredV1"])
 if(!original.includes(feature))throw Error("GA_PROGRESS_V4_REQUIRED_FEATURE_MISSING_"+feature);
const next=readFileSync(resolve(folder,"runtime.js"),"utf8");
if(!next.includes("ppNativeOneOwnerProgressV4")||!next.includes("mode:\"one-button-real-terminal-persistent\"")||
 !next.includes("if(!r.ok)throw Error(\"GA_HTTP_\"+r.status)")||
 !next.includes("if(p.phase===\"completed\"")||
 !next.includes("if(finalDone){reset();}"))
 throw Error("GA_PROGRESS_V4_GUARDS_MISSING");
const updated=original.slice(0,-suffix.length)+"\n;"+next+"\n";
if(updated.includes("ppInlineOptimizerProgressV3"))throw Error("GA_PROGRESS_V4_OLD_OWNER_STILL_INCLUDED");
writeFileSync(file,updated);
console.log("GA_PROGRESS_V4_REPLACED_OLD_ADDON_NOT_STACKED",JSON.stringify({
 bytesBefore:original.length,bytesAfter:updated.length,removedOld:prior.length}));
