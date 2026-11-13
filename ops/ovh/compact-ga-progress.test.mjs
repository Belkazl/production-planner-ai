import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const src=readFileSync("app/auth-runtime.js","utf8");
assert(src.includes("ppCompactGaProgressResponse(req,res)"),"real compiled auth route patched");
const b=src.indexOf("function ppCompactGaDuplicateOperations(");
const e=src.indexOf("async function ppAuthenticatedHandler(req){",b);
assert(b>=0&&e>b,"compact helper injected before authenticated handler");
const ctx={Response,Headers,URL};
vm.runInNewContext(src.slice(b,e),ctx);
const compact=ctx.ppCompactGaProgressResponse;
const renderRows=p=>{
 const ops=Array.isArray(p.operations)?p.operations:[],
       generic=Array.isArray(p.generic_operations)?p.generic_operations:[];
 return ops.some(o=>o&&o.is_setup===true)?ops:(generic.length?generic:ops);
};
const op=n=>({
 order:"QA_"+n%12,operation_id:"OP"+n,operation_name:"Press",
 start_min:n*4,end_min:n*4+30,duration_min:30,
 equipment_ids:["EQ"+n%14],employee_ids:["EM"+n%5],resources:[
  {resource_type:"equipment",id:"EQ"+n%14},
  {resource_type:"employee",id:"EM"+n%5}
 ],materials:[{id:"QA_MAT",quantity:12}],batch:n%7+1,batch_id:"QA_B"+n
});
const plan=()=>{const operations=Array.from({length:1008},(_,n)=>op(n));
 return {ok:true,valid:true,start:"2026-11-13T08:00:00",duration_minutes:6000,
  operations,generic_operations:structuredClone(operations),
  batches:[{order:"QA_1",batch:1,materials:[{id:"QA_MAT",quantity:10}]}],
  changeovers:[{from_state:"A",to_state:"B",duration_minutes:15}],
  setup_operations:[{order:"QA_1",is_setup:true,start_min:1,end_min:16}],
  machine_idle_minutes:120,operator_wait_minutes:30,validation_errors:[]};
};
const response=data=>Response.json(data,{status:200,headers:{"cache-control":"no-store"}});
const req=new Request("https://app.liftorbit.app/api/plan-progress");
test("losslessly removes identical duplicated generic rows while keeping Gantt data",async()=>{
 const a=plan(),b=structuredClone(a);
 const body={ok:true,running:true,phase:"optimizing",percent:40,done:40,total:100,
  best_preview:a,candidate_preview:b,result:null};
 const original=JSON.stringify(body);
 const out=await compact(req,response(body));
 assert.equal(out.status,200);
 assert.equal(out.headers.get("x-liftorbit-progress-payload"),"lossless-dedup");
 const result=await out.json();
 assert.equal(result.best_preview.generic_operations,undefined);
 assert.equal(result.candidate_preview.generic_operations,undefined);
 assert.deepEqual(JSON.parse(JSON.stringify(result.best_preview.operations)),a.operations);
 assert.deepEqual(JSON.parse(JSON.stringify(renderRows(result.best_preview))),renderRows(a));
 for(const key of ["batches","changeovers","setup_operations","machine_idle_minutes",
                   "operator_wait_minutes","start","duration_minutes"]){
  assert.deepEqual(JSON.parse(JSON.stringify(result.best_preview[key])),a[key],key);
 }
 assert(JSON.stringify(result).length<original.length*.60,"at least 40% payload reduction");
});
test("nonidentical generic rows are never dropped",async()=>{
 const a=plan();a.generic_operations[0].is_setup=true;
 const result=await compact(req,response({ok:true,running:true,best_preview:a,candidate_preview:null}));
 const data=await result.json();
 assert.equal(data.best_preview.generic_operations[0].is_setup,true);
});
test("completed and failed progress responses remain byte-for-byte unchanged",async()=>{
 for(const body of [
  {ok:true,running:false,success:true,phase:"completed",result:plan(),best_preview:plan()},
  {ok:false,running:false,error:"worker_unavailable",best_preview:plan()}
 ]){
  const original=response(body),raw=await original.clone().text();
  const out=await compact(req,original);
  assert.equal(await out.text(),raw);
 }
});
test("other routes, unauthorized responses and malformed JSON pass unchanged",async()=>{
 const wrong=new Request("https://app.liftorbit.app/api/model");
 const sample=response({ok:true,running:true,best_preview:plan()});
 const raw=await sample.clone().text();
 assert.equal(await (await compact(wrong,sample)).text(),raw);
 const denied=Response.json({error:"authentication_required"},{status:401});
 assert.equal((await compact(req,denied)).status,401);
 const malformed=new Response("<not-json>",{status:200});
 assert.equal(await (await compact(req,malformed)).text(),"<not-json>");
});
