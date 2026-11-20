import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
const sourcePath=process.argv[2],targetPath=process.argv[3];
if(!sourcePath||!targetPath)throw Error("CLEANUP_SOURCE_TARGET_REQUIRED");
const src=readFileSync(sourcePath,"utf8");
if(!src.includes("function ppOneSseProgressAndGantt()") ||
   !src.includes("__PP_HIDE_GA_TECHNICAL_LABELS_V1__") ||
   !src.includes("const STEP_MS=250;"))
  throw Error("CLEANUP_NOT_ON_VERIFIED_PRODUCTION_SSE_SOURCE");
if(src.includes("__PP_HIDE_OBSOLETE_GA_WIDGETS_V1__"))
  throw Error("CLEANUP_ALREADY_INSTALLED");
const addon=readFileSync("ops/ovh/clean-obsolete-ga-controls-20261120/addon.js.txt","utf8");
if(!addon.includes("#ppLivePreview{display:none!important}") ||
   !addon.includes("#ppOptimizerCandidateStatus{display:none!important}") ||
   !addon.includes("ppHideObsoleteGanttOptimizationWidgetsV1"))
  throw Error("CLEANUP_ADDON_SOURCE_DRIFT");
const output=src.trimEnd()+"\n\n"+addon.trimEnd()+"\n";
writeFileSync(targetPath,output);
console.log("GA_OBSOLETE_SWITCH_AND_TIME_LIMIT_NOTICE_SOURCE_READY",
  createHash("sha256").update(output).digest("hex"));
