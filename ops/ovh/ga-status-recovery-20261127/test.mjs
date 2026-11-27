import test from "node:test";
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
const {createPythonGAUpstream}=await import(pathToFileURL(process.argv[2]));
const jobId="a".repeat(32),newId="b".repeat(32),otherId="c".repeat(32);
function harness({worker=404,changed=true,saveFails=false,oldPhase="running",remotePhase="completed"}={}){
 const model={orders:[{id:"A"}],equipment:[{id:"M"}],employees:[],materials:[],setup_rules:[]};
 const records=new Map([["one",{job_id:jobId,model_hash:changed?"old":"current",status:oldPhase,progress:37,best_preview:null}],["two",{job_id:otherId,model_hash:"current",status:"running",progress:15}]]);
 let starts=0,cancels=0,reads=0;
 const upstream=createPythonGAUpstream({enabled:true,origin:"http://ga-worker.railway.internal:8080",token:"x".repeat(80),
  upstreamUrl:req=>req.url,sessionKey:async req=>req.headers.get("x-test-account"),verifyLogin:async()=>true,
  readAccountModel:async()=>model,hashModel:()=>"current",checkPlan:()=>true,
  stateStore:{load:async key=>structuredClone(records.get(key)||null),save:async(key,state)=>{
   if(saveFails)throw Error("save unavailable");
   records.set(key,{job_id:state.id,model_hash:state.modelKey,status:state.state,progress:state.progress,best_preview:state.best,result:state.result,error:state.error});
  }},
  fetchImpl:async(url,opt)=>{
   const path=new URL(url).pathname,key=opt.headers["x-authenticated-account"];
   if(path==="/internal/jobs"&&opt.method==="POST"){starts++;return Response.json({job_id:newId},{status:202})}
   const id=path.split("/")[3];
   assert.equal(id,key==="two"?otherId:jobId);
   if(path.endsWith("/cancel")){cancels++;return Response.json({job_id:id,status:"cancelled"},{status:200})}
   reads++;
   if(key==="two")return Response.json({job_id:id,status:"running",progress:15});
   if(worker===200)return Response.json({job_id:id,status:remotePhase,progress:37});
   return Response.json({error:"worker_unavailable"},{status:worker});
  }});
 const request=(path,method="GET",key="one")=>new Request("https://app.liftorbit.app"+path,{method,headers:{"x-test-account":key}});
 const progress=()=>upstream.fetch(request("/api/plan-progress"));
 const start=()=>upstream.fetch(request("/api/plan","POST"),{body:JSON.stringify({__pp_async_start:true,generations:3,population:6})});
 return {upstream,request,records,progress,start,stats:()=>({starts,cancels,reads})};
}
test("missing worker + changed model returns an actionable terminal state, not endless 409",async()=>{
 const h=harness();const response=await h.progress(),body=await response.json();
 assert.equal(response.status,200);assert.equal(body.phase,"stale");assert.equal(body.running,false);assert.equal(body.result,null);
 assert.equal(h.records.get("one").status,"stale");
 assert.equal(h.records.get("two").status,"running");assert.equal(h.stats().cancels,0);
 assert.equal((await h.start()).status,202);assert.equal(h.stats().starts,1);
});
test("missing worker on same model reports interrupted as HTTP 200",async()=>{
 const h=harness({changed:false});const r=await h.progress(),p=await r.json();
 assert.equal(r.status,200);assert.equal(p.phase,"interrupted");assert.equal(p.running,false);
 assert.equal(h.records.get("one").status,"interrupted");assert.equal(h.stats().cancels,0);
});
test("stale worker already completed on previous model is not cancelled",async()=>{
 const h=harness({worker:200,remotePhase:"completed"});const r=await h.progress();
 assert.equal(r.status,200);assert.equal((await r.json()).phase,"stale");assert.equal(h.stats().cancels,0);
});
test("new start directly recovers missing worker but cannot replace a real active job",async()=>{
 const h=harness();assert.equal((await h.start()).status,202);assert.equal(h.stats().starts,1);
 for(const worker of [200,503,403]){
  const a=harness({worker,remotePhase:"running"});const r=await a.start();assert.equal(r.status,409);assert.equal(a.stats().starts,0);assert.equal(a.stats().cancels,0);assert.equal(a.records.get("one").status,"running");
 }
});
test("a persistence failure must never start another optimization",async()=>{
 const h=harness({saveFails:true});assert.equal((await h.start()).status,503);assert.equal(h.stats().starts,0);assert.equal(h.records.get("one").status,"running");
});
test("concurrent reconciliation does not touch a different account",async()=>{
 const h=harness();const [a,b]=await Promise.all([h.progress(),h.progress()]);
 assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(h.records.get("two").status,"running");assert.equal(h.stats().cancels,0);
});
