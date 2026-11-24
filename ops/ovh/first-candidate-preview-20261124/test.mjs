import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import {patchUpstream,patchBuild} from "./patch.mjs";

const repo=resolve(fileURLToPath(new URL("../../..",import.meta.url)));
const base=readFileSync(resolve(repo,"ops/ovh/ga-complete-setup-final-20261117/python-ga-upstream.mjs"),"utf8");
const stream=readFileSync(resolve(repo,"ops/ovh/sse-stream-v1-20261120/backend-stream.js.txt"),"utf8");
const baseline=base.replace("  async function fetchUpstream(req,opts){",stream+"  async function fetchUpstream(req,opts){")
  .replace("    if(path==='/api/plan-progress'&&req.method==='GET')return progress(req);",
    "    if(path==='/api/plan-progress'&&req.method==='GET')return progress(req);\n"+
    "    if(path==='/api/plan-events'&&req.method==='GET')return stream(req);");
const patched=patchUpstream(baseline);
const jobId="a".repeat(32),nextId="b".repeat(32),otherId="c".repeat(32);
const pause=()=>new Promise(resolve=>setTimeout(resolve,5));
async function until(condition,label="condition"){
  const end=Date.now()+1000;
  while(Date.now()<end){if(condition())return;await pause()}
  assert.fail("Timed out waiting for "+label);
}
function modelFor(account){return {start:"2026-11-24T08:00:00",equipment:[{id:account+"-PAN"}],
  orders:[{id:account+"-CUTLET"}],employees:[],materials:[],setup_rules:[]};}
function planFor(account,offset=0){
  const operations=Array.from({length:16},(_,i)=>({id:"operation-"+i,operation_id:"operation-"+i,
    order:account+"-CUTLET",equipment_ids:[account+"-PAN"],employee_ids:[],
    start_min:i+offset,end_min:i+1+offset}));
  return {ok:true,valid:true,partial:false,operations,generic_operations:operations,
    batches:[],duration_minutes:16+offset,batch_count:1,operator_wait_minutes:0,machine_idle_minutes:0};
}
function harness({phase="running",available=true}={}){
  const models=new Map([["one",modelFor("one")],["two",modelFor("two")]]);
  const modelHash=model=>JSON.stringify(model);
  const records=new Map([[jobId,{account:"one",phase,progress:phase==="completed"?100:2,
    plan:planFor("one"),available}],
    [otherId,{account:"two",phase:"running",progress:2,plan:planFor("two"),available:true}]]);
  const persisted=new Map([["one",{job_id:jobId,model_hash:modelHash(models.get("one")),
    status:phase,progress:2,result:phase==="completed"?planFor("one"):null}],
    ["two",{job_id:otherId,model_hash:modelHash(models.get("two")),status:"running",progress:2}]]);
  const ticks=new Map(),controllers=new Map();
  const hooks={afterCancel:null,afterSave:null};
  let tickId=0,seq=0,statusReads=0,cancelCalls=0,eventConnections=0,held=null;
  const timers={setInterval(fn,ms){assert.equal(ms,4000);ticks.set(++tickId,fn);return tickId;},
    clearInterval(id){ticks.delete(id)}};
  const factory=new Function("timers",'const {setInterval,clearInterval}=timers;\n'+
    patched.replace("export function createPythonGAUpstream","function createPythonGAUpstream")+
    "\nreturn createPythonGAUpstream;")(timers);
  function snapshot(id){
    const r=records.get(id);
    return {job_id:id,status:r.phase,progress:r.progress,stage:r.phase==="running"?"optimizing":r.phase,
      best_preview:r.available?r.plan:null,candidate_preview:r.phase==="running"&&r.available?r.plan:null,
      result:r.phase==="completed"?r.plan:undefined,error:null,variants:r.variants||[]};
  }
  const bridge=factory({enabled:true,origin:"http://ga-worker.railway.internal:8080",token:"test-token-".repeat(8),
    upstreamUrl:req=>req.url,sessionKey:async req=>req.headers.get("x-test-account"),
    verifyLogin:async req=>req.headers.get("x-test-account")!=="guest",
    readAccountModel:async req=>models.get(req.headers.get("x-test-account")),hashModel:modelHash,
    checkPlan:(plan,model)=>plan.operations.every(op=>model.orders.some(o=>o.id===op.order)),
    stateStore:{load:async account=>persisted.get(account)||null,
      save:async(account,state)=>{
        persisted.set(account,{job_id:state.id,model_hash:state.modelKey,
          status:state.state,result:state.result,best_preview:state.best,progress:state.progress});
        await hooks.afterSave?.(account,state);
      }},
    fetchImpl:async(url,options)=>{
      const path=new URL(url).pathname,principal=options.headers["x-authenticated-account"];
      if(path==="/internal/jobs"&&options.method==="POST"){
        records.set(nextId,{account:principal,phase:"running",progress:1,plan:planFor(principal),available:false});
        return Response.json({job_id:nextId},{status:202});
      }
      const id=path.split("/")[3],record=records.get(id);
      assert.ok(record,"known worker job");
      if(record.account!==principal)return Response.json({error:"account_mismatch"},{status:403});
      if(path.endsWith("/events")){
        eventConnections++;
        return new Response(new ReadableStream({start(controller){controllers.set(id,controller)}}));
      }
      if(path.endsWith("/cancel")){
        cancelCalls++;
        if(!["completed","failed","timed_out"].includes(record.phase))record.phase="cancelled";
        await hooks.afterCancel?.();
        return Response.json(snapshot(id));
      }
      statusReads++;
      const status=snapshot(id);
      if(held){const pending=held;held=null;pending.started();await pending.promise;}
      return Response.json(status);
    }});
  const request=(path,account="one",method="GET")=>new Request("https://app.liftorbit.app"+path,
    {method,headers:{"x-test-account":account}});
  const get=(path,account="one")=>bridge.fetch(request(path,account));
  return {bridge,records,persisted,models,get,request,ticks,hooks,
    statusReads:()=>statusReads,cancelCalls:()=>cancelCalls,eventConnections:()=>eventConnections,
    async subscribe(id=jobId,account="one"){
      const res=await get("/api/plan-events?job_id="+id,account),reader=res.body.getReader();
      const events=[],decoder=new TextDecoder();let buffer="",ended=false;
      const done=(async()=>{
        for(;;){const part=await reader.read();if(part.done)break;
          buffer+=decoder.decode(part.value,{stream:true});let at;
          while((at=buffer.indexOf("\n\n"))>=0){const frame=buffer.slice(0,at);buffer=buffer.slice(at+2);
            const lines=frame.split("\n"),kind=lines.find(x=>x.startsWith("event: "))?.slice(7);
            const value=lines.find(x=>x.startsWith("data: "))?.slice(6);
            if(kind&&value)events.push({kind,data:JSON.parse(value)});
          }
        }ended=true;
      })();
      return {events,done,ended:()=>ended,close:async()=>{await reader.cancel();await done;}};
    },
    emit(id=jobId,{phase="running",pct=5,stage="optimizing"}={}){
      const controller=controllers.get(id);assert.ok(controller,"worker event stream connected");
      const record=records.get(id);record.phase=phase;record.progress=pct;
      controller.enqueue(new TextEncoder().encode("event: progress\ndata: "+JSON.stringify({
        job_id:id,seq:seq++,status:phase,progress:pct,stage})+"\n\n"));
    },
    tick(){assert.equal(ticks.size,1);[...ticks.values()][0]();},
    holdStatus(){let release,started;const promise=new Promise(r=>release=r),began=new Promise(r=>started=r);
      held={promise,started};return {release,began};}
  };
}

test("source patch is parseable, idempotent and fails closed on missing guards",()=>{
  assert.equal(patchUpstream(patched),patched);
  execFileSync(process.execPath,["--check","--input-type=module"],{input:patched,stdio:["pipe","pipe","pipe"]});
  assert.throws(()=>patchUpstream(baseline.replace("state.modelKey!==hashModel(model)","true")),/REQUIRED_GUARD/);
  assert.throws(()=>patchUpstream(baseline.replace("previewTimer=setInterval(()=>{void sendPreview()},4000);","changed();")),/SOURCE_DRIFT/);
});
test("installed v1 source upgrades exactly to verified Stop choices and rejects tail drift",()=>{
  const start=patched.indexOf("      // pp_scoped_stop_verified_choices_v2:");
  const end=patched.indexOf("\n    }catch{return {error:'worker_cancel_failed'}}",start);
  assert(start>0&&end>start);
  const previous=String.raw`      if(requestedId!==null){
        const active=await currentJob(principal);
        if(active?.id!==job.id)return {error:'job_mismatch',http_status:409};
      }
      await save(principal,job);
      return requestedId!==null ? {ok:true,stopped:true,job_id:job.id,phase:'cancelled',running:false} : r.body;`;
  const legacy=patched.slice(0,start)+previous+patched.slice(end);
  assert.equal(patchUpstream(legacy),patched);
  assert.throws(()=>patchUpstream(legacy.replace("return requestedId!==null ? {ok:true,stopped:true,job_id:job.id",
    "return requestedId!==null ? {ok:true,changed:true,job_id:job.id")),/stop_choices_v1_upgrade/);
});

test("authorized completed progress exposes the native job id",async()=>{
  const h=harness({phase:"completed"});
  const response=await h.get("/api/plan-progress"),data=await response.json();
  assert.equal(response.status,200);assert.equal(data.job_id,jobId);assert.equal(data.success,true);
  assert.equal(data.result.operations.length,16);
});
test("scoped progress rejects mismatched or malformed client ids before worker reads",async()=>{
  const h=harness();
  for(const [query,status,error] of [[otherId,409,"job_mismatch"],["",400,"invalid_job_id"],["no",400,"invalid_job_id"]]){
    const response=await h.get("/api/plan-progress?job_id="+query),data=await response.json();
    assert.equal(response.status,status);assert.equal(data.error,error);assert.equal(data.job_id,undefined);
  }
  assert.equal(h.statusReads(),0);
  assert.equal((await (await h.get("/api/plan-progress?job_id="+otherId,"two")).json()).job_id,otherId);
});
test("guest progress never exposes a job or candidate",async()=>{
  const h=harness(),response=await h.get("/api/plan-progress?job_id="+jobId,"guest");
  const data=await response.json();assert.equal(response.status,503);assert.equal(data.job_id,undefined);
  assert.equal(data.result,undefined);assert.equal(h.statusReads(),0);
});
test("scoped Stop cannot cancel another or newer job, and returns actual cancellation identity",async()=>{
  const h=harness();
  const wrong=await h.bridge.cancel(h.request("/api/optimizer-stop?job_id="+otherId,"one","POST"));
  assert.equal(wrong.error,"job_mismatch");assert.equal(wrong.http_status,409);assert.equal(h.cancelCalls(),0);
  const stopped=await h.bridge.cancel(h.request("/api/optimizer-stop?job_id="+jobId,"one","POST"));
  assert.deepEqual(stopped,{ok:true,stopped:true,job_id:jobId,phase:"cancelled",running:false,
    best_preview:null,variants:[]});
  assert.equal(h.cancelCalls(),1);
  const state=await (await h.get("/api/plan-progress?job_id="+jobId)).json();
  assert.equal(state.job_id,jobId);assert.equal(state.phase,"cancelled");
});
test("scoped Stop retains only verified full owned choices and omits resume and internal context",async()=>{
  const h=harness(),record=h.records.get(jobId);
  const good={...planFor("one"),_pp_verified_checkpoint_v1:true,
    resume_state:{version:0,order_sequence:["one-CUTLET"]},
    internal_context:{marker:"TEST_ONLY_INTERNAL_CONTEXT"},account_id:"TEST_ONLY_ACCOUNT_CONTEXT"};
  record.plan=good;
  record.variants=[{index:1,plan:good},{plan:{...good,partial:true}},
    {plan:{...planFor("two"),_pp_verified_checkpoint_v1:true}},
    {plan:{...good,_pp_verified_checkpoint_v1:false}}];
  const stopped=await h.bridge.cancel(h.request("/api/optimizer-stop?job_id="+jobId,"one","POST"));
  assert.equal(stopped.job_id,jobId);assert.equal(stopped.stopped,true);
  assert.equal(stopped.best_preview.valid,true);assert.equal(stopped.best_preview.partial,false);
  assert.equal(stopped.best_preview.operations.length,16);assert.equal(stopped.variants.length,1);
  for(const choice of [stopped.best_preview,...stopped.variants.map(row=>row.plan)]){
    assert.equal(choice.resume_state,undefined);assert.equal(choice._pp_verified_checkpoint_v1,undefined);
    assert.equal(choice.internal_context,undefined);assert.equal(choice.account_id,undefined);
    assert(choice.operations.every(row=>row.order==="one-CUTLET"));
  }
  assert.equal(h.persisted.get("one").best_preview._pp_verified_checkpoint_v1,true,
    "the internal persisted checkpoint retains continuation evidence");
});
test("scoped Stop keeps the previously verified checkpoint when the cancel snapshot omits it",async()=>{
  const h=harness(),record=h.records.get(jobId);
  record.plan={...record.plan,_pp_verified_checkpoint_v1:true};
  await h.get("/api/plan-progress?job_id="+jobId);
  record.available=false;
  const stopped=await h.bridge.cancel(h.request("/api/optimizer-stop?job_id="+jobId,"one","POST"));
  assert.equal(stopped.best_preview?.operations.length,16);assert.equal(stopped.best_preview?.resume_state,undefined);
});
test("a model change during cancellation or persistence suppresses all Stop choices",async()=>{
  for(const timing of ["afterCancel","afterSave"]){
    const h=harness();
    h.records.get(jobId).plan._pp_verified_checkpoint_v1=true;
    h.hooks[timing]=async()=>{h.models.get("one").orders.push({id:"model-changed"});};
    const stopped=await h.bridge.cancel(h.request("/api/optimizer-stop?job_id="+jobId,"one","POST"));
    assert.equal(stopped.http_status,409);assert.equal(stopped.error,"account_model_changed_since_run");
    assert.equal(stopped.best_preview,undefined);assert.equal(stopped.variants,undefined);
    assert.equal(stopped.job_id,jobId);
  }
});
test("model changes block scoped Stop without cancelling the worker",async()=>{
  const h=harness();h.models.get("one").orders.push({id:"changed"});
  const stopped=await h.bridge.cancel(h.request("/api/optimizer-stop?job_id="+jobId,"one","POST"));
  assert.equal(stopped.error,"account_model_changed_since_run");assert.equal(stopped.http_status,409);
  assert.equal(h.cancelCalls(),0);
});
test("completion wins a Stop race without being reported cancelled",async()=>{
  const h=harness();await h.get("/api/plan-progress?job_id="+jobId);
  h.records.get(jobId).phase="completed";
  const stopped=await h.bridge.cancel(h.request("/api/optimizer-stop?job_id="+jobId,"one","POST"));
  assert.equal(stopped.error,"optimization_not_running");assert.equal(stopped.phase,"completed");
  assert.equal(stopped.job_id,jobId);assert.equal(stopped.http_status,409);
  const confirmed=await (await h.get("/api/plan-progress?job_id="+jobId)).json();
  assert.equal(confirmed.success,true);assert.equal(confirmed.job_id,jobId);assert.equal(confirmed.phase,"completed");
});
test("first real candidate is immediate, then four-second samples retain dedup and bounds",async()=>{
  const h=harness({available:false}),s=await h.subscribe();
  try{
    await until(()=>h.statusReads()>0,"initial status probe");await pause();
    assert.equal(s.events.filter(e=>e.kind==="preview").length,0);
    h.records.get(jobId).available=true;h.emit();
    await until(()=>s.events.some(e=>e.kind==="preview"),"first real candidate");
    const first=s.events.find(e=>e.kind==="preview");
    assert.equal(first.data.job_id,jobId);assert.equal(first.data.plan.operations.length,10);
    assert.equal(first.data.plan.partial,true);assert.equal(first.data.plan._pp_preview_kpis.duration_minutes,16);
    h.tick();await pause();await pause();
    assert.equal(s.events.filter(e=>e.kind==="preview").length,1,"unchanged timer candidate is deduplicated");
    h.records.get(jobId).plan=planFor("one",1);h.emit(jobId,{pct:6});await pause();await pause();
    assert.equal(s.events.filter(e=>e.kind==="preview").length,1,"worker changes cannot bypass four-second cadence after first");
    h.tick();await until(()=>s.events.filter(e=>e.kind==="preview").length===2,"next scheduled candidate");
    h.emit(jobId,{phase:"completed",pct:100,stage:"completed"});await s.done;
    assert.equal(s.events.filter(e=>e.kind==="complete").length,1);assert.equal(h.ticks.size,0);
  }finally{if(!s.ended())await s.close();}
});
test("completed short jobs directly emit verified completion with no fabricated preview",async()=>{
  const h=harness({phase:"completed"}),s=await h.subscribe();await s.done;
  assert.deepEqual(s.events.map(e=>e.kind),["ready","complete"]);
  assert.equal(s.events[1].data.job_id,jobId);assert.equal(s.events[1].data.verified,true);
  assert.equal(h.eventConnections(),0);assert.equal(h.ticks.size,0);
});
test("a first candidate signal during an older status read is retried without waiting four seconds",async()=>{
  const h=harness({available:false}),held=h.holdStatus(),s=await h.subscribe();
  try{
    await held.began;
    h.records.get(jobId).available=true;
    h.emit(jobId,{pct:2,stage:"optimizing"});
    await pause();held.release();
    await until(()=>s.events.some(e=>e.kind==="preview"),"candidate signalled during status read");
    assert.equal(h.statusReads(),2);assert.equal(s.events.filter(e=>e.kind==="preview").length,1);
  }finally{held.release();await s.close();}
});
test("a superseded in-flight preview cannot overwrite or expose the newer job",async()=>{
  const h=harness(),held=h.holdStatus(),s=await h.subscribe();
  try{
    await held.began;
    await h.bridge.cancel(h.request("/api/optimizer-stop?job_id="+jobId,"one","POST"));
    const started=await h.bridge.fetch(h.request("/api/plan","one","POST"),{body:JSON.stringify({__pp_async_start:true})});
    assert.equal(started.status,202);assert.equal((await started.json()).job_id,nextId);
    held.release();await pause();await pause();
    assert.equal(s.events.filter(e=>e.kind==="preview").length,0);
    assert.equal(h.persisted.get("one").job_id,nextId);
    const wrong=await h.get("/api/plan-progress?job_id="+jobId);assert.equal(wrong.status,409);
  }finally{held.release();await s.close();}
});

const buildFixture=String.raw`import {readFileSync,writeFileSync} from 'node:fs';
let source=readFileSync('index.ts','utf8');
const prefix='async function stopOptimization(req) {';
source=source.replace(prefix,prefix+\`\n const workerStop=await ppPythonGAUpstream.cancel(req);
 if(workerStop?.error==='worker_cancel_failed')return jsonifyBridge({ok:false,error:'worker_cancel_failed'},503);\`);
writeFileSync('index.ts',source);`;
// A public, minimal copy of the actual builder's replacement expression.
const buildSource=buildFixture.replaceAll("\\`","`");
function generatedStop(builder,result){
  let output;
  const input="async function stopOptimization(req) {\n return jsonifyBridge({legacy:true});\n}\n";
  new Function("readFileSync","writeFileSync",builder.replace(/^import .*;\n/m,""))(
    ()=>input,(_path,text)=>{output=text;});
  execFileSync(process.execPath,["--check","--input-type=module"],{input:output,stdio:["pipe","pipe","pipe"]});
  return new Function("ppPythonGAUpstream","jsonifyBridge",output+"\nreturn stopOptimization;")(
    {cancel:async()=>result},(data,status=200)=>Response.json(data,{status}));
}
test("build helper makes scoped Stop authoritative and retains unbound legacy behavior",async()=>{
  const builder=patchBuild(buildSource);assert.equal(patchBuild(builder),builder);
  const h=harness(),req=h.request("/api/optimizer-stop?job_id="+jobId,"one","POST");
  const ok={ok:true,stopped:true,job_id:jobId,phase:"cancelled",running:false};
  assert.deepEqual(await (await generatedStop(builder,ok)(req)).json(),ok);
  const mismatch=await generatedStop(builder,{error:"job_mismatch",http_status:409})(req);
  assert.equal(mismatch.status,409);assert.equal((await mismatch.json()).error,"job_mismatch");
  assert.deepEqual(await (await generatedStop(builder,null)(h.request("/api/optimizer-stop","one","POST"))).json(),{legacy:true});
});

test("optional deployed sources satisfy exact patch and syntax contracts",{skip:!process.env.LIFTORBIT_PREVIEW_FIXTURE_ROOT},()=>{
  const root=process.env.LIFTORBIT_PREVIEW_FIXTURE_ROOT;
  for(const [name,patch] of [["python-ga-upstream.mjs",patchUpstream],["python-ga-upstream-build.ts",patchBuild]]){
    const source=readFileSync(resolve(root,name),"utf8"),output=patch(source);
    assert.equal(patch(output),output);
    execFileSync(process.execPath,["--check","--input-type=module"],{input:output,stdio:["pipe","pipe","pipe"]});
  }
});
