import {readFileSync,writeFileSync} from "node:fs";
let src=readFileSync("index.ts","utf8");
function once(a,b,k){const n=src.split(a).length-1;if(n!==1)throw Error("STOP_PATCH_"+k+"_"+n);src=src.replace(a,b)}
once('const REV="setups-bridge-20261010-progress-safe-v2";','const REV="setups-bridge-20261011-stop-best-v1";',"rev");
once("state.best=copy(candidate);\n   state.best.objective=state.goal;\n   state.observed++;",
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
const stopApi=String.raw