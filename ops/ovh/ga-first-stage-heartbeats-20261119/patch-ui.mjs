import {readFileSync,writeFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {patchTransitionV5} from "../ga-native-transition-v5-20261119/transform.mjs";
import {patchInitialStageUiV6} from "./ui-transform.mjs";
const root=process.argv[2];if(!root)throw Error("GA_INITIAL_STAGE_UI_ROOT_REQUIRED");
const file=resolve(root,"restart-optimizer-ui.js");
const source=readFileSync(file,"utf8");
const dir=dirname(fileURLToPath(import.meta.url));
const v4=readFileSync(resolve(dir,"../ga-progress-v4-20261119/runtime.js"),"utf8");
const previous=patchTransitionV5(v4);
const shed=readFileSync(resolve(dir,"../ga-progress-load-shed-20261119/runtime.js"),"utf8");
const suffix="\n;"+previous+"\n\n;"+shed+"\n";
if(!source.endsWith(suffix))throw Error("GA_INITIAL_STAGE_EXPECTED_V5_AND_SHED_BASELINE");
if(source.includes("ppFirstStageFetchV6"))throw Error("GA_INITIAL_STAGE_ALREADY_APPLIED");
const nextRuntime=patchInitialStageUiV6(previous);
const payloadSite="    const payload=await response.clone().json();";
if(shed.split(payloadSite).length!==2)throw Error("GA_STAGE_PAYLOAD_EVENT_SOURCE_DRIFT");
const bridge="\n    // Forward a tiny, worker-generated stage event. No extra HTTP requests,\n"+
 "    // no second JSON parsing, and no synthetic percentage updates.\n"+
 "    if(typeof payload?.stage==='string'){\n"+
 "      window.dispatchEvent(new CustomEvent('pp:ga-server-stage',{detail:payload.stage}));\n"+
 "    }";
const nextShed=shed.replace(payloadSite,payloadSite+bridge);
const result=source.slice(0,-suffix.length)+"\n;"+nextRuntime+"\n\n;"+nextShed+"\n";
for(const feature of ["ppUnifiedGanttV2","ppAutomaticIntermediatePreviewV1",
 "ppStopRestorePreviousPlanV1","ppNativeOneOwnerProgressV4","ppLargeGaProgressLoadShedV1",
 "ppFirstStageFetchV6","pp:ga-server-stage"]){
 if(!result.includes(feature))throw Error("GA_INITIAL_STAGE_FEATURE_LOST_"+feature);
}
if(result.split("ppNativeOneOwnerProgressV4(){").length!==2)throw Error("GA_INITIAL_STAGE_MULTIPLE_PROGRESS_OWNERS");
writeFileSync(file,result);
console.log("GA_INITIAL_STAGE_SINGLE_OWNER_PATCH_READY",JSON.stringify({before:source.length,after:result.length,changed:result.length-source.length}));
