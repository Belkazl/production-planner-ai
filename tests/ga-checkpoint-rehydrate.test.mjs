import test from "node:test";
import assert from "node:assert/strict";
import {createPythonGAUpstream} from "../python-ga-upstream.mjs";

const model={
 orders:Array.from({length:12},(_,i)=>({id:"OWN_"+i})),
 equipment:Array.from({length:14},(_,i)=>({id:"EQ_"+i,name:"Machine "+i})),
 employees:Array.from({length:5},(_,i)=>({id:"STAFF_"+i,name:"Operator "+i})),
 materials:[],setup_rules:[]
};
const ownOrders=new Set(model.orders.map(x=>x.id));
const equipment=new Set(model.equipment.map(x=>x.id));
const rows=Array.from({length:916},(_,i)=>({
 order:"OWN_"+(i%12),
 is_setup:i<90,phase:i<90?"setup":"process",
 operation_id:"OP_"+i,equipment_ids:["EQ_"+(i%14)],
 employee_ids:["STAFF_"+(i%5)],
 resources:[{resource_type:"equipment",id:"EQ_"+(i%14),name:"Machine "+(i%14)}],
 start_min:i*4,end_min:(i+1)*4,duration_min:4
}));
const ownedPreview={
 ok:true,valid:true,partial:false,operations:rows,generic_operations:structuredClone(rows),
 duration_minutes:4385,batches:[{order:"OWN_0",equipment_ids:["EQ_0"]}],
 order_sequence:model.orders.map(x=>x.id),operator_wait_minutes:100, machine_idle_minutes:20
};
const foreignFinal={ok:true,valid:true,operations:[{order:"FOREIGN",
 equipment_ids:["OTHER_EQ"]}],duration_minutes:1};
const persist=new Map(),events={save:0,load:0};
const workerJobId="d".repeat(32);
const store={
 async load(principal){events.load++;return structuredClone(persist.get(principal)||null)},
 async save(principal,state){
  events.save++;
  persist.set(principal,{
   job_id:state.id,model_hash:state.modelKey,status:state.state,
   progress:state.progress||0,best_preview:structuredClone(state.best||null),
   result:structuredClone(state.result||null),
   resume_state:structuredClone(state.resume_state||null),error:state.error||null
  });
 }
};
const auth=(account,path,method="GET")=>new Request("https://app.liftorbit.app"+path,{
 method,headers:{cookie:"test-session="+account}});
function bridge(account,workerStatus){
 return createPythonGAUpstream({
  enabled:true,
  origin:"http://private-qa-worker.railway.internal:8080",
  token:"long-qa-token-does-not-access-prod-credentials",
  upstreamUrl:()=>"/unused",
  sessionKey:async()=>account,
  verifyLogin:async()=>true,
  readAccountModel:async()=>model,
  hashModel:JSON.stringify,
  checkPlan:(p,m)=>{
   const list=p.generic_operations?.length?p.generic_operations:p.operations||[];
   return list.every(x=>ownOrders.has(String(x.order))&&
    (x.equipment_ids||[]).every(id=>equipment.has(String(id))))&&
    (p.batches||[]).every(x=>ownOrders.has(String(x.order)));
  },
  stateStore:store,
  fetchImpl:async(url,opts)=>{
   const path=new URL(url).pathname;
   if(path==="/internal/jobs"&&opts.method==="POST")return Response.json({job_id:workerJobId},{status:202});
   if(path.endsWith("/cancel"))return Response.json({status:"cancelled"});
   if(path==="/internal/jobs/"+workerJobId)return Response.json(workerStatus);
   throw Error("Unexpected worker route "+path);
  }
 });
}
test("916/90 server-verified checkpoint survives gateway restart and rejects foreign final",async()=>{
 const a=bridge("TENANT_A",{status:"running",progress:50,best_preview:ownedPreview});
 const start=await a.fetch(auth("TENANT_A","/api/plan","POST"),{
  body:JSON.stringify({__pp_async_start:true,generations:4,population:8})});
 assert.equal(start.status,202);
 const running=await a.fetch(auth("TENANT_A","/api/plan-progress"));
 assert.equal(running.status,200);
 const rd=await running.json();
 assert.equal(rd.best_preview.operations.length,916);
 assert.equal(rd.best_preview._pp_verified_checkpoint_v1,undefined);
 assert.equal(persist.get("TENANT_A").best_preview._pp_verified_checkpoint_v1,true);
 assert.equal(persist.get("TENANT_A").best_preview.operations.filter(x=>x.is_setup).length,90);
 // Recreate the Bun bridge to simulate a real gateway process restart, with
 // only its account-private persisted checkpoint available.
 const restarted=bridge("TENANT_A",{status:"completed",progress:100,
  best_preview:foreignFinal,result:foreignFinal});
 const final=await restarted.fetch(auth("TENANT_A","/api/plan-progress"));
 assert.equal(final.status,200,"gateway must restore safely from its own saved incumbent");
 const data=await final.json();
 assert.equal(data.ok,true);
 assert.equal(data.success,true);
 assert.equal(data.result.duration_minutes,4385);
 assert.equal(data.result.operations.length,916);
 assert.equal(data.result.operations.filter(x=>x.is_setup).length,90);
 assert.equal(data.result.optimization_account_check_recovered,true);
 assert.equal(data.result._pp_verified_checkpoint_v1,undefined);
 assert.equal(persist.get("TENANT_A").status,"completed");
 assert.equal(events.load>0,true);
 // A different tenant cannot read or reuse A's cached data or job.
 const other=bridge("TENANT_B",{status:"completed",result:foreignFinal});
 const anonymous=await other.fetch(auth("TENANT_B","/api/plan-progress"));
 assert.equal(anonymous.status,200);
 const ad=await anonymous.json();
 assert.equal(ad.phase,"idle");
 assert.equal(ad.best_preview,null);
 assert.equal(persist.has("TENANT_B"),false);
 console.log("GA_916_SETUP_CHECKPOINT_SURVIVES_RESTART_AND_TENANT_BOUNDARY_PASS");
});
test("persisted foreign checkpoint with forged attestation never passes model ownership",async()=>{
 persist.set("TENANT_C",{
  job_id:workerJobId,model_hash:JSON.stringify(model),status:"running",progress:70,
  best_preview:{...foreignFinal,_pp_verified_checkpoint_v1:true,
   resume_state:{version:0,order_sequence:["FOREIGN"]}},
  result:null,resume_state:null,error:null
 });
 const b=bridge("TENANT_C",{status:"completed",progress:100,result:foreignFinal});
 const res=await b.fetch(auth("TENANT_C","/api/plan-progress"));
 const data=await res.json();
 assert.equal(res.status,409);
 assert.equal(data.error,"account_plan_mismatch");
 console.log("GA_FOREIGN_PERSISTED_CHECKPOINT_DENIED_PASS");
});