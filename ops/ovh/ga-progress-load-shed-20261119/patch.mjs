import {readFileSync,writeFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=process.argv[2];if(!root)throw Error("GA_LARGE_POLL_SHED_ROOT_REQUIRED");
const folder=dirname(fileURLToPath(import.meta.url));
const path=resolve(root,"restart-optimizer-ui.js");
const source=readFileSync(path,"utf8");
const previous=readFileSync(resolve(folder,"../ga-progress-v4-20261119/runtime.js"),"utf8");
if(!source.endsWith("\n;"+previous+"\n"))throw Error("GA_SHED_EXPECTED_V4_ONLY_BASELINE");
if(source.includes("ppLargeGaProgressLoadShedV1"))throw Error("GA_SHED_ALREADY_INSTALLED");
for(const marker of ["ppNativeOneOwnerProgressV4","ppUnifiedGanttV2","ppAutomaticIntermediatePreviewV1","ppStopRestorePreviousPlanV1"])
 if(!source.includes(marker))throw Error("GA_SHED_MISSING_REQUIRED_FEATURE_"+marker);
const addon=readFileSync(resolve(folder,"runtime.js"),"utf8");
for(const marker of ["ppLargeGaProgressLoadShedV1","minOps=350,intervalMs=7000",
  "return nativeFetch(input,init);","if(!running()){",
  "phase:\"running\",percent:Number(payload.percent)||0","result:null"])
 if(!addon.includes(marker))throw Error("GA_SHED_UNSAFE_ADDON_"+marker);
writeFileSync(path,source+"\n;"+addon+"\n");
console.log("GA_LARGE_POLL_SHED_GUARDED_APPEND_READY",JSON.stringify({from:source.length,added:addon.length}));
