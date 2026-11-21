import {readFileSync,writeFileSync} from "node:fs";
let source=readFileSync("index.ts","utf8");
function once(from:string,to:string,label:string){
 const n=source.split(from).length-1;
 if(n!==1)throw Error("PP_AUTH_BRIDGE_"+label+"_ANCHOR_"+n);
 source=source.replace(from,to);
}
const runtime=readFileSync("tenant-execution-runtime.js","utf8")+"\n"+readFileSync("auth-runtime.js","utf8");
if(!runtime.includes("ppTenantDispatch")||!runtime.includes("ppAuthenticatedHandler")||!runtime.includes("ppVerifyLogin")||!runtime.includes("PP_AUTH_GATEWAY_ORIGIN"))
 throw Error("AUTH_RUNTIME_MISSING");
once(
 'const UPSTREAM=(typeof Bun!=="undefined"&&Bun.env?.APS_UPSTREAM)||"https://production-planner-gateway-production.up.railway.app";',
 runtime+'\nconst UPSTREAM=PP_AUTH_GATEWAY_ORIGIN;',
 "protect_and_retarget_upstream");
once('async function serveGanttUi(req){const r=await fetch(UPSTREAM+"/",',
     'const PP_PLANNER_HTML_ORIGIN=(typeof Bun!=="undefined"&&Bun.env?.PP_PLANNER_HTML_ORIGIN)||"https://production-planner-gateway-production.up.railway.app";\nasync function serveGanttUi(req){const r=await fetch(PP_PLANNER_HTML_ORIGIN+"/",',
     "serve_compatible_ui_from_planner_gateway");
once("await handler(req)}catch(e)","await ppAuthenticatedHandler(req)}catch(e)","enforce_at_server_entrypoint");
once('if(modelCache.model&&Date.now()-modelCache.at<1200)return modelCache.model;',
     'if(false&&modelCache.model&&Date.now()-modelCache.at<1200)return modelCache.model;',"disable_shared_model_cache");
once('modelCache.model=j.model;modelCache.at=Date.now();return j.model','return j.model',"disable_shared_model_write");
once('const c=FINAL_CACHE.get(key);if(c&&Date.now()-c.at<120000)return c.plan;return null',
     'const c=null;return null',"disable_shared_final_cache");
once('if(FINAL_CACHE.size>30)FINAL_CACHE.clear();FINAL_CACHE.set(finalFingerprint(base,model,goal),{plan,at:Date.now()})',
     'return',"disable_shared_final_write");
once('let ppRunSequence=0,ppActiveObjectiveRun=null;',
     'let ppRunSequence=0;const ppActiveObjectiveRuns=new Map();',"tenant_ga_map");
once('function ppBeginObjectiveRun(goal,model){',
     'function ppBeginObjectiveRun(goal,model,sessionKey){',"tenant_ga_begin");
once('ppActiveObjectiveRun=state;',
     'ppActiveObjectiveRuns.set(sessionKey,state);if(ppActiveObjectiveRuns.size>64)ppActiveObjectiveRuns.delete(ppActiveObjectiveRuns.keys().next().value);',"tenant_ga_set");
once('function ppObjectiveRunForModel(model){\n const state=ppActiveObjectiveRun;',
     'function ppObjectiveRunForModel(model,sessionKey){\n const state=ppActiveObjectiveRuns.get(sessionKey);',"tenant_ga_get");
once('ppObjectiveRunForModel(model)','ppObjectiveRunForModel(model,ppSecureSessionKey(req))',"tenant_ga_progress");
once('ppBeginObjectiveRun(goal,model)','ppBeginObjectiveRun(goal,model,ppSecureSessionKey(req))',"tenant_ga_plan");
once('const state=ppActiveObjectiveRun;','const state=ppActiveObjectiveRuns.get(ppSecureSessionKey(req));',"tenant_ga_stop");
once('new URL(req.url).searchParams.get("ppProgressCache")!=="off"?ppCachedProgress(req):progress(req)',
     'progress(req)',"disable_shared_progress_cache");
if(source.includes("ppActiveObjectiveRun=null")||source.includes("const UPSTREAM=(typeof Bun")||source.includes("await handler(req)}catch(e)"))
 throw Error("UNPROTECTED_SERVER_INVARIANT");
if(!source.includes("ppTenantDispatch"))throw Error("TENANT_GATE_MISSING");
writeFileSync("index.ts",source);
console.log("PP_SECURE_GATE_BUILD_OK",JSON.stringify({bytes:source.length,auth:"gateway-v2",serverProtected:true,plannerUiSource:"separate-planner-gateway",tenantScopedGA:true,sharedCachesDisabled:true,loginUi:true}));
