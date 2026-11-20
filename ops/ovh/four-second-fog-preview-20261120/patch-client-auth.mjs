import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
const root=process.argv[2];if(!root)throw Error("FOG_UI_PATCH_ROOT_REQUIRED");
const here="ops/ovh/four-second-fog-preview-20261120/";
const hash=s=>createHash("sha256").update(s).digest("hex");
const replace=(s,a,b,label)=>{
 if(s.split(a).length!==2)throw Error("FOG_UI_SOURCE_DRIFT_"+label);
 return s.replace(a,b);
};
const authFile=resolve(root,"auth-runtime.js");
let auth=readFileSync(authFile,"utf8");
if(auth.includes("ppFogHandleAuthenticated"))throw Error("FOG_AUTH_ALREADY_INSTALLED");
for(const marker of ["async function ppAuthenticatedHandler(req){","ppVerifyLogin(req)","const ppSecureSessionKey="])
 if(!auth.includes(marker))throw Error("FOG_AUTH_REQUIRED_"+marker);
const worker=readFileSync(here+"auth-snapshot-handler.js.txt","utf8");
auth=replace(auth,"async function ppAuthenticatedHandler(req){",
 worker+"\nasync function ppAuthenticatedHandler(req){","auth_handler");
auth=replace(auth,'if(req.method==="GET"&&path==="/"){',
 'if(req.method==="GET"&&path==="/api/ga-candidate-snapshot")\n' +
 '  return ppFogHandleAuthenticated(req);\n' +
 ' if(req.method==="GET"&&path==="/"){',"auth_dispatch");
if(auth.indexOf("if(!authenticated){")>auth.indexOf('path==="/api/ga-candidate-snapshot"'))
 throw Error("FOG_AUTH_AUTHENTICATION_ORDER_INVALID");
writeFileSync(authFile,auth);
console.log("FOG_AUTH_14X10_SERVER_SNAPSHOT_READY",hash(auth),auth.length);
const uiFile=resolve(root,"restart-optimizer-ui.js");
let ui=readFileSync(uiFile,"utf8");
if(ui.includes("ppFourSecondFogPreviewV1"))throw Error("FOG_UI_ALREADY_INSTALLED");
for(const marker of ["ppNativeOneOwnerProgressV4","ppUnifiedGanttV2",
 "ppLargeGaProgressLoadShedV1","ppAutomaticIntermediatePreviewV1"])
 if(!ui.includes(marker))throw Error("FOG_UI_REQUIRED_"+marker);
ui=replace(ui,
 "stepMs=Math.min(700,Math.max(110,Math.round(Math.min(11500,elapsed*1.3)/gap)));",
 "stepMs=Math.min(250,Math.max(50,Math.round(Math.min(3700,elapsed)/gap)));","smoothing");
ui=replace(ui,
 "const ms=Math.min(145,Math.max(60,Math.round(6500/Math.max(1,100-n))));",
 "const ms=Math.min(65,Math.max(35,Math.round(1800/Math.max(1,100-n))));",
 "full_100");
ui=replace(ui,
 'window.addEventListener("pp:optimizer-started",()=>{if(disposed)return;reset();queueMicrotask(()=>{attach();capture()})});',
 'window.addEventListener("pp:ga-light-progress",event=>{\n' +
 ' if(disposed||!wasRunning||!active())return;\n' +
 ' const number=clamp(event.detail?.percent);\n' +
 ' if(confirmed===null||number<=confirmed)return;\n' +
 ' const gap=Math.max(1,number-(shown||0));\n' +
 ' confirmed=number;lastNativeAt=Date.now();updates++;\n' +
 ' stepMs=Math.min(250,Math.max(50,Math.round(3000/gap)));\n' +
 ' button?.classList.remove("pp-ga-v4-busy");\n' +
 ' button?.removeAttribute("data-pp-ga-v4-label");\n' +
 '});\n' +
 'window.addEventListener("pp:optimizer-started",()=>{if(disposed)return;reset();queueMicrotask(()=>{attach();capture()})});',
 "light_progress_display");
ui+="\n;"+readFileSync(here+"runtime.js","utf8")+"\n";
writeFileSync(uiFile,ui);
console.log("FOG_UI_4SEC_140_AND_VERIFIED_100_READY",hash(ui),ui.length);
