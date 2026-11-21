import {readFileSync,writeFileSync} from "node:fs";
let source=readFileSync("index.ts","utf8");
function once(from:string,to:string,label:string){
 const count=source.split(from).length-1;
 if(count!==1)throw Error("PP_START_OVER_"+label+"_ANCHOR_"+count);
 source=source.replace(from,to);
}
const client=readFileSync("restart-optimizer-ui.js","utf8");
const server=readFileSync("restart-optimizer-server.js","utf8");
const htmlTransform=readFileSync("restart-optimizer-html.js","utf8");
if(!client.includes("ppOptimizerStartOver")||!server.includes("ppResetOptimizer")||!htmlTransform.includes("ppStartOverHtml"))
 throw Error("START_OVER_SOURCE_MISSING");
const css="#ppOptimizerStartOver{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:10px 14px;border:1px solid #c3d1e5;background:#fff;color:#28527f;font:600 13px/1.2 system-ui,sans-serif;border-radius:9px;cursor:pointer;white-space:normal;max-width:100%}#ppOptimizerStartOver:hover:not(:disabled){background:#eff5fd}#ppOptimizerStartOver:disabled{opacity:.55;cursor:not-allowed}";
const inline='<style id="ppRestartOptimizerStyles">'+css+'</style><script id="pp-restart-optimizer-ui">'+client+'</script>';
once("async function handler(req){",server+"\nasync function handler(req){","server_runtime");
once("if(req.method==='POST'&&path==='/api/optimizer-stop')return stopOptimization(req);",
     "if(req.method==='POST'&&path==='/api/optimizer-stop')return stopOptimization(req);if(req.method==='POST'&&path==='/api/optimizer-reset')return ppResetOptimizer(req);","protected_reset_route");
once("ppActiveObjectiveRuns.set(sessionKey,state);if(ppActiveObjectiveRuns.size>64)",
     "const fresh=ppFreshGenerationSessions.get(sessionKey);if(fresh&&fresh.modelKey===state.modelKey){state.freshEpoch=fresh.epoch;fresh.awaitingRun=false}ppActiveObjectiveRuns.set(sessionKey,state);if(ppActiveObjectiveRuns.size>64)",
     "fresh_begin_run");
once("return jsonifyBridge(out);",
     "return jsonifyBridge(ppFreshPlanResult(req,state,out));","fresh_run_result");
once("async function progress(req){\n const r=await fetch(upstreamUrl(req),",
     "async function progress(req){\n const fresh=ppFreshSession(req);if(fresh?.awaitingRun)return jsonifyBridge({ok:true,running:false,success:false,done:0,total:240,percent:0,phase:'fresh_ready',candidate_preview:null,best_preview:null});\n const r=await fetch(upstreamUrl(req),",
     "suppress_old_result_before_start");
once("const data=await r.json();if(!data?.ok||!(data.candidate_preview||data.best_preview))return jsonifyBridge(data);",
     "const data=await r.json();if(fresh){const state=ppActiveObjectiveRuns.get(ppSecureSessionKey(req));if(state&&Number(data.total)>0)state.lastProgressTotal=Math.round(Number(data.total));if(!state||state.freshEpoch!==fresh.epoch||(!state.seenRunning&&!data.running))return jsonifyBridge({ok:true,running:false,success:false,done:0,total:240,percent:0,phase:'fresh_starting',candidate_preview:null,best_preview:null})}if(!data?.ok||!(data.candidate_preview||data.best_preview))return jsonifyBridge(data);",
     "suppress_stale_optimizer_previews");
once("async function serveGanttUi(req){",htmlTransform+"\nconst PP_START_OVER_INLINE="+JSON.stringify(inline)+";\nasync function serveGanttUi(req){","inject_client_and_html_transform");
once("new Response(ppGaPollHtml.replace('</body>',",
     "new Response(ppStartOverHtml(ppGaPollHtml).replace('</body>',","render_new_baseline_logic");
once("+PP_STOP_INLINE+PP_GANTT_DETAILS_INLINE+PP_ORDER_STACKED_UI_INLINE+'</body>'",
     "+PP_STOP_INLINE+PP_GANTT_DETAILS_INLINE+PP_ORDER_STACKED_UI_INLINE+PP_START_OVER_INLINE+'</body>'",
     "render_restart_button");
if(!source.includes("ppStartOverHtml(ppGaPollHtml)")||!source.includes("ppFreshPlanResult(req,state,out)")||
   !source.includes("ppResetOptimizer(req)")||!source.includes("PP_START_OVER_INLINE"))
 throw Error("START_OVER_BUILD_INTEGRITY_FAILED");
writeFileSync("index.ts",source);
console.log("PP_START_OVER_BUILD_OK",JSON.stringify({
 sourceBytes:source.length,resetRoute:"/api/optimizer-reset",
 authGuardUntouched:true,savedPlansUntouched:true,
 freshBaselineFirstPass:true,perRunGenerations:240,newButton:true
}));
