import test from "node:test";
import assert from "node:assert/strict";
import {createPythonGAUpstream} from "../python-ga-upstream.mjs";

const ids=Array.from({length:12},(_,i)=>"ORDER-"+i);
function harness(){
 const calls=[];
 const model={orders:ids.map(id=>({id})),
  equipment:[{id:"EQ-0"}],employees:[{id:"EMP-0"}],
  materials:[],setup_rules:[{id:"COLOUR",duration_min:20}]};
 const stateStore={load:async()=>null,save:async()=>{}};
 const bridge=createPythonGAUpstream({
  enabled:true,origin:"http://ga-worker-qa.railway.internal:8080",
  upstreamUrl:()=>"/unused",
  token:"test-ga-token-012345678901234567890",
  sessionKey:async()=> "QA_ACCOUNT",
  verifyLogin:async()=>true,
  readAccountModel:async()=>model,
  hashModel:JSON.stringify,
  checkPlan:()=>true,
  stateStore,
  fetchImpl:async(url,opts)=>{
   const path=new URL(url).pathname;
   if(path==="/internal/jobs"&&opts.method==="POST"){
    const payload=JSON.parse(opts.body);
    calls.push(payload);
    return Response.json({job_id:"a".repeat(32)},{status:202});
   }
   if(path.endsWith("/cancel"))return Response.json({status:"cancelled"});
   return Response.json({status:"queued",progress:0});
  }
 });
 async function send(payload){
  const r=await bridge.fetch(new Request("https://app.liftorbit.app/api/plan",{
   method:"POST",headers:{cookie:"qa_account=safe"}
  }),{body:JSON.stringify(payload)});
  return {http:r.status,body:await r.json()};
 }
 return {model,calls,send};
}
test("resume with all 12 owned orders works even after missing server job state",async()=>{
 const h=harness();
 const response=await h.send({__pp_async_start:true,continue:true,
  generations:10,population:12,resume_plan:{order_sequence:ids}});
 assert.equal(response.http,202);
 assert.equal(response.body.started,true);
 assert.equal(h.calls.length,1);
 assert.equal(h.calls[0].options.continue,true);
 assert.deepEqual(h.calls[0].options.resume_plan.order_sequence,ids);
 assert.equal(h.calls[0].options.resume_plan.duration_minutes,1000000000,
  "untrusted saved-plan score must never constrain worker");
 assert.equal(h.calls[0].options.generations,10);
 assert.equal(h.calls[0].options.population,12);
 assert(!Object.hasOwn(h.calls[0].options,"resume_state"));
});
test("foreign-only order hint is rejected before creating worker",async()=>{
 const h=harness();
 const r=await h.send({__pp_async_start:true,continue:true,
  resume_plan:{order_sequence:["FOREIGN-ORDER"]}});
 assert.equal(r.http,409);
 assert.equal(r.body.error,"continuation_seed_missing_or_invalid");
 assert.equal(h.calls.length,0);
});
test("no previous result or hint fails closed instead of silently becoming fresh",async()=>{
 const h=harness();
 const r=await h.send({continue:true,__pp_async_start:true});
 assert.equal(r.http,409);
 assert.equal(h.calls.length,0);
});
test("valid but incomplete order hint fills only current model's order IDs",async()=>{
 const h=harness();
 const r=await h.send({continue:true,__pp_async_start:true,
  resume_plan:{order_sequence:["ORDER-8","ORDER-3","ORDER-8","FOREIGN-ORDER"]}});
 assert.equal(r.http,202);
 assert.deepEqual(h.calls[0].options.resume_plan.order_sequence.slice(0,2),["ORDER-8","ORDER-3"]);
 assert.equal(h.calls[0].options.resume_plan.order_sequence.length,12);
 assert(!h.calls[0].options.resume_plan.order_sequence.includes("FOREIGN-ORDER"));
});
test("fresh search remains independent without a continuation seed",async()=>{
 const h=harness();
 const r=await h.send({continue:false,__pp_async_start:true,
  generations:10,population:12});
 assert.equal(r.http,202);
 assert.equal(h.calls[0].options.continue,false);
 assert.equal(h.calls[0].options.resume_plan,undefined);
});
console.log("SERVER_CONTINUE_OWNED_ORDER_HINT_WITHOUT_PRIOR_JOB_TESTS_PASS");