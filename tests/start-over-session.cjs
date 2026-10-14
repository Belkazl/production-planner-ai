const assert=require("node:assert/strict");
const fs=require("node:fs");
const code=fs.readFileSync("restart-optimizer-server.js","utf8");
const fakeModel={start:"2026-10-05T08:00:00Z",orders:[{id:"2601"}],equipment:[{id:"E9"}],setup_rules:[]};
const runs=new Map();
const asResponse=(json,status=200)=>new Response(JSON.stringify(json),{status,headers:{"content-type":"application/json"}});
const services=new Function("ppSecureSessionKey","loadModel","modelSignature","jsonifyBridge","ppActiveObjectiveRuns","console",
 code+";return {ppResetOptimizer,ppFreshPlanResult,ppFreshSession,ppFreshGenerationSessions};")(
 req=>req.headers.get("cookie")||"",
 async()=>structuredClone(fakeModel),
 m=>JSON.stringify([m.start,m.orders.map(x=>x.id)]),
 (x,status=200)=>asResponse(x,status),
 runs,console
);
const request=cookie=>new Request("https://planner.example/api/optimizer-reset",{method:"POST",headers:{"cookie":cookie}});
const examplePlan=n=>({ok:true,valid:true,partial:false,operations:[{operation_id:"A1",order:"2601"}],duration_minutes:n,optimization_run:141,total_generations:32640});
(async()=>{
 const A=request("qa_A"),B=request("qa_B");
 const old={id:99,completed:true,stopRequested:true,modelKey:JSON.stringify([fakeModel.start,["2601"]])};
 runs.set("qa_A",old);
 let res=await services.ppResetOptimizer(A),reset=await res.json();
 assert.equal(res.status,200);
 assert.equal(reset.total_generations,0);assert.equal(reset.run,0);
 assert.equal(runs.has("qa_A"),false,"previous session GA must be discarded");
 let freshA=services.ppFreshSession(A),freshB=services.ppFreshSession(B);
 assert.equal(freshB,null,"reset must not affect other accounts");
 assert.equal(freshA.awaitingRun,true);
 const stateA={modelKey:freshA.modelKey,freshEpoch:freshA.epoch};
 freshA.awaitingRun=false;
 const first=services.ppFreshPlanResult(A,stateA,examplePlan(4600));
 assert.equal(first.duration_minutes,4600,"first fresh plan accepted regardless old 2539");
 assert.equal(first.optimization_run,1);
 assert.equal(first.total_generations,240);
 assert.equal(first.pp_fresh_baseline,true);
 const second=services.ppFreshPlanResult(A,stateA,examplePlan(4320));
 assert.equal(second.optimization_run,2);
 assert.equal(second.total_generations,480);
 assert.equal(second.pp_fresh_baseline,false);
 const unchanged=services.ppFreshPlanResult(B,stateA,examplePlan(3550));
 assert.equal(unchanged.total_generations,32640,"unreset sessions must retain original metadata");
 runs.set("qa_A",{completed:false,stopRequested:false});
 res=await services.ppResetOptimizer(A);
 assert.equal(res.status,409,"must not reset an active GA run");
 assert.equal(services.ppFreshSession(A).total,480);
 runs.set("qa_A",{completed:true,stopRequested:false});
 res=await services.ppResetOptimizer(A);assert.equal(res.status,200);
 freshA=services.ppFreshSession(A);
 assert.equal(freshA.runs,0);
 assert.equal(freshA.total,0);
 const oldResponse=services.ppFreshPlanResult(A,stateA,examplePlan(4050));
 assert.equal(oldResponse.optimization_run,141,"stale prior epoch must not affect newly reset counters");
 const newState={modelKey:freshA.modelKey,freshEpoch:freshA.epoch};
 const third=services.ppFreshPlanResult(A,newState,examplePlan(5700));
 assert.equal(third.optimization_run,1);
 assert.equal(third.total_generations,240);
 const bounded=services.ppFreshPlanResult(A,newState,{...examplePlan(5500),generations:120});
 assert.equal(bounded.optimization_run,2);
 assert.equal(bounded.total_generations,360,"count reported generations rather than claiming another 240");
 console.log("PP_FRESH_SESSION_SERVER_PASS",JSON.stringify({
 previousCurrentPlan:2539,firstFreshPlan:4600,secondPlan:4320,
 freshFirstGenerationCount:240,secondGenerationCount:480,
 isolation:true,activeRunReject:true,staleEpochReject:true,
 afterRepeatResetGenerations:third.total_generations
 }));
})().catch(e=>{console.error(e);process.exitCode=1});
