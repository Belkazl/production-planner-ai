"use strict";
const assert=require("node:assert/strict");
const {runIsolatedSetupSearch,ppWorkerSummary}=require("../worker-manager.ts");
const makeModel=(tenant)=>{
 const orders=Array.from({length:12},(_,i)=>({id:tenant+"-O"+i,parameters:{color:i%2?"B":"A"}}));
 const equipment=Array.from({length:6},(_,i)=>({id:tenant+"-EQ"+i,name:"Machine "+tenant+i,kind:"press"}));
 const employees=Array.from({length:8},(_,i)=>({id:tenant+"-P"+i,name:"Worker "+tenant+i}));
 const setup_rules=[{id:tenant+"-S",equipment_ref:"*",setup_parameter:"color",from_state:"*",to_state:"*",duration_min:7,employee_count:0}];
 return {orders,equipment,employees,setup_rules,objective:"duration",start:"2026-11-02T08:00:00Z"};
};
function makePlan(id,model){
 const operations=[];
 for(let i=0;i<model.orders.length;i++)for(let j=0;j<3;j++){
  const eq=model.equipment[(i+j)%model.equipment.length],emp=model.employees[(i+j)%model.employees.length],duration=20+((i+j)%6)*5;
  operations.push({order:model.orders[i].id,operation_id:id+"-op-"+i+"-"+j,operation_name:"Task "+j,batch_id:id+"-b"+i,batch:i+1,sequence:j+1,start_min:i*70+j*20,end_min:i*70+j*20+duration,duration_min:duration,equipment_ids:[eq.id],employee_ids:[emp.id],resources:[{resource_type:"equipment",id:eq.id,name:eq.name},{resource_type:"employee",id:emp.id,name:emp.name}]});
 }
 return {valid:true,objective:"duration",start:model.start,duration_minutes:1500,operations};
}
(async()=>{
 const tasks=Array.from({length:10},(_,i)=>{
  const id="P"+i,model=makeModel(id),base=makePlan(id,model);
  return runIsolatedSetupSearch(base,model,{iterations:80,seed:171+i}).then(x=>({id,result:x}));
 });
 const results=await Promise.all(tasks);
 assert.equal(results.length,10);
 for(const {id,result} of results){
  assert(result.ok===true);
  const ops=result.best_preview.operations.filter(x=>!x.is_setup);
  assert.equal(ops.length,36);
  assert(ops.every(x=>String(x.order).startsWith(id+"-O")));
 }
 const before=ppWorkerSummary();
 assert.equal(before.started,10);
 assert.equal(before.finished,10);
 assert.equal(before.failed,0);
 assert(before.peak>=2&&before.peak<=before.limit,"worker semaphore was bypassed");
 assert.equal(new Set(before.activePids).size,10,"expected OS process for each job");
 const controller=new AbortController();
 const id="CANCEL",model=makeModel(id),base=makePlan(id,model);
 const cancelled=runIsolatedSetupSearch(base,model,{iterations:180,testHoldMs:3500},controller.signal);
 setTimeout(()=>controller.abort("test_cancel"),170);
 await assert.rejects(cancelled,/worker_cancelled|AbortError/);
 const after=ppWorkerSummary();
 assert.equal(after.cancelled,1);
 assert.equal(after.active,0);
 assert.equal(after.queued,0);
 const other=await runIsolatedSetupSearch(makePlan("STILL",makeModel("STILL")),makeModel("STILL"),{iterations:30});
 assert(other?.best_preview?.operations?.length>=36);
 console.log("PP_PROCESS_WORKER_ISOLATION_PASS",JSON.stringify({tenants:10,separateProcesses:10,peak:after.peak,limit:after.limit,cancelled:after.cancelled,otherUserStillRuns:true,started:after.started,finished:after.finished}));
})().catch(e=>{console.error("PP_PROCESS_WORKER_ISOLATION_FAIL",String(e.stack||e));process.exitCode=1});
