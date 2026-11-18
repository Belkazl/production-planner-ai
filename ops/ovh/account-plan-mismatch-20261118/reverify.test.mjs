import test from "node:test";
import assert from "node:assert/strict";
import {createPythonGAUpstream} from "../python-ga-upstream.mjs";
const model={
 orders:Array.from({length:6},(_,i)=>({id:"O"+i})),
 equipment:Array.from({length:14},(_,i)=>({id:"EQ"+i,name:"Equipment "+i})),
 employees:Array.from({length:6},(_,i)=>({id:"EMP"+i,name:"Operator "+i})),
 materials:Array.from({length:6},(_,i)=>({id:"MAT"+i})),
 setup_rules:[{id:"COLOR",duration_min:10}]
};
function create({workerBestValid=true}={}){
 const steps=[],saves=[];
 const rows=Array.from({length:886},(_,i)=>({
  order:workerBestValid?"O"+(i%6):"SOMEONE_ELSE",
  start_min:i*3,end_min:(i+1)*3,phase:i<39?"setup":"process",is_setup:i<39,
  equipment_ids:["EQ"+(i%14)],employee_ids:["EMP"+(i%6)],
  material_ids:["MAT"+(i%6)],
  resources:[{resource_type:"equipment",id:"EQ"+(i%14),name:"Equipment "+(i%14)}]
 }));
 const own={ok:true,valid:true,partial:false,operations:rows,
  generic_operations:rows.map(x=>({...x})),batches:[{order:"O0",equipment_ids:["EQ0"]}],
  duration_minutes:2450,resume_state:{version:1,order_sequence:model.orders.map(x=>x.id)}};
 const invalid={ok:true,valid:true,partial:false,
  operations:[{order:"SOMEONE_ELSE",equipment_ids:["EQ0"]}],duration_minutes:1};
 steps.push({status:"running",progress:30,best_preview:own});
 steps.push({status:"completed",progress:100,result:invalid});
 let cursor=0;
 const fetchImpl=async(url,options)=>{
  const p=new URL(url).pathname;
  if(p==="/internal/jobs"&&options.method==="POST")
   return Response.json({job_id:"d".repeat(32)},{status:202});
  if(p==="/internal/jobs/"+"d".repeat(32))
   return Response.json(steps[Math.min(cursor++,1)]);
  if(p.endsWith("/cancel"))return Response.json({status:"cancelled"});
  throw Error("UNEXPECTED_INTERNAL_ROUTE");
 };
 const stateStore={load:async()=>null,save:async(account,state)=>{
  saves.push(JSON.parse(JSON.stringify(state)));
  // Simulate persistence deserialization that does not preserve the
  // transient attestation. The stored plan itself remains unchanged.
  if(state.best)delete state.best._pp_verified_checkpoint_v1;
 }};
 const ownCheck=(p,m)=>{
  const order=new Set(m.orders.map(x=>x.id)),eq=new Set(m.equipment.map(x=>x.id)),
   emp=new Set(m.employees.map(x=>x.id)),mat=new Set(m.materials.map(x=>x.id));
  const rows=p.generic_operations?.length?p.generic_operations:(p.operations||[]);
  return rows.every(x=>order.has(x.order)&&(x.equipment_ids||[]).every(id=>eq.has(id))&&
   (x.employee_ids||[]).every(id=>emp.has(id))&&(x.material_ids||[]).every(id=>mat.has(id)))&&
   (p.batches||[]).every(b=>order.has(b.order));
 };
 const bridge=createPythonGAUpstream({enabled:true,
  origin:"http://ga-worker-qa.railway.internal:8080",
  token:"isolated-qa-bridge-token-long-enough-0123456789",
  upstreamUrl:()=>"/upstream",sessionKey:async()=>"OWN_ACCOUNT",
  verifyLogin:async()=>true,readAccountModel:async()=>model,
  hashModel:JSON.stringify,checkPlan:ownCheck,fetchImpl,stateStore});
 const request=(p,method="GET")=>new Request("https://app.liftorbit.app"+p,{method,
  headers:{cookie:"session=OWN_ACCOUNT"}});
 return{bridge,request,saves,own};
}
test("886 operation same-account best survives missing attestation and bad worker final",async()=>{
 const x=create();
 const start=await x.bridge.fetch(x.request("/api/plan","POST"),{
  body:JSON.stringify({__pp_async_start:true,generations:100})});
 assert.equal(start.status,202);
 const live=await x.bridge.fetch(x.request("/api/plan-progress"));
 assert.equal(live.status,200);
 const before=await live.json();
 assert.equal(before.best_preview.operations.length,886);
 assert.equal(before.best_preview._pp_verified_checkpoint_v1,undefined);
 const result=await x.bridge.fetch(x.request("/api/plan-progress"));
 assert.equal(result.status,200);
 const final=await result.json();
 assert.equal(final.phase,"completed");
 assert.equal(final.result.operations.length,886);
 assert.equal(final.result.operations.filter(x=>x.is_setup).length,39);
 assert.equal(final.result.optimization_account_check_recovered,true);
 assert.equal(final.result._pp_verified_checkpoint_v1,undefined);
 assert.equal(x.saves.at(-1).state,"completed");
 console.log("GA_886_OWN_BEST_MARKERLESS_SALVAGE_OK");
});
test("different-account best and final cannot bypass ownership guard",async()=>{
 const x=create({workerBestValid:false});
 const started=await x.bridge.fetch(x.request("/api/plan","POST"),{
  body:JSON.stringify({__pp_async_start:true})});
 assert.equal(started.status,202);
 const live=await x.bridge.fetch(x.request("/api/plan-progress"));
 assert.equal(live.status,200);
 assert.equal((await live.json()).best_preview,null);
 const final=await x.bridge.fetch(x.request("/api/plan-progress"));
 assert.equal(final.status,409);
 assert.equal((await final.json()).error,"account_plan_mismatch");
 console.log("GA_FOREIGN_BEST_NEVER_SALVAGED");
});
