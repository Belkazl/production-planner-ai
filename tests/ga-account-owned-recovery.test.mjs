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

test("916 account-owned operations with 90 setups: real worker preview becomes verified recovery when final rejected",async()=>{
 const rows=Array.from({length:916},(_,i)=>({
  order:"A-ORDER",equipment_ids:["A-EQ"],employee_ids:["A-EMP"],
  resources:[{resource_type:"equipment",id:"A-EQ",name:"Account machine"},
   {resource_type:"employee",id:"A-EMP",name:"Account operator"}],
  is_setup:i<90,phase:i<90?"setup":"process",
  duration_min:5,start_min:i*5,end_min:(i+1)*5,operation_id:"QAOP_"+i
 }));
 const ownBest={ok:true,valid:true,partial:false,operations:rows,
  generic_operations:structuredClone(rows),batches:[{order:"A-ORDER",
   equipment_ids:["A-EQ"]}],duration_minutes:4445,
  batch_count:118,operator_wait_minutes:1200,machine_idle_minutes:500};
 const foreign={ok:true,valid:true,operations:[{order:"FOREIGN-ORDER",
  equipment_ids:["OTHER-EQ"]}],duration_minutes:1};
 const a=environment([
  {status:"running",progress:67,best_preview:ownBest},
  {status:"completed",progress:100,best_preview:foreign,result:foreign}
 ]);
 await a.start();
 let p=await a.progress();
 assert.equal(p.status,200);
 assert.equal(p.data.best_preview.operations.length,916);
 assert.equal(p.data.best_preview.operations.filter(x=>x.is_setup).length,90);
 assert.equal(p.data.best_preview._pp_verified_checkpoint_v1,undefined,
  "internal verification attestation must not leak in progress API");
 const persisted=a.events.save.at(-1);
 assert.equal(persisted.state.best._pp_verified_checkpoint_v1,true,
  "only checked worker snapshot may become durable verified checkpoint");
 assert.deepEqual(persisted.state.best.resume_state.order_sequence,["A-ORDER"]);
 p=await a.progress();
 assert.equal(p.status,200,"complete own verified best must not be replaced by 409");
 assert.equal(p.data.phase,"completed");
 assert.equal(p.data.success,true);
 assert.equal(p.data.result.operations.length,916);
 assert.equal(p.data.result.duration_minutes,4445);
 assert.equal(p.data.result.optimization_account_check_recovered,true);
 assert.equal(p.data.result._pp_verified_checkpoint_v1,undefined);
 assert.equal(p.data.result.optimization_termination_reason,"unowned_native_final_rejected");
 assert.equal(a.events.save.at(-1).state.state,"completed");
 assert.equal(a.events.save.at(-1).state.result.operations.length,916);
 console.log("GA_916_OPERATIONS_90_SETUPS_VERIFIED_CHECKPOINT_SALVAGE_PASS");
});

test("real 1008 production + 89 setups Best found survives native final that silently drops all setups",async()=>{
 const production=Array.from({length:1008},(_,i)=>({
  order:"A-ORDER",equipment_ids:["A-EQ"],employee_ids:["A-EMP"],
  resources:[{resource_type:"equipment",id:"A-EQ",name:"Account machine"}],
  is_setup:false,phase:"process",start_min:i*2,end_min:i*2+2
 }));
 const setups=Array.from({length:89},(_,i)=>({
  order:"A-ORDER",equipment_ids:["A-EQ"],employee_ids:["A-EMP"],
  resources:[{resource_type:"equipment",id:"A-EQ",name:"Account machine"}],
  is_setup:true,phase:"setup",setup_rule_id:"COLOR",start_min:i*2,end_min:i*2+2
 }));
 const rows=[...production,...setups];
 const best={ok:true,valid:true,partial:false,operations:rows,
  generic_operations:structuredClone(rows),setup_operation_count:89,
  duration_minutes:4900,operator_wait_minutes:500,machine_idle_minutes:100,
  batches:[{order:"A-ORDER",equipment_ids:["A-EQ"]}]};
 const native={ok:true,valid:true,operations:production,
  generic_operations:structuredClone(production),setup_operation_count:0,
  duration_minutes:4200,batches:[{order:"A-ORDER",equipment_ids:["A-EQ"]}]};
 const e=environment([
  {status:"running",progress:75,best_preview:best},
  {status:"completed",progress:100,best_preview:best,result:native}
 ]);
 // This is the actual production condition: setup rules exist, so the
 // unprocessed terminal result is NOT a valid improvement over Best found.
 e.model.setup_rules=[{id:"COLOR",setup_parameter:"color",duration_min:10}];
 await e.start();
 const running=await e.progress();
 assert.equal(running.status,200);
 assert.equal(running.data.best_preview.operations.length,1097);
 assert.equal(running.data.best_preview.operations.filter(x=>x.is_setup).length,89);
 const finished=await e.progress();
 assert.equal(finished.status,200);
 assert.equal(finished.data.success,true);
 assert.equal(finished.data.result.operations.length,1097,
  "unprocessed 1008-row worker final must not replace 1097-row verified plan");
 assert.equal(finished.data.result.operations.filter(x=>x.is_setup).length,89);
 assert.equal(finished.data.result.duration_minutes,4900);
 assert.equal(finished.data.result.optimization_termination_reason,
  "final_dropped_setup_operations");
 assert.equal(finished.data.result.optimization_account_check_recovered,true);
 assert.equal(e.events.save.at(-1).state.result.operations.length,1097);
 console.log("GA_REAL_SETUP_LOSS_1097_TO_1008_FIXED_PASS");
});

test("native final with legitimate setups remains authoritative even when setup count decreases",async()=>{
 const original=Array.from({length:1008},(_,i)=>({
  order:"A-ORDER",equipment_ids:["A-EQ"],is_setup:false,phase:"process"
 }));
 const build=n=>({ok:true,valid:true,partial:false,operations:[
  ...original,...Array.from({length:n},()=>({order:"A-ORDER",
   equipment_ids:["A-EQ"],is_setup:true,phase:"setup"}))],
  duration_minutes:5000-n});
 const e=environment([
  {status:"running",progress:65,best_preview:build(89)},
  {status:"completed",progress:100,result:build(22)}
 ]);
 e.model.setup_rules=[{id:"COLOR",setup_parameter:"color",duration_min:10}];
 await e.start();
 assert.equal((await e.progress()).status,200);
 const done=await e.progress();
 assert.equal(done.status,200);
 assert.equal(done.data.result.operations.filter(x=>x.is_setup).length,22);
 assert.equal(done.data.result.optimization_account_check_recovered,undefined);
 console.log("GA_LEGITIMATE_SETUP_REDUCTION_NOT_BLOCKED_PASS");
});

test("worker cannot forge a trusted checkpoint for foreign orders or physical equipment",async()=>{
 const foreignRow={order:"FOREIGN-ORDER",equipment_ids:["A-EQ"],
  resources:[{resource_type:"equipment",id:"A-EQ"}]};
 const ownOrderForeignResource={order:"A-ORDER",
  equipment_ids:["FOREIGN-EQ"],
  resources:[{resource_type:"equipment",id:"A-EQ"}]};
 for(const rows of [[foreignRow],[ownOrderForeignResource]]){
  const a=environment([
   {status:"running",progress:20,best_preview:{
    ok:true,valid:true,_pp_verified_checkpoint_v1:true,operations:rows,
    duration_minutes:400,resume_state:{version:1,order_sequence:["A-ORDER"]}}},
   {status:"completed",progress:100,result:{ok:true,valid:true,
     operations:[{order:"FOREIGN-ORDER"}],duration_minutes:1}}
  ]);
  await a.start();
  const first=await a.progress();
  assert.equal(first.status,200);
  assert.equal(first.data.best_preview,null);
  const terminal=await a.progress();
  assert.equal(terminal.status,409);
  assert.equal(terminal.data.error,"account_plan_mismatch");
 }
 console.log("GA_FORGED_CHECKPOINT_FOREIGN_ORDER_AND_RESOURCE_DENIED_PASS");
});

test("partial or incomplete previews can be displayed but never salvaged as finished plan",async()=>{
 const raw={ok:true,valid:true,partial:true,duration_minutes:3200,
   operations:[{order:"A-ORDER",equipment_ids:["A-EQ"]}]};
 const a=environment([
  {status:"running",progress:30,best_preview:raw},
  {status:"completed",progress:100,result:{ok:true,valid:true,
   operations:[{order:"FOREIGN-ORDER"}],duration_minutes:1}}
 ]);
 await a.start();
 const progress=await a.progress();
 assert.equal(progress.status,200);
 assert.equal(progress.data.best_preview.partial,true);
 const result=await a.progress();
 assert.equal(result.status,409);
 assert.equal(result.data.error,"account_plan_mismatch");
 console.log("GA_PARTIAL_PROGRESS_NEVER_TERMINAL_RECOVERY_PASS");
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
