import test from 'node:test';
import assert from 'node:assert/strict';
import {createPythonGAUpstream} from '../python-ga-upstream.mjs';
const ORIGIN='http://ga-worker-qa.railway.internal:8080';
const TOKEN='production-tests-use-long-secret-never-hardcode';
const models=new Map(Array.from({length:10},(_,i)=>{const id='A'+i;return [id,{orders:Array.from({length:12},(_,j)=>({id:id+'-O'+j})),equipment:[{id:id+'-EQ'}],setup_rules:[{id:'S',duration_min:10}]}]}));
function request(id,path,method='GET',body){return new Request('https://app.liftorbit.app'+path,{method,headers:{cookie:'session='+id},body:body?JSON.stringify(body):undefined})}
function makeEnv({hold=false,foreign=false,outage=false}={}){
 const jobs=new Map(),calls=[],stops=[];let counter=0;
 const fetchStub=async(url,opts)=>{
  calls.push({url,opts});
  if(url==='https://legacy.invalid/api/model')return Response.json({ok:true,legacy:true});
  assert.equal(opts.headers.authorization,'Bearer '+TOKEN);
  const key=opts.headers['x-authenticated-account'];const pathname=new URL(url).pathname;
  assert(models.has(key),'account obtained from session, not request body');
  if(outage)throw Error('worker_unreachable');
  if(pathname==='/internal/jobs'&&opts.method==='POST'){
   const msg=JSON.parse(opts.body);
   assert(msg.model.orders.every(x=>x.id.startsWith(key+'-')));
   assert(!('model' in msg.options));assert(!('account' in msg.options));
   const id=(++counter).toString(16).padStart(32,'0');
   jobs.set(id,{owner:key,model:msg.model,status:hold?'running':'completed'});
   return Response.json({job_id:id},{status:202});
  }
  const match=pathname.match(/^\/internal\/jobs\/([a-z0-9]{32})(\/cancel)?$/);
  if(!match)throw Error('unexpected_path '+pathname);
  const j=jobs.get(match[1]);assert.equal(key,j.owner);
  if(match[2]){j.status='cancelled';stops.push(match[1]);return Response.json({status:'cancelled'})}
  const m=foreign?models.get('A9'):j.model;
  const plan={ok:true,valid:true,operations:m.orders.map(x=>({order:x.id})),setup_rules_processed:false,
   resume_state:{version:1,owner:key,completed_runs:1,total_trials:12}};
  const candidate={ok:true,valid:true,operations:[...m.orders].reverse().map(x=>({order:x.id})),candidate:true};
  return Response.json({status:j.status,progress:j.status==='completed'?100:15,
   result:j.status==='completed'?plan:null,best_preview:j.status==='running'?plan:null,
   candidate_preview:j.status==='running'?candidate:null});
 };
 const bridge=createPythonGAUpstream({enabled:true,origin:ORIGIN,token:TOKEN,
  upstreamUrl:req=>'https://legacy.invalid'+new URL(req.url).pathname,
  sessionKey:req=>(req.headers.get('cookie')||'').replace('session=',''),
  verifyLogin:async req=>models.has((req.headers.get('cookie')||'').replace('session=','')),
  readAccountModel:async req=>models.get((req.headers.get('cookie')||'').replace('session=','')),
  hashModel:x=>JSON.stringify(x),checkPlan:(plan,model)=>{
   const ids=new Set(model.orders.map(x=>x.id));return plan.operations.every(x=>ids.has(x.order))},
  fetchImpl:fetchStub,sleep:()=>new Promise(ok=>setTimeout(ok,3)),pollMs:3,maxWaitMs:800
 });
 return {bridge,jobs,stops,calls};
}
test('disabled follows existing upstream including request options',async()=>{
 const calls=[];
 const bridge=createPythonGAUpstream({enabled:false,upstreamUrl:req=>'https://legacy.invalid'+new URL(req.url).pathname,fetchImpl:async(url,opts)=>{calls.push({url,opts});return Response.json({ok:true})}});
 const r=await bridge.fetch(request('A0','/api/plan','POST',{objective:'duration'}),{body:new TextEncoder().encode('{}').buffer});
 assert.equal((await r.json()).ok,true);assert.equal(calls[0].url,'https://legacy.invalid/api/plan');
});
test('ten real upstream requests route account models to distinct jobs',async()=>{
 const {bridge,jobs}=makeEnv();
 const results=await Promise.all(Array.from({length:10},(_,i)=>{
  const id='A'+i,req=request(id,'/api/plan','POST',{objective:'duration'});
  return bridge.fetch(req,{body:new TextEncoder().encode(JSON.stringify({model:models.get('A9'),account:'A9'})).buffer})
 }));
 assert.equal(jobs.size,10);
 for(let i=0;i<10;i++){
  assert.equal(results[i].status,200);
  const p=await results[i].json();assert.equal(p.operations.length,12);
  assert(p.operations.every(x=>x.order.startsWith('A'+i+'-')));
 }
});
test('public plan contract fills legacy frontend arrays used by join()',async()=>{
 const {bridge,jobs}=makeEnv({hold:true});
 const req=request('A8','/api/plan','POST',{});
 const body=new TextEncoder().encode(JSON.stringify({objective:'duration',__pp_async_start:true})).buffer;
 const start=await bridge.fetch(req,{body});
 assert.equal(start.status,202);
 const job=[...jobs.values()][0];
 job.status='completed';
 const progress=await bridge.fetch(request('A8','/api/plan-progress'),{});
 const data=await progress.json();
 assert.equal(data.success,true);
 assert.deepEqual(data.result.validation_errors,[]);
 assert.deepEqual(data.result.errors,[]);
 assert.deepEqual(data.result.warnings,[]);
 assert.deepEqual(data.result.order_sequence,[]);
 assert.deepEqual(data.result.operations[0].equipment_ids,[]);
 assert.deepEqual(data.result.operations[0].employee_ids,[]);
 assert.deepEqual(data.result.operations[0].resources,[]);
});
test('async start returns immediately and progress carries candidate then final result',async()=>{
 const {bridge,jobs}=makeEnv({hold:true});
 const req=request('A6','/api/plan','POST',{});
 const start=await bridge.fetch(req,{body:new TextEncoder().encode(JSON.stringify({objective:'duration',__pp_async_start:true})).buffer});
 assert.equal(start.status,202);
 const started=await start.json();assert.equal(started.started,true);assert.equal(jobs.size,1);
 let progress=await bridge.fetch(request('A6','/api/plan-progress'),{});
 let state=await progress.json();
 assert.equal(state.running,true);
 assert.equal(state.candidate_preview.candidate,true);
 assert(state.candidate_preview.operations.every(x=>x.order.startsWith('A6-')));
 const job=[...jobs.values()][0];job.status='completed';
 progress=await bridge.fetch(request('A6','/api/plan-progress'),{});
 state=await progress.json();
 assert.equal(state.success,true);assert.equal(state.running,false);
 assert.equal(state.result.operations.length,12);
 assert.equal(state.candidate_preview,null);
});
test('completed same-account GA becomes stale after equipment or configuration update, never foreign-plan mismatch',async()=>{
 const id='A2',oldModel=models.get(id);
 const {bridge,jobs}=makeEnv({hold:true});
 const req=request(id,'/api/plan','POST',{});
 try{
  const start=await bridge.fetch(req,{body:new TextEncoder().encode(JSON.stringify({__pp_async_start:true})).buffer});
  assert.equal(start.status,202);
  const job=[...jobs.values()][0];
  job.status='completed';
  let res=await bridge.fetch(request(id,'/api/plan-progress'),{});
  let data=await res.json();
  assert.equal(res.status,200);
  assert.equal(data.success,true);
  assert.equal(data.result.operations.length,12);
  // All order IDs still belong to the account. A later equipment edit is
  // nonetheless a different scheduling model and makes this plan obsolete.
  models.set(id,{...structuredClone(oldModel),
   equipment:[...oldModel.equipment,{id:'A2-NEW-DEVICE',name:'New device'}]});
  res=await bridge.fetch(request(id,'/api/plan-progress'),{});
  data=await res.json();
  assert.equal(res.status,200);
  assert.equal(data.ok,true);
  assert.equal(data.running,false);
  assert.equal(data.success,false);
  assert.equal(data.phase,'stale');
  assert.equal(data.error,'account_model_changed_since_run');
  assert.equal(data.best_preview,null,'never show old final on edited model');
  assert.equal(data.candidate_preview,null);
  assert.equal(data.result,null,'old result cannot be treated as current');
  assert.equal(data.resume_state,null);
  const again=await bridge.fetch(req,{body:new TextEncoder().encode(JSON.stringify({__pp_async_start:true})).buffer});
  assert.equal(again.status,202,'user must be able to start fresh on revised model');
  assert.equal(jobs.size,2);
  assert.equal([...jobs.values()][1].model.equipment.length,2);
  assert.equal((await bridge.fetch(request('A0','/api/plan-progress'),{})).status,200);
  console.log('GA_OWN_COMPLETED_MODEL_STALE_NOT_ACCOUNT_MISMATCH_PASS');
 }finally{models.set(id,oldModel)}
});
test('stale model check also covers changed setup rules even with identical order/equipment IDs',async()=>{
 const id='A3',prior=models.get(id);
 const {bridge,jobs}=makeEnv({hold:true});
 const req=request(id,'/api/plan','POST',{});
 try{
  const start=await bridge.fetch(req,{body:new TextEncoder().encode(JSON.stringify({__pp_async_start:true})).buffer});
  assert.equal(start.status,202);
  jobs.values().next().value.status='completed';
  const done=await bridge.fetch(request(id,'/api/plan-progress'),{});
  assert.equal((await done.json()).success,true);
  models.set(id,{...structuredClone(prior),setup_rules:[{id:'S',duration_min:45}]});
  const changed=await bridge.fetch(request(id,'/api/plan-progress'),{});
  const result=await changed.json();
  assert.equal(result.phase,'stale');
  assert.equal(result.error,'account_model_changed_since_run');
  assert.equal(result.best_preview,null);
  assert.equal(changed.status,200);
  console.log('GA_OWN_CHANGED_SETUP_RULE_STALE_PASS');
 }finally{models.set(id,prior)}
});
test('worker cannot replace schedule with foreign orders',async()=>{
 const {bridge}=makeEnv({foreign:true});
 const res=await bridge.fetch(request('A0','/api/plan','POST',{}),{body:new TextEncoder().encode('{}').buffer});
 assert.equal(res.status,409);assert.equal((await res.json()).error,'account_plan_mismatch');
});
test('stop one job without stopping other sessions',async()=>{
 const {bridge,jobs,stops}=makeEnv({hold:true});
 const r0=request('A0','/api/plan','POST',{}),r1=request('A1','/api/plan','POST',{});
 const t0=bridge.fetch(r0,{body:new TextEncoder().encode('{}').buffer});
 const t1=bridge.fetch(r1,{body:new TextEncoder().encode('{}').buffer});
 while(jobs.size<2)await new Promise(ok=>setTimeout(ok,5));
 const cancel=await bridge.cancel(r0);
 assert.equal(cancel.status,'cancelled');assert.equal(stops.length,1);
 await assert.rejects(t0,{name:'AbortError'}); // Existing Bun stop handler converts this to optimization_stopped.
 const second=[...jobs.values()].find(x=>x.owner==='A1');second.status='completed';
 const other=await t1;assert.equal(other.status,200);
 const plan=await other.json();assert(plan.operations.every(x=>x.order.startsWith('A1-')));
});
test('down worker fails closed without fallback to shared Python GA',async()=>{
 const {bridge,calls}=makeEnv({outage:true});
 const res=await bridge.fetch(request('A3','/api/plan','POST',{}),{body:new TextEncoder().encode('{}').buffer});
 assert.equal(res.status,503);assert.equal((await res.json()).error,'ga_worker_unavailable');
 assert(!calls.some(c=>c.url.startsWith('https://legacy.invalid')));
});
test('unrelated model route still uses the original authenticated API',async()=>{
 const {bridge}=makeEnv();
 const r=await bridge.fetch(request('A3','/api/model'),{});
 assert.equal((await r.json()).legacy,true);
});
test('duplicate async start joins the same active account job instead of returning 409',async()=>{
 const {bridge,jobs}=makeEnv({hold:true});
 const req=request('A7','/api/plan','POST',{});
 const body=new TextEncoder().encode(JSON.stringify({objective:'duration',__pp_async_start:true})).buffer;
 const first=await bridge.fetch(req,{body});
 assert.equal(first.status,202);
 const one=await first.json();assert.equal(one.started,true);assert.equal(jobs.size,1);
 const second=await bridge.fetch(req,{body});
 assert.equal(second.status,202);
 const two=await second.json();
 assert.equal(two.started,true);assert.equal(two.joined,true);
 assert.equal(two.job_id,one.job_id);
 assert.equal(jobs.size,1);
});
test('continue without client resume_state reuses only the same account completed resume state',async()=>{
 const {bridge,calls}=makeEnv();
 const req=request('A2','/api/plan','POST',{});
 let res=await bridge.fetch(req,{body:new TextEncoder().encode(JSON.stringify({objective:'duration'})).buffer});
 assert.equal(res.status,200);await res.json();
 res=await bridge.fetch(req,{body:new TextEncoder().encode(JSON.stringify({objective:'duration',continue:true})).buffer});
 assert.equal(res.status,200);await res.json();
 const posts=calls.filter(x=>x.url.endsWith('/internal/jobs')&&x.opts.method==='POST');
 assert.equal(posts.length,2);
 const second=JSON.parse(posts[1].opts.body);
 assert.equal(second.options.resume_plan.order_sequence.length,12);
 assert.deepEqual(second.options.resume_plan.order_sequence,models.get('A2').orders.map(x=>x.id));
 assert.equal(second.options.resume_state,undefined);
 assert.equal(second.options.continue,true);
 assert.equal(second.options.continue,true);
});
test('manual operation locks are passed through to original GA unchanged',async()=>{
 const {bridge,calls}=makeEnv();
 const locks=[{operation_id:'A5-OP-1',start_min:45,equipment_ids:['A5-EQ']}];
 const req=request('A5','/api/plan','POST',{});
 const res=await bridge.fetch(req,{body:new TextEncoder().encode(JSON.stringify({objective:'duration',locked_operations:locks})).buffer});
 assert.equal(res.status,200);
 const msg=JSON.parse(calls.find(x=>x.opts.method==='POST').opts.body);
 assert.deepEqual(msg.options.locked_operations,locks);
});
test('progress remains account-scoped while legacy GA is running',async()=>{
 const {bridge,jobs}=makeEnv({hold:true});
 const req=request('A4','/api/plan','POST',{});
 const running=bridge.fetch(req,{body:new TextEncoder().encode('{}').buffer});
 while(!jobs.size)await new Promise(ok=>setTimeout(ok,3));
 const progress=await bridge.fetch(request('A4','/api/plan-progress'),{});
 assert.equal(progress.status,200);
 const state=await progress.json();
 assert.equal(state.running,true);assert.equal(state.percent,15);
 const anon=await bridge.fetch(request('INVALID','/api/plan-progress'),{});
 assert.equal(anon.status,503);assert.equal((await anon.json()).error,'authentication_or_model_unavailable');
 await bridge.cancel(req);
 await assert.rejects(running,{name:'AbortError'});
});