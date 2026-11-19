import {readFileSync,writeFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=process.argv[2];if(!root)throw Error("GA_TERMINAL_100_ROOT_REQUIRED");
const file=resolve(root,"restart-optimizer-ui.js");
const src=readFileSync(file,"utf8");
for(const required of ["ppSmoothVerifiedProgressV1","ppTruthfulSmoothGaPercentV1",
 "__PP_STOP_DEBUG__","ppUnifiedGanttV2","ppAutomaticIntermediatePreviewV1"])
 if(!src.includes(required))throw Error("GA_TERMINAL_100_BASELINE_MISSING_"+required);
if(src.includes("ppGaTerminalHundredV1"))throw Error("GA_TERMINAL_100_ALREADY_INSTALLED");
const addon=readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),"runtime.js"),"utf8");
if(!addon.includes('data?.phase==="completed"')||!addon.includes('Number(data.percent)===100')||
   !addon.includes('data.result.operations.length>0'))
 throw Error("GA_TERMINAL_MUST_CONFIRM_REAL_RESULT");
writeFileSync(file,src+"\n;"+addon+"\n");
console.log("GA_TERMINAL_100_COMPLETION_CONFIRMATION_READY",src.length,addon.length);
