const assert=require("node:assert/strict");
const vm=require("node:vm");
const fs=require("node:fs");
const code=fs.readFileSync("ops/ovh/ga-jank-fix-20261120/async-delivery.js.txt","utf8");
let resolveHeavy;
let slowCalls=0;
const workerSample={ok:true,job_id:"job-42",running:true,success:false,
 phase:"running",percent:37,done:37,total:100,stage:"optimizing",
 candidate_preview:{partial:true,_pp_preview_limited:true,
  operations:[{order:"A",equipment_ids:["EQ-1"],start_min:0,end_min:10}]},
 candidate_serial:1};
const ctx={Map,Date,URL,Request,Response,Promise,Number,String,Object,Math,
 ppSecureSessionKey:()=> "one-disposable-account",
 ppFogHandleAuthenticated:async function(req){
  slowCalls++;
  if(new URL(req.url).searchParams.has("ppLight"))
   return Response.json({...workerSample,phase:"completed",running:false,
    success:true,percent:100,result:{operations:Array.from({length:860},(_,i)=>({id:i}))}});
  return new Promise(resolve=>{resolveHeavy=resolve});
 }};
vm.createContext(ctx);
vm.runInContext(code,ctx);
const endpoint="https://app.liftorbit.app/api/ga-candidate-snapshot";
(async()=>{
 const begin=performance.now();
 const first=await ctx.ppFogHandleAuthenticated(new Request(endpoint+"?ppPreview=1"));
 const duration=performance.now()-begin;
 const a=await first.json();
 assert.ok(duration<80,"preview must not await heavy old status endpoint");
 assert.equal(a.snapshot_pending,true);
 assert.equal(a.phase,"queued");
 // Let the actual heavyweight model fetch start but leave it blocked.
 await new Promise(r=>setImmediate(r));
 assert.equal(slowCalls,1);
 for(let i=0;i<6;i++){
  const t=performance.now();
  const r=await ctx.ppFogHandleAuthenticated(new Request(endpoint+"?ppLight=1"));
  assert.equal(r.status,200);
  assert.ok(performance.now()-t<80,"light status must not block on heavy worker read");
  assert.equal((await r.json()).phase,"queued");
 }
 assert.equal(slowCalls,1,"one heavy status read per active session");
 resolveHeavy(Response.json(workerSample));
 await new Promise(r=>setTimeout(r,10));
 const ready=await ctx.ppFogHandleAuthenticated(new Request(endpoint+"?ppPreview=1"));
 const b=await ready.json();
 assert.equal(b.candidate_preview.operations.length,1);
 assert.equal(b.percent,37);
 assert.equal(b.job_id,"job-42");
 const light=await ctx.ppFogHandleAuthenticated(new Request(endpoint+"?ppLight=1"));
 assert.equal((await light.json()).candidate_preview,null);
 const reset=await ctx.ppFogHandleAuthenticated(new Request(endpoint+"?ppLight=1&ppFresh=1"));
 assert.equal((await reset.json()).phase,"queued");
 console.log("ASYNC_GA_HEAVY_HANDLER_BLOCKED_LIGHT_STATUS_IMMEDIATE_PASS",JSON.stringify({
  firstMilliseconds:Math.round(duration),heavyCalls:slowCalls
 }));
})().catch(e=>{console.error(e);process.exitCode=1});
