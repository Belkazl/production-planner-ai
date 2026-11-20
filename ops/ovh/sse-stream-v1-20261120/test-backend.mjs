import {createPythonGAUpstream} from "../../../new/python-ga-upstream.mjs";
import assert from "node:assert/strict";
const jobId="a".repeat(32),principal="one-account";
const simulateMissing=process.env.SSE_TEST_CANDIDATE_WITHOUT_SETUPS==="1";
const model={
 orders:[{id:"A"}],
 equipment:Array.from({length:14},(_,i)=>({id:"E"+i})),
 employees:[],materials:[],setup_rules:[]
};
const operations=model.equipment.flatMap(eq=>Array.from({length:12},(_,i)=>({
 order:"A",operation_id:"job-"+eq.id+"-"+i,
 equipment_ids:[eq.id],employee_ids:[],material_ids:[],
 start_min:i*20+10,end_min:i*20+19
})));
const setups=model.equipment.flatMap(eq=>Array.from({length:12},(_,i)=>({
 order:i%2===0?null:"A",operation_id:"setup-"+eq.id+"-"+i,
 is_setup:true,phase:"setup",
 // Some changeovers reference equipment only through resources. They must
 // still be displayed before their job.
 equipment_ids:i%3===0?[]:[eq.id],
 resources:i%3===0?[{resource_type:"equipment",id:eq.id}]:[],
 employee_ids:[],material_ids:[],
 start_min:i*20+4,end_min:i*20+9
})));
const genericOperations=[...setups,...operations].sort((a,b)=>a.start_min-b.start_min);
const plan={ok:true,valid:true,partial:false,operations,
 generic_operations:genericOperations,setup_operations:setups,
 setup_operation_count:setups.length,
 order_sequence:["A"],duration_minutes:270,
 batch_count:7,operator_wait_minutes:1200,machine_idle_minutes:1400,
 resume_state:{version:0,order_sequence:["A"]}};
// Match the real GA worker: interim `candidate_preview` has separate
// setup_operations, while operations/generic_operations contain only jobs.
const liveCandidate={...plan,operations,generic_operations:operations,
 setup_operations:simulateMissing?[]:setups};
let state="queued", seq=0,controller=null,readStatus=0,starts=0;
const send=(phase,pct)=>{
 if(!controller)return;
 state=phase;
 controller.enqueue(new TextEncoder().encode(
  "id: "+seq+"\nevent: progress\ndata: "+
  JSON.stringify({job_id:jobId,seq:seq++,status:phase,progress:pct,
   running:phase==="running",stage:phase==="running"?"optimizing":phase})+
  "\n\n"));
 if(phase==="completed")controller.close();
};
const fakeFetch=async(url,opt)=>{
 const u=new URL(url);
 if(u.pathname==="/internal/jobs"&&opt?.method==="POST"){
  starts++;return Response.json({job_id:jobId},{status:202});
 }
 if(u.pathname==="/internal/jobs/"+jobId+"/events"){
  return new Response(new ReadableStream({start(c){
   controller=c;
   send("queued",0);
   setTimeout(()=>send("running",31),140);
   setTimeout(()=>send("running",73),4200);
   setTimeout(()=>send("completed",100),5250);
  }}),{headers:{"content-type":"text/event-stream"}});
 }
 if(u.pathname==="/internal/jobs/"+jobId){
  readStatus++;
  return Response.json({
   job_id:jobId,status:state,progress:state==="completed"?100:state==="queued"?0:73,
   stage:state==="completed"?"completed":"optimizing",
   best_preview:plan,candidate_preview:state==="running"?liveCandidate:null,
   result:state==="completed"?plan:undefined,error:null
  });
 }
 throw Error("UNEXPECTED_FAKE_WORKER_ROUTE_"+u.pathname);
};
const store=new Map();
const upstream=createPythonGAUpstream({
 enabled:true,origin:"http://ga-worker.railway.internal:8080",token:"x".repeat(80),
 upstreamUrl:req=>req.url,sessionKey:async()=>principal,
 verifyLogin:async()=>true,readAccountModel:async()=>model,
 hashModel:()=> "model-hash-1",checkPlan:()=>true,
 stateStore:{
  load:async principal=>store.get(principal)||null,
  save:async(principal,state)=>store.set(principal,{job_id:state.id,
   model_hash:state.modelKey,status:state.state,best_preview:state.best,
   result:state.result,progress:state.progress,resume_state:state.resume_state})
 },
 fetchImpl:fakeFetch
});
const base="https://app.liftorbit.app";
// The browser opens its single SSE connection BEFORE the account POST
// has created a worker job. It must receive HTTP 200, not repeated 409s.
const sse=await upstream.fetch(new Request(base+"/api/plan-events",{method:"GET"}));
assert.equal(sse.status,200);
assert.match(sse.headers.get("content-type"),/text\/event-stream/);
const start=await upstream.fetch(new Request(base+"/api/plan",{
 method:"POST",headers:{"content-type":"application/json"}
}),{body:JSON.stringify({__pp_async_start:true,generations:100,population:50})});
assert.equal(start.status,202);
assert.equal(starts,1);
const reader=sse.body.getReader(),decoder=new TextDecoder();
let buffer="",seen=[],deadline=Date.now()+12500;
while(Date.now()<deadline){
 const {value,done}=await reader.read();
 if(done)break;
 buffer+=decoder.decode(value,{stream:true});
 let index;
 while((index=buffer.indexOf("\n\n"))>=0){
  const frame=buffer.slice(0,index),lines=frame.split("\n");
  buffer=buffer.slice(index+2);
  const type=lines.find(x=>x.startsWith("event: "))?.slice(7);
  const data=lines.find(x=>x.startsWith("data: "))?.slice(6);
  if(type&&data)seen.push({type,data:JSON.parse(data)});
 }
}
console.log("SSE_EARLY_STREAM_AUDIT",JSON.stringify({events:seen.map(x=>({type:x.type,percent:x.data?.percent,reason:x.data?.reason,ops:x.data?.plan?.operations?.length})),readStatus,state,starts}));
const statuses=seen.filter(x=>x.type==="progress").map(x=>x.data.percent);
const previews=seen.filter(x=>x.type==="preview").map(x=>x.data.plan);
const complete=seen.filter(x=>x.type==="complete");
assert.ok(statuses.includes(0)&&statuses.includes(31)&&statuses.includes(73));
assert.equal(statuses.at(-1),100);
assert.equal(complete.length,1);
assert.equal(complete[0].data.verified,true);
assert.ok(previews.length>0,"4s current preview is sent without extra browser request");
assert.ok(previews.length>0);
for(const preview of previews){
 assert.equal(preview.partial,true);
 assert.equal(preview._pp_preview_setups_included,true);
 assert.equal(preview._pp_preview_detached_setups,simulateMissing?0:168,
  "Detached setup restoration must work; verified best fallback must avoid duplicates");
 assert.equal(preview._pp_preview_origin,simulateMissing?"best":"candidate",
  "Choose verified setup-aware best only when the tentative candidate has no setup schedule");
 assert.equal(preview._pp_preview_per_row,10);
 assert.equal(preview._pp_preview_production_count,70);
 assert.equal(preview._pp_preview_setup_count,70);
 assert.equal(preview.operations.length,140,
  "First TEN chronological operations, including changeovers, on 14 machines");
 for(const {id} of model.equipment){
  const assigned=preview.operations.filter(x=>x.equipment_ids.includes(id))
   .sort((a,b)=>a.start_min-b.start_min);
  assert.equal(assigned.length,10,"Exactly ten total operations for "+id);
  assert.deepEqual(assigned.map(x=>x.operation_id),
   Array.from({length:5},(_,i)=>["setup-"+id+"-"+i,"job-"+id+"-"+i]).flat(),
   "First ten operations in actual chronological order, NOT ten jobs");
  assert.equal(assigned.filter(x=>x.is_setup).length,5,
   "Five setup operations each consume one of ten visible slots");
  assert.equal(assigned.filter(x=>!x.is_setup).length,5);
  assert.ok(assigned.some(x=>x.is_setup&&x.order==null),
   "Orderless setup on "+id+" must not be discarded");
  assert.ok(assigned.every(x=>Number(x.start_min)<100),
   "Later operations must not leak into first ten");
 }
}
assert.ok(previews.every(x=>x._pp_preview_kpis?.duration_minutes===270&&
 x._pp_preview_kpis?.batch_count===7&&
 x._pp_preview_kpis?.operator_wait_minutes===1200&&
 x._pp_preview_kpis?.machine_idle_minutes===1400),
 "SSE preview must carry real full-candidate KPIs, not values from the limited preview");
assert.equal(readStatus>=2,true);
const all=seen.map(x=>x.type);
assert.ok(all.indexOf("preview")<all.indexOf("complete"));
const terminal=await upstream.fetch(new Request(base+"/api/plan-progress",{method:"GET"}));
assert.equal(terminal.status,200);
const full=await terminal.json();
assert.equal(full.success,true);
assert.equal(full.result.operations.length,336);
assert.equal(full.result.operations.filter(x=>x.is_setup).length,168,
 "Full candidate must retain all setups after 140-operation preview");
assert.equal(full.result.generic_operations.length,336);
console.log("SSE_NATIVE_GA_WORKER_FIRST_TEN_OPERATIONS_INCLUDE_SETUPS_140_FULL_336_PASS",
 JSON.stringify({types:all,percent:statuses,previewOps:previews.map(x=>x.operations.length),
 workerStatusReads:readStatus}));
