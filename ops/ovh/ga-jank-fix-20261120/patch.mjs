import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
const target=process.argv[2];
if(!target)throw Error("GA_JANK_PATCH_ROOT_REQUIRED");
const dir="ops/ovh/ga-jank-fix-20261120/";
const sha=s=>createHash("sha256").update(s).digest("hex");
const replaceOne=(s,a,b,label)=>{
 if(s.split(a).length!==2)throw Error("GA_JANK_SOURCE_ANCHOR_DRIFT_"+label);
 return s.replace(a,b);
};
const authPath=resolve(target,"auth-runtime.js");
let auth=readFileSync(authPath,"utf8");
if(!auth.includes("ppFogHandleAuthenticated")||auth.includes("ppAsyncPreviewDeliveryV2"))
 throw Error("GA_JANK_AUTH_PREREQUISITE_NOT_MET");
auth=replaceOne(auth,"async function ppAuthenticatedHandler(req){",
 readFileSync(dir+"async-delivery.js.txt","utf8")+"\nasync function ppAuthenticatedHandler(req){",
 "auth_extension");
writeFileSync(authPath,auth);
console.log("GA_JANK_AUTH_NONBLOCKING",sha(auth),auth.length);
const uiPath=resolve(target,"restart-optimizer-ui.js");
let ui=readFileSync(uiPath,"utf8");
const oldMarker=";(function ppFourSecondFogPreviewV1(){";
const pos=ui.indexOf(oldMarker);
if(pos<0||ui.indexOf(oldMarker,pos+1)!==-1||
 !ui.slice(pos).includes("ppLeanPlanProgress")||
 !ui.slice(pos).trim().endsWith("})();"))
 throw Error("GA_JANK_FRONTEND_V1_SOURCE_DRIFT");
ui=ui.slice(0,pos)+readFileSync(dir+"live-ui-v2.js.txt","utf8")+"\n";
ui=replaceOne(ui,
 "stepMs=Math.min(250,Math.max(50,Math.round(Math.min(3700,elapsed)/gap)));",
 "stepMs=160;",
 "native_steady_rate");
ui=replaceOne(ui,
 "stepMs=Math.min(250,Math.max(50,Math.round(3000/gap)));",
 "stepMs=160;",
 "light_steady_rate");
if(!ui.includes("ppLightweightLiveGanttV2")||ui.includes("ppFourSecondFogPreviewV1")||
 !ui.includes("ppNativeOneOwnerProgressV4"))throw Error("GA_JANK_PROGRESS_GUARD");
writeFileSync(uiPath,ui);
console.log("GA_JANK_CLIENT_NO_BLUR_FIXED_RATE",sha(ui),ui.length);
