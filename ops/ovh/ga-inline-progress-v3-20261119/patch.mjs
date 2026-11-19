import {readFileSync,writeFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=process.argv[2];
if(!root)throw Error("GA_INLINE_V3_ROOT_REQUIRED");
const file=resolve(root,"restart-optimizer-ui.js");
const src=readFileSync(file,"utf8");
for(const marker of ["ppUnifiedOptimizerProgressV2","ppSmoothVerifiedProgressV1",
  "ppTruthfulSmoothGaPercentV1","ppGaTerminalHundredV1","__PP_STOP_DEBUG__",
  "ppUnifiedGanttV2","ppAutomaticIntermediatePreviewV1"])
 if(!src.includes(marker))throw Error("GA_INLINE_V3_BASELINE_MISSING_"+marker);
if(src.includes("ppInlineOptimizerProgressV3"))throw Error("GA_INLINE_V3_ALREADY_INSTALLED");
const v2=readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),"../ga-unified-progress-v2-20261119/runtime.js"),"utf8");
if(!src.endsWith("\n;"+v2+"\n"))
 throw Error("GA_INLINE_V3_EXPECTED_UNMODIFIED_PREVIOUS_ADDON");
const code=readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),"runtime.js"),"utf8");
for(const token of ["function paintFinish(","#opt.pp-ga-v3-final:after",
 "data-pp-ga-v3-text","info?.phase!==\"completed\"","Number(info.percent)!==100",
 "window.__PP_UNIFIED_OPTIMIZER_PROGRESS_V2__?.dispose?.()",
 "finishHold=setTimeout","last100Shown"])if(!code.includes(token))
 throw Error("GA_INLINE_V3_SAFETY_GUARD_"+token);
writeFileSync(file,src+"\n;"+code+"\n");
console.log("GA_INLINE_V3_SINGLE_BUTTON_PATCHED",JSON.stringify({old:src.length,new:src.length+code.length+3}));
