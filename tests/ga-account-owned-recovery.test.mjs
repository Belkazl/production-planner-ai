import test from "node:test";
import assert from "node:assert/strict";
import {createPythonGAUpstream} from "../python-ga-upstream.mjs";

function environment(steps){
 const events={cancel:0,save:[],poll:0};
 const model={orders:[{id:"A-ORDER"}],equipment:[{id:"A-EQ",name:"Account machine"}],
  employees:[{id:"A-EMP",name:"Account operator"}],materials:[]};
 const good={ok:true,valid:true,_pp_verified_checkpoint_v1:true,
  operations:[{order:"A-ORDER",equipment_ids:["A-EQ"],employee_ids:["A-EMP"],
    resources:[{resource_type:"equipment",id:"A-EQ"}]}],
  batches:[{order:"A-ORDER"}],duration_minutes:120,
  resume_state:{version:1,order_sequence:["A-ORDER"],objective:"duration"}};
 const foreign={ok:true,valid:true,operations:[{order:"FOREIGN-ORDER",
    equipment_ids:["FOREIGN-EQ"]}],batches:[{order:"FOREIGN-ORDER"}],duration_minutes:50};
 const stateStore={load:async()=>null,save:async(account,state)=>events.save.push({account,state:JSON.parse(JSON.stringify(state))})};
 const mock=async(url,options)=>{
  const path=new URL(url).pathname;
  if(path==="/internal/jobs"&&options.method==="POST")return Response.json({job_id:"a".repeat(32)},{status:202});
  if(path.endsWith("/cancel")){events.cancel++;return Response.json({status:"cancelled"})}
  assert.equal(path,"/internal/jobs/"+"a".repeat(32));
  const item=steps[Math.min(events.poll++,steps.length-1)];
  return Response.json(item);
 };
 const bridge=createPythonGAUpstream({enabled:true,
  origin:"http://ga-worker-qa.railway.internal:8080",
  token:"test-bridge-token-must-be-long-enough-0123456789",
  upstreamUrl:()=>"/unused",
  sessionKey:async()=> "ACCOUNT_A",
  verifyLogin:async()=>true,
  readAccountModel:async()=>model,
  hashModel:JSON.stringify,
  checkPlan:(p,m)=>{
   const orders=new Set(m.orders.map(x=>x.id)),equipment=new Set(m.equipment.map(x=>x.id));
   return (p.operations||[]).every(x=>orders.has(x.order)&&
     (x.equipment_ids||[]).every(id=>equipment.has(id))) &&
     (p.batches||[]).every(x=>orders.has(x.order));
  },
  stateStore,fetchImpl:mock});
 const request=(path,method="GET")=>new Request("https://app.liftorbit.app"+path,{method,
   headers:{cookie:"test_session=owner"}});
 async function start(){
  const r=await bridge.fetch(request("/api/plan","POST"),{body:JSON.stringify({
    __pp_async_start:true,generations:100})});
  assert.equal(r.status,202);
 }
 async function progress(){
  const r=await bridge.fetch(request("/api/plan-progress"));
  return {status:r.status,data:await r.json()};
 }
 return {bridge,events,model,good,foreign,start,progress};
}

test("unowned speculative candidate cannot abort an account's valid GA job",async()=>{
 const e=environment([{status:"running",progress:14,
    best_preview:{ok:true,valid:true,operations:[{order:"A-ORDER",equipment_ids:["A-EQ"]}]},
    candidate_preview:{ok:true,valid:true,operations:[{order:"FOREIGN-ORDER"}]}}]);
 await e.start();
 const p=await e.progress();
 assert.equal(p.status,200);
 assert.equal(p.data.running,true);
 assert.equal(p.data.best_preview.operations[0].order,"A-ORDER");
 assert.equal(p.data.candidate_preview,null);
 assert.equal(e.events.cancel,0);
});

test("rejected terminal result recovers only previously verified same-account checkpoint",async()=>{
 const e=environment([
  {status:"running",progress:20,best_preview:null,candidate_preview:null},
  {status:"completed",progress:100,best_preview:null,result:null}
 ]);
 e.events.poll=0;
 e.good._pp_verified_checkpoint_v1=true;
 e.foreign.valid=true;
 const running={status:"running",progress:33,best_preview:e.good,candidate_preview:e.foreign};
 const terminal={status:"completed",progress:100,best_preview:e.foreign,result:e.foreign};
 e.events.poll=0;
 // Fresh environment controls all worker status snapshots at construction.
 const a=environment([running,terminal]);
 await a.start();
 const first=await a.progress();
 assert.equal(first.status,200);
 assert.equal(first.data.best_preview.operations[0].order,"A-ORDER");
 assert.equal(first.data.candidate_preview,null);
 const final=await a.progress();
 assert.equal(final.status,200);
 assert.equal(final.data.phase,"completed");
 assert.equal(final.data.success,true);
 assert.equal(final.data.result.operations[0].order,"A-ORDER");
 assert.equal(final.data.result.duration_minutes,120);
 assert.equal(final.data.result.optimization_account_check_recovered,true);
 assert.equal(final.data.result._pp_verified_checkpoint_v1,undefined);
 assert.equal(final.data.result.resume_state.version,1);
 assert.equal(a.events.cancel,0);
 const persisted=a.events.save.at(-1);
 assert.equal(persisted.account,"ACCOUNT_A");
 assert.equal(persisted.state.state,"completed");
 assert.equal(persisted.state.result.operations[0].order,"A-ORDER");
});

test("foreign terminal plan without earlier verified incumbent still fails closed",async()=>{
 const e=environment([{status:"completed",progress:100,best_preview:null,
    result:{ok:true,valid:true,operations:[{order:"FOREIGN-ORDER"}],duration_minutes:12}}]);
 await e.start();
 const p=await e.progress();
 assert.equal(p.status,409);
 assert.equal(p.data.error,"account_plan_mismatch");
 assert.equal(e.events.cancel,0);
});

test("unverified local preview cannot be promoted to accepted result",async()=>{
 const e=environment([
  {status:"running",progress:10,best_preview:{ok:true,valid:true,operations:[{order:"A-ORDER"}]},candidate_preview:null},
  {status:"completed",progress:100,result:{ok:true,valid:true,operations:[{order:"FOREIGN-ORDER"}]}}
 ]);
 await e.start();
 assert.equal((await e.progress()).status,200);
 const p=await e.progress();
 assert.equal(p.status,409);
 assert.equal(p.data.error,"account_plan_mismatch");
});

test("correct completed worker result is never overwritten by checkpoint",async()=>{
 const e=environment([{status:"completed",progress:100,result:{ok:true,valid:true,
    operations:[{order:"A-ORDER",equipment_ids:["A-EQ"]}],
    batches:[{order:"A-ORDER"}],duration_minutes:65,resume_state:{version:1}}}]);
 await e.start();
 const p=await e.progress();
 assert.equal(p.status,200);
 assert.equal(p.data.result.duration_minutes,65);
 assert.equal(p.data.result.optimization_account_check_recovered,undefined);
});
