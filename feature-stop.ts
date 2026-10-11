import {readFileSync,writeFileSync} from "node:fs";
let src=readFileSync("index.ts","utf8");
function once(a,b,k){const n=src.split(a).length-1;if(n!==1)throw Error("STOP_PATCH_"+k+"_"+n);src=src.replace(a,b)}
once('const REV="setups-bridge-20261010-progress-safe-v2";','const REV="setups-bridge-20261011-stop-best-v1";',"rev");
once("  state.best=copy(candidate);\n  state.best.objective=state.goal;\n  state.observed++;",
"state.best=copy(candidate);\n   state.best.objective=state.goal;\n   state.observed++;\n   (state.variants??=[]).push({index:state.observed,plan:copy(state.best)});\n   if(state.variants.length>30)state.variants.shift();","capture");
once("const goal=ppObjective(input.objective||model.objective),state=ppBeginObjectiveRun(goal,model);",
"const goal=ppObjective(input.objective||model.objective),state=ppBeginObjectiveRun(goal,model);state.abortController=new AbortController();","signalInit");
once('const r=await fetch(upstreamUrl(req),{method:"POST",headers:relayHeaders(req),body:requestBody,signal:AbortSignal.timeout(350000)});if(!r.ok){state.completed=true;return rawResponse(r)}',
'let r;try{r=await fetch(upstreamUrl(req),{method:"POST",headers:relayHeaders(req),body:requestBody,signal:AbortSignal.any([AbortSignal.timeout(350000),state.abortController.signal])})}catch(e){if(state.stopRequested){state.completed=true;return jsonifyBridge({ok:false,stopped:true,error:"optimization_stopped"})}throw e}if(state.stopRequested){state.completed=true;return jsonifyBridge({ok:false,stopped:true,error:"optimization_stopped"})}if(!r.ok){state.completed=true;return rawResponse(r)}',
"abortUpstream");
once('const choice=ppPreferObservedObjectivePlan(state,result.best_preview,data.operations.length);',
'if(state.stopRequested){state.completed=true;return jsonifyBridge({ok:false,stopped:true,error:"optimization_stopped"})}const choice=ppPreferObservedObjectivePlan(state,result.best_preview,data.operations.length);',
"blockLateFinal");
once("for(let i=0;i<iterations;i++){\n    try {",
"for(let i=0;i<iterations;i++){\n    if(options.shouldStop?.())break;\n    try {","breakSearch");
once('iterations:count,seed:setupSearchSeed(data),objective:goal','iterations:count,seed:setupSearchSeed(data),objective:goal,shouldStop:()=>!!state.stopRequested','searchSignal');

const stopApi=String.raw`
function stoppedVariants(state) {
  return (state?.variants||[]).filter(x=>x?.plan?.valid!==false&&!x?.plan?.partial&&x?.plan?.operations?.length);
}
async function stopOptimization(req) {
 const state=ppActiveObjectiveRun;
 if(!state||state.completed)return jsonifyBridge({ok:false,error:"optimization_not_running"},409);
 if(!state.best?.operations?.length)return jsonifyBridge({ok:false,error:"no_complete_plan_yet"},409);
 state.stopRequested=true;state.completed=true;
 try{state.abortController?.abort("user_stopped")}catch(e){}
 const variants=stoppedVariants(state);
 console.log("APS_STOP_USER",JSON.stringify({run:state.id,objective:state.goal,variants:variants.length,duration:state.best?.duration_minutes}));
 return jsonifyBridge({ok:true,stopped:true,objective:state.goal,best_preview:state.best,variants});
}
`;
once("async function handler(req){const path=new URL(req.url).pathname;",
stopApi+"\nasync function handler(req){const path=new URL(req.url).pathname;if(req.method==='POST'&&path==='/api/optimizer-stop')return stopOptimization(req);","stopRoute");
const stopUi='<script id="ppStopOptimizationV1">'+readFileSync("stop-ui.js","utf8")+"</script>";
once("async function serveGanttUi(req){",
"const PP_STOP_INLINE="+JSON.stringify(stopUi)+";\nasync function serveGanttUi(req){","inject");
once('PP_SECONDARY_GANTTS_INLINE:""))+\'</body>\'','PP_SECONDARY_GANTTS_INLINE:""))+PP_STOP_INLINE+\'</body>\'',"html");
if(!src.includes("ppStopOptimizationV1")||!src.includes("state.abortController"))throw Error("STOP_MISSING_CORE");
writeFileSync("index.ts",src);
console.log("PP_STOP_BUILD_PASS",JSON.stringify({bytes:src.length,ui:stopUi.length}));
