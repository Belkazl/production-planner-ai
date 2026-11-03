import test from "node:test";
import assert from "node:assert/strict";
import {createPythonGAUpstream} from "../python-ga-upstream.mjs";
import {createGAStateStore} from "../ga-python-state-store.mjs";

const uuid="e22f1102-a0e7-4d42-88c5-8ad813477777";
const model={orders:[{id:"OA1"}],equipment:[{id:"E1"}],employees:[],materials:[]};
const req=(p,method="GET")=>new Request("https://qa.example"+p,{method});
const body={body:JSON.stringify({generations:12,population:12,seed:1})};
function harness({storeBroken=false}={}){
 const rows=new Map(),worker=new Map(),calls=[];
 const store={load:async k=>rows.get(k)||null,save:async(k,v)=>{
   if(storeBroken)throw Error("db_down");
   rows.set(k,{job_id:v.id,model_hash:v.modelKey,status:v.state,progress:v.progress||0,
    best_preview:v.best||null,result:v.result||null,resume_state:v.resume_state||null});
 }};
 let n=0;
 const fetchImpl=async(url,opts)=>{
  calls.push([url,opts.method||"GET"]);
  const path=new URL(url).pathname,owner=opts.headers["x-authenticated-account"];
  assert.equal(owner,uuid);
  if(path==="/internal/jobs"&&opts.method==="POST"){
   const id=(++n).toString(16).padStart(32,"0");
   worker.set(id,{status:"completed",result:{valid:true,operations:[{order:"OA1"}],resume_state:{completed_runs:1}}});
   return Response.json({job_id:id},{status:202});
  }
  const match=path.match(/^\/internal\/jobs\/([a-f0-9]{32})(\/cancel)?$/);
  assert(match, "unexpected worker path "+path);
  const item=worker.get(match[1]);
  if(match[2]){item.status="cancelled";return Response.json({status:"cancelled"})}
  return Response.json({status:item.status,progress:100,result:item.status==="completed"?item.result:null});
 };
 const create=()=>createPythonGAUpstream({
  enabled:true,origin:"http://ga-testing.railway.internal:8080",token:"unit-test-token-that-is-long-enough",
  upstreamUrl:()=>"/unused",sessionKey:async()=>uuid,verifyLogin:async()=>true,
  readAccountModel:async()=>model,hashModel:x=>JSON.stringify(x),
  checkPlan:(plan,m)=>plan?.operations?.every(op=>m.orders.some(o=>o.id===op.order)),
  stateStore:store,fetchImpl,sleep:async()=>{},pollMs:0,maxWaitMs:5000
 });
 return {create,rows,worker,calls};
}
test("state is written and a fresh Bun bridge restores the completed plan",async()=>{
 const t=harness(),a=t.create();
 const r=await a.fetch(req("/api/plan","POST"),body);
 assert.equal(r.status,200);assert.equal((await r.json()).valid,true);
 assert.equal(t.rows.get(uuid).status,"completed");
 const b=t.create(),p=await b.fetch(req("/api/plan-progress"),{});
 assert.equal(p.status,200);
 const data=await p.json();
 assert.equal(data.success,true);assert.equal(data.percent,100);
 assert.equal(data.best_preview.operations[0].order,"OA1");
});
test("persistence failure fails closed and cancels the remote worker",async()=>{
 const t=harness({storeBroken:true});
 const r=await t.create().fetch(req("/api/plan","POST"),body);
 assert.equal(r.status,503);
 assert.equal((await r.json()).error,"ga_state_unavailable");
 assert(t.calls.some(([url,method])=>url.endsWith("/cancel")&&method==="POST"));
});
test("state store cannot point at a public database or accept weak internal secrets",async()=>{
 assert.throws(()=>createGAStateStore({enabled:true,origin:"https://public.example",token:"very-long-token-value-here-1234567890"}),/private_origin/);
 assert.throws(()=>createGAStateStore({enabled:true,origin:"http://qa-state.railway.internal:8080",token:"short"}),/token_required/);
});
