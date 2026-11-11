import test from "node:test";
import assert from "node:assert/strict";
import {createPythonGAUpstream} from "../../../app/python-ga-upstream.mjs";
const account="e22f1102-a0e7-4d42-88c5-8ad813477777";
const model={orders:[{id:"ORD"}],equipment:[{id:"EQ"}],employees:[],materials:[]};
const make=({loadFails=true,saveFails=false,otherAccount=false}={})=>{
 const calls=[],stored=[];let n=0;
 const bridge=createPythonGAUpstream({
  enabled:true,origin:"http://worker.railway.internal:8080",token:"unit-test-token-at-least-32-chars-123",
  upstreamUrl:req=>"https://invalid.test"+new URL(req.url).pathname,
  sessionKey:async()=>account,verifyLogin:async()=>true,readAccountModel:async()=>model,
  hashModel:x=>JSON.stringify(x),checkPlan:(p,m)=>p.operations.every(op=>m.orders.some(o=>o.id===op.order)),
  stateStore:{load:async()=>{if(loadFails)throw Error("old_state_unreadable");return null},
   save:async(id,s)=>{if(saveFails)throw Error("save_failed");stored.push({id,status:s.state})}},
  fetchImpl:async(url,opt)=>{
   const path=new URL(url).pathname;calls.push({path,method:opt.method||"GET"});
   assert.equal(opt.headers["x-authenticated-account"],account);
   if(path==="/internal/jobs"&&opt.method==="POST"){const payload=JSON.parse(opt.body);
    assert.equal(payload.model.orders[0].id,"ORD");assert(!("__pp_fresh_recovery" in payload.options));
    return Response.json({job_id:(++n).toString(16).padStart(32,"0")},{status:202})}
   if(path.endsWith("/cancel"))return Response.json({status:"cancelled"});
   if(path.startsWith("/internal/jobs/"))return Response.json({status:"completed",progress:100,result:{valid:true,operations:[{order:"ORD"}]}});
   throw Error("unexpected path")
  },sleep:async()=>{},pollMs:0,maxWaitMs:5000
 });
 const invoke=async payload=>bridge.fetch(new Request("https://app.liftorbit.app/api/plan",{method:"POST"}),
  {body:JSON.stringify({...payload,__pp_async_start:true})});
 return {bridge,invoke,calls,stored};
};
test("fresh opt-in starts new own-account job despite unreadable prior state",async()=>{
 const t=make(),r=await t.invoke({__pp_fresh_recovery:true,continue:false});
 assert.equal(r.status,202);assert.equal((await r.json()).started,true);
 assert.equal(t.stored.length,1);assert.equal(t.calls.filter(x=>x.method==="POST"&&x.path==="/internal/jobs").length,1);
});
test("normal optimization fails closed on unreadable state",async()=>{
 const t=make(),r=await t.invoke({continue:false});
 assert.equal(r.status,503);assert.equal((await r.json()).error,"ga_state_unavailable");assert.equal(t.calls.length,0);
});
test("continuation cannot bypass unreadable state even with recovery flag",async()=>{
 const t=make(),r=await t.invoke({__pp_fresh_recovery:true,continue:true});
 assert.equal(r.status,503);assert.equal((await r.json()).error,"ga_state_unavailable");assert.equal(t.calls.length,0);
});
test("fresh recovery still cancels worker if persistence save fails",async()=>{
 const t=make({saveFails:true}),r=await t.invoke({__pp_fresh_recovery:true,continue:false});
 assert.equal(r.status,503);assert.equal((await r.json()).error,"ga_state_unavailable");
 assert(t.calls.some(x=>x.path.endsWith("/cancel")&&x.method==="POST"));
});
