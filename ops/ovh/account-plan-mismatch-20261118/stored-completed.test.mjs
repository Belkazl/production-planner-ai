import test from "node:test";
import assert from "node:assert/strict";
import {createPythonGAUpstream} from "../python-ga-upstream.mjs";
const model={
 orders:Array.from({length:6},(_,i)=>({id:"O"+i})),
 equipment:Array.from({length:14},(_,i)=>({id:"EQ"+i,name:"Machine "+i})),
 employees:Array.from({length:6},(_,i)=>({id:"EMP"+i,name:"Staff "+i})),
 materials:Array.from({length:6},(_,i)=>({id:"MAT"+i})),
 setup_rules:[{id:"COLOR",duration_min:10}]
};
const makeRows=(foreign=false)=>Array.from({length:886},(_,i)=>({
 order:foreign?"FOREIGN_ORDER":"O"+(i%6),
 start_min:i*3,end_min:(i+1)*3,is_setup:i<39,
 phase:i<39?"setup":"process",
 equipment_ids:["EQ"+(i%14)],employee_ids:["EMP"+(i%6)],material_ids:["MAT"+(i%6)],
 resources:[{resource_type:"equipment",id:"EQ"+(i%14),name:"Machine "+(i%14)}]
}));
const plan=(foreign=false)=>({ok:true,valid:true,partial:false,
 operations:makeRows(foreign),generic_operations:makeRows(foreign),
 batches:[{order:foreign?"FOREIGN_ORDER":"O0",equipment_ids:["EQ0"]}],
 duration_minutes:2450,resume_state:{version:1,order_sequence:model.orders.map(x=>x.id)}
});
function build({validWorkerBest=true,validWorkerFinal=false,workerStatus="completed",priorResultValid=false}={}){
 const saved=[],calls=[];
 const stored=priorResultValid?plan():{ok:true,valid:true,duration_minutes:2450,status:"completed",summary:true};
 const fetchImpl=async(url,opts)=>{
  const u=new URL(url),p=u.pathname;
  calls.push(p);
  if(p==="/internal/jobs/"+"a".repeat(32))return Response.json({
    status:workerStatus,best_preview:plan(!validWorkerBest),result:plan(!validWorkerFinal)
  });
  throw Error("unexpected worker endpoint "+p)
 };
 const stateStore={
  load:async()=>({job_id:"a".repeat(32),model_hash:JSON.stringify(model),
    status:"completed",progress:100,result:structuredClone(stored),best_preview:structuredClone(stored)}),
  save:async(account,state)=>saved.push({account,result:structuredClone(state.result)})
 };
 const own=(p,m)=>{
  const ord=new Set(m.orders.map(x=>x.id)),eq=new Set(m.equipment.map(x=>x.id)),
   emp=new Set(m.employees.map(x=>x.id)),mat=new Set(m.materials.map(x=>x.id));
  const rows=p.generic_operations?.length?p.generic_operations:(p.operations||[]);
  return rows.every(x=>ord.has(x.order)&&(x.equipment_ids||[]).every(v=>eq.has(v))&&
   (x.employee_ids||[]).every(v=>emp.has(v))&&(x.material_ids||[]).every(v=>mat.has(v)));
 };
 const upstream=createPythonGAUpstream({enabled:true,
  origin:"http://ga-worker-qa.railway.internal:8080",
  token:"test-rescue-bridge-private-012345678901234",
  upstreamUrl:()=>"/unused",sessionKey:async()=>"SAME_ACCOUNT",
  verifyLogin:async()=>true,readAccountModel:async()=>model,
  hashModel:JSON.stringify,checkPlan:own,fetchImpl,stateStore});
 const req=()=>new Request("https://app.liftorbit.app/api/plan-progress",{headers:{cookie:"signed=account","x-liftorbit-qa-trace":"1"}});
 return{upstream,req,calls,saved};
}
test("state summary with no operations recovers verified 886-op own worker best",async()=>{
 const a=build();
 const first=await a.upstream.fetch(a.req());
 assert.equal(first.status,200);
 const d=await first.json();
 assert.equal(d.phase,"completed");
 assert.equal(d.success,true);
 assert.equal(d.result.operations.length,886);
 assert.equal(d.result.operations.filter(x=>x.is_setup).length,39);
 assert.equal(d.result.optimization_account_check_recovered,true);
 assert.equal(d.result.optimization_termination_reason,"persisted_completed_plan_reverified");
 assert.equal(d.result._pp_verified_checkpoint_v1,undefined);
 assert.equal(a.saved.length,1);
 assert.equal(a.saved[0].account,"SAME_ACCOUNT");
 assert.equal(a.calls.length,1);
 const second=await a.upstream.fetch(a.req());
 assert.equal(second.status,200);
 assert.equal((await second.json()).result.operations.length,886);
 assert.equal(a.calls.length,1,"one recovery, no polling worker once repaired");
 console.log("GA_STORED_COMPLETED_REVALIDATED_886_39_PASS");
});
test("foreign best and foreign final are not used, even when persisted state broken",async()=>{
 const a=build({validWorkerBest:false,validWorkerFinal:false});
 const r=await a.upstream.fetch(a.req());
 assert.equal(r.status,409);
 const d=await r.json();
 assert.equal(d.error,"account_plan_mismatch");
 assert.equal(d.diagnostic.source,"python_ga_bridge");
 assert.equal(d.diagnostic.recovery.bestVerified,false);
 assert.equal(a.saved.length,0);
 console.log("GA_FOREIGN_RESTORE_REJECTED");
});
test("correct worker final beats inferior worker best if independently verified",async()=>{
 const a=build({validWorkerBest:true,validWorkerFinal:true});
 const r=await a.upstream.fetch(a.req());
 assert.equal(r.status,200);
 assert.equal((await r.json()).result.operations.length,886);
 assert.equal(a.saved.length,1);
});
test("uncertain worker phase cannot be trusted",async()=>{
 const a=build({workerStatus:"running"});
 const r=await a.upstream.fetch(a.req());
 assert.equal(r.status,409);
 assert.equal(a.saved.length,0);
});
test("an already valid persisted final never needs a worker fetch",async()=>{
 const a=build({priorResultValid:true});
 const r=await a.upstream.fetch(a.req());
 assert.equal(r.status,200);
 assert.equal(a.calls.length,0);
 assert.equal(a.saved.length,0);
});
