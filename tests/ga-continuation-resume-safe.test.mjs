import test from 'node:test';
import assert from 'node:assert/strict';
import {createPythonGAUpstream} from '../python-ga-upstream.mjs';

function fixture({stored=null,foreign=false}={}){
 const model={orders:[{id:'A-1'},{id:'A-2'}],equipment:[{id:'EQ-1'}],
  employees:[{id:'EMP-1'}]};
 const owned={ok:true,valid:true,operations:[
  {order:'A-1',equipment_ids:['EQ-1']},
  {order:'A-2',equipment_ids:['EQ-1']}],
  batches:[{order:'A-1'},{order:'A-2'}],duration_minutes:4338,
  total_generations:15000,optimization_run:1,
  resume_state:{version:0,order_sequence:['A-1','A-2'],best_duration_minutes:4338}};
 const calls=[],ids=[],saved=[];
 const stateStore=stored===null?null:{
  load:async()=>stored,
  save:async(account,state)=>saved.push([account,structuredClone(state)])
 };
 const fetchImpl=async(url,opts)=>{
  const p=new URL(url).pathname;
  if(p==='/internal/jobs'&&opts.method==='POST'){
   const data=JSON.parse(opts.body);
   calls.push({account:opts.headers['x-authenticated-account'],data});
   const id=String(calls.length).padStart(32,'a');
   ids.push(id);
   return Response.json({job_id:id},{status:202});
  }
  if(p.endsWith('/cancel'))return Response.json({status:'cancelled'});
  if(p.includes('/internal/jobs/')){
   return Response.json({status:'completed',progress:100,result:owned});
  }
  throw Error('UNEXPECTED_ENDPOINT');
 };
 const bridge=createPythonGAUpstream({enabled:true,
   origin:'http://ga-worker-qa.railway.internal:8080',
   token:'test-secret-length-is-sufficient-for-bridge-0123456789',
   upstreamUrl:()=>'/unused',sessionKey:async()=>foreign?'FOREIGN':'ACCOUNT_A',
   verifyLogin:async()=>true,readAccountModel:async()=>model,hashModel:JSON.stringify,
   checkPlan:(plan,m)=>{
    const ids=new Set(m.orders.map(o=>o.id));
    return (plan.operations||[]).every(x=>ids.has(x.order))&&
      (plan.batches||[]).every(x=>ids.has(x.order));
   },stateStore,fetchImpl,sleep:async()=>{},
   maxWaitMs:20000});
 const request=(p,method='GET')=>new Request('https://app.liftorbit.app'+p,{method,
     headers:{cookie:'qa_session=test'}});
 async function start(body){
   const r=await bridge.fetch(request('/api/plan','POST'),{body:JSON.stringify(body)});
   return {status:r.status,data:await r.json()};
 }
 return {model,owned,bridge,calls,saved,start,request};
}
function lastOptions(e){return e.calls.at(-1).data.options}

test('persisted legacy version-0 resume_state does not break continuation',async()=>{
 const e=fixture();
 assert.equal((await e.start({generations:10})).status,200);
 const continuation=await e.start({continue:true,resume_state:{version:0}});
 assert.equal(continuation.status,200);
 assert.equal(continuation.data.ok,true);
 const options=lastOptions(e);
 assert.equal(options.continue,true);
 assert.equal(options.resume_state,undefined);
 assert.deepEqual(options.resume_plan.order_sequence,['A-1','A-2']);
 assert.equal(options.resume_plan.duration_minutes,4338);
 assert.equal(options.resume_plan.optimization_run,1);
 assert.equal(options.resume_plan.total_generations,15000);
});

test('user-provided invalid state is ignored in favor of account-owned completed result',async()=>{
 const e=fixture();
 await e.start({generations:10});
 const next=await e.start({continue:true,resume_state:{version:1,order_sequence:['X']},
  resume_plan:{order_sequence:['X'],duration_minutes:1}});
 assert.equal(next.status,200);
 assert.equal(lastOptions(e).resume_state,undefined);
 assert.deepEqual(lastOptions(e).resume_plan.order_sequence,['A-1','A-2']);
 assert.equal(lastOptions(e).resume_plan.duration_minutes,4338);
});

test('valid client order hint can recover continuation when no server result exists',async()=>{
 const e=fixture();
 const r=await e.start({continue:true,resume_plan:{
   order_sequence:['A-2','A-1'],duration_minutes:1,
   optimization_run:5,total_generations:600}});
 assert.equal(r.status,200);
 assert.deepEqual(lastOptions(e).resume_plan.order_sequence,['A-2','A-1']);
 assert.equal(lastOptions(e).resume_plan.duration_minutes,1000000000);
 assert.equal(lastOptions(e).resume_plan.optimization_run,5);
 assert.equal(lastOptions(e).resume_plan.total_generations,600);
 assert.equal(lastOptions(e).resume_state,undefined);
});

test('an old client resume_state with its own order sequence is recovered safely',async()=>{
 const e=fixture();
 const r=await e.start({continue:true,resume_state:{
   version:0,order_sequence:['A-1','A-2'],best_duration_minutes:15}});
 assert.equal(r.status,200);
 assert.equal(lastOptions(e).resume_plan.duration_minutes,1000000000);
 assert.equal(lastOptions(e).resume_state,undefined);
});

test('malformed or foreign continuation without account-owned plan fails closed',async()=>{
 const e=fixture();
 const malformed=await e.start({continue:true,resume_state:{version:0}});
 assert.equal(malformed.status,409);
 assert.equal(malformed.data.error,'continuation_seed_missing_or_invalid');
 assert.equal(e.calls.length,0);
 const foreign=await e.start({continue:true,resume_plan:{order_sequence:['FOREIGN'],duration_minutes:1}});
 assert.equal(foreign.status,409);
 assert.equal(e.calls.length,0);
});

test('stale partial previous ordering includes newly added orders, but old score is not trusted',async()=>{
 const e=fixture();
 const out=await e.start({continue:true,resume_plan:{order_sequence:['A-2'],duration_minutes:1}});
 assert.equal(out.status,200);
 assert.deepEqual(lastOptions(e).resume_plan.order_sequence,['A-2','A-1']);
 assert.equal(lastOptions(e).resume_plan.duration_minutes,1000000000);
});

test('fresh starts remain independent of old continuation and preserve options',async()=>{
 const e=fixture();
 const r=await e.start({continue:false,generations:123,population:21});
 assert.equal(r.status,200);
 assert.equal(lastOptions(e).continue,false);
 assert.equal(lastOptions(e).resume_plan,undefined);
 assert.equal(lastOptions(e).generations,123);
 assert.equal(lastOptions(e).population,21);
});

test('same-model persisted continuation state can fall back to safe ordering hint',async()=>{
 const model={orders:[{id:'A-1'},{id:'A-2'}],equipment:[{id:'EQ-1'}],employees:[{id:'EMP-1'}]};
 const stored={job_id:'b'.repeat(32),model_hash:JSON.stringify(model),status:'failed',
   error:'old_resume_failed',result:null,best_preview:null,progress:20,
   resume_state:{version:0,order_sequence:['A-2','A-1'],best_duration_minutes:0}};
 const e=fixture({stored});
 const result=await e.start({continue:true,resume_state:{version:0}});
 assert.equal(result.status,200);
 const o=lastOptions(e);
 assert.deepEqual(o.resume_plan.order_sequence,['A-2','A-1']);
 assert.equal(o.resume_plan.duration_minutes,1000000000);
 assert.equal(o.resume_state,undefined);
 assert.equal(e.calls[0].account,'ACCOUNT_A');
});
