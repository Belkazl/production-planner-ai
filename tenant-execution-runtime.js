
const PP_COMPUTE_ORIGIN=(typeof Bun!=="undefined"&&Bun.env?.PP_COMPUTE_ORIGIN)||"";
const PP_COMPUTE_SECRET=(typeof Bun!=="undefined"&&Bun.env?.PP_COMPUTE_SECRET)||"";
function ppComputeHeaders(job) {
 return {
  "x-pp-compute-secret":PP_COMPUTE_SECRET,
  "x-pp-tenant-key":job.key,
  "x-pp-job-id":job.id.replace(/-/g,""),
  "cookie":job.request.headers.get("cookie")||"",
  "x-pp-client-origin":new URL(job.request.url).origin,
  "content-type":"application/json"
 };
}
async function ppComputeRequest(job,path,method="GET",body) {
 if(!PP_COMPUTE_ORIGIN||!PP_COMPUTE_SECRET)
  return ppParallelReply({ok:false,error:"isolated_compute_not_configured"},503);
 const url=new URL(path,PP_COMPUTE_ORIGIN);
 const response=await fetch(url,{method,headers:ppComputeHeaders(job),
  ...(method==="POST"?{body:body??"{}"}:{}),
  signal:AbortSignal.timeout(method==="POST"&&path==="/internal/plan"?380000:12000),
  cache:"no-store"});
 const data=await response.arrayBuffer();
 const h=new Headers({"content-type":"application/json","cache-control":"no-store"});
 return new Response(data,{status:response.status,headers:h});
}
async function ppComputePlan(job) {
 const body=await job.request.arrayBuffer();
 return ppComputeRequest(job,"/internal/plan","POST",body);
}
async function ppComputeProgress(job) {
 try{return await ppComputeRequest(job,"/internal/progress")}
 catch(e){return ppParallelReply({ok:false,error:"progress_unavailable"},502)}
}
async function ppComputeStop(job) {
 try{return await ppComputeRequest(job,"/internal/stop","POST","{}")}
 catch(e){return ppParallelReply({ok:false,error:"optimizer_stop_unavailable"},502)}
}

// LiftOrbit parallel authenticated tenant optimizer dispatcher.
// IMPORTANT: the legacy upstream exposes a shared progress endpoint.
// Never forward that progress to an account during overlapping runs.
// Each job's HTTP request, state, result and cancellation are owner-scoped.
// Independent I/O requests are dispatched concurrently up to maxRunning.
const ppParallelMax = Math.min(32,Math.max(1,Number.parseInt(
  (typeof Bun!=="undefined"&&Bun.env?.PP_MAX_CONCURRENT_OPTIMIZATIONS)||"10",10)||10));
const ppParallel = {
  active:new Map(), queue:[], latest:new Map(), jobs:new Map(), peak:0, completed:0
};
const ppParallelTtlMs=15*60*1000;
const ppParallelMaxQueued=64;
const ppParallelMaxBytes=2*1024*1024;
function ppParallelReply(data,status=200) {
  return Response.json(data,{status,headers:{
    "cache-control":"no-store","x-pp-optimizer-isolation":"parallel-v2"
  }});
}
function ppParallelResponse(job) {
  if(!job.result)return ppParallelReply({ok:true,running:job.status==="running",
    queued:job.status==="queued",job_id:job.id},202);
  const headers=new Headers(job.result.headers||[]);
  for(const key of ["set-cookie","content-length","content-encoding","transfer-encoding",
    "access-control-allow-origin","access-control-allow-credentials"])headers.delete(key);
  headers.set("cache-control","no-store");
  headers.set("x-pp-optimizer-isolation","parallel-v2");
  headers.set("x-pp-optimizer-job-id",job.id);
  return new Response(job.result.body.slice(0),{status:job.result.status,headers});
}
function ppParallelPrune() {
  const now=Date.now();
  for(const [id,job] of ppParallel.jobs) {
    if((job.status==="done"||job.status==="stopped")&&now-job.finished>ppParallelTtlMs) {
      ppParallel.jobs.delete(id);
      if(ppParallel.latest.get(job.key)===job)ppParallel.latest.delete(job.key);
    }
  }
}
function ppParallelFinished(job,status,body,headers=[]) {
  job.finished=Date.now();
  job.status=status===409&&job.cancelled?"stopped":"done";
  job.result={status,body,headers};
  job.invoke=null;
  job.complete(ppParallelResponse(job));
}
async function ppParallelExecute(job) {
  try {
    const response=await ppComputePlan(job);
    const raw=await response.arrayBuffer();
    ppParallelFinished(job,response.status,raw,[...response.headers.entries()]);
  }catch(e) {
    console.warn("PP_PARALLEL_JOB_FAILED",String(e?.message||e).slice(0,160));
    ppParallelFinished(job,502,new TextEncoder().encode(
      JSON.stringify({ok:false,error:"optimizer_request_failed"})).buffer,
      [["content-type","application/json; charset=utf-8"]]);
  }finally {
    ppParallel.active.delete(job.id);
    ppParallel.completed++;
    ppParallelPump();
  }
}
function ppParallelPump() {
  while(ppParallel.active.size<ppParallelMax&&ppParallel.queue.length) {
    const job=ppParallel.queue.shift();
    if(job.status!=="queued")continue;
    job.status="running";
    job.started=Date.now();
    ppParallel.active.set(job.id,job);
    ppParallel.peak=Math.max(ppParallel.peak,ppParallel.active.size);
    // One running Promise per user; no global active-job singleton.
    void ppParallelExecute(job);
  }
}
async function ppParallelStart(req,invoke,key) {
  ppParallelPrune();
  const old=ppParallel.latest.get(key);
  if(old&&(old.status==="running"||old.status==="queued"))
    return ppParallelReply({ok:false,error:"optimization_already_running"},409);
  if(ppParallel.queue.length>=ppParallelMaxQueued)
    return ppParallelReply({ok:false,error:"optimizer_capacity_exceeded"},503);
  const body=await req.arrayBuffer();
  if(body.byteLength>ppParallelMaxBytes)
    return ppParallelReply({ok:false,error:"optimizer_request_too_large"},413);
  const copy=new Request(req.url,{method:"POST",headers:new Headers(req.headers),body});
  const id=crypto.randomUUID();
  let complete;
  const responsePromise=new Promise(resolve=>{complete=resolve});
  const job={id,key,status:"queued",created:Date.now(),started:0,finished:0,
    cancelled:false,result:null,safeProgress:null,
    invoke:()=>invoke(copy),request:copy,complete};
  ppParallel.jobs.set(id,job);
  ppParallel.latest.set(key,job);
  ppParallel.queue.push(job);
  ppParallelPump();
  // Keep HTTP semantics compatible with existing Gantt: POST resolves with
  // the original plan, not a fake "queued" or premature "success" response.
  return responsePromise;
}
function ppParallelResult(req,key) {
  ppParallelPrune();
  const id=new URL(req.url).searchParams.get("job_id");
  const job=id&&ppParallel.jobs.get(id);
  if(!job||job.key!==key)return ppParallelReply({error:"job_not_found"},404);
  return ppParallelResponse(job);
}
function ppParallelProgress(req,key) {
  ppParallelPrune();
  const job=ppParallel.latest.get(key);
  if(!job)return ppParallelReply({ok:true,running:false,success:false,
    phase:"idle",done:0,total:0,candidate_preview:null,best_preview:null});
  if(job.status==="queued")return ppParallelReply({ok:true,running:false,queued:true,
    phase:"waiting_for_capacity",done:0,total:0,candidate_preview:null,best_preview:null,
    job_id:job.id});
  if(job.status==="running") {
    return ppComputeProgress(job);
    const p=job.safeProgress;
    return ppParallelReply({ok:true,running:true,success:false,
      phase:p?.phase||"server_optimizing",
      done:p?.done||0,total:p?.total||0,
      percent:p&&p.total?Math.floor(p.done*100/p.total):0,
      candidate_preview:p?.candidate_preview||null,best_preview:p?.best_preview||null,
      job_id:job.id});
  }
  if(job.status==="stopped")return ppParallelReply({ok:true,running:false,
    success:false,stopped:true,phase:"stopped",done:0,total:0,
    candidate_preview:null,best_preview:null});
  let data={};
  try{data=JSON.parse(new TextDecoder().decode(job.result.body))}catch(_){}
  const success=job.result.status>=200&&job.result.status<300&&data?.ok===true;
  const total=success?(Number(data.generations)||Number(data.total_generations)||0):0;
  const validPlan=success&&Array.isArray(data.operations)&&data.operations.length>0;
  return ppParallelReply({ok:success,running:false,success,phase:success?"completed":"failed",
    done:total,total,percent:success?100:0,candidate_preview:null,
    best_preview:validPlan?data:null,job_id:job.id,
    ...(success?{}:{error:data?.error||"optimizer_failed"})});
}
function ppParallelRecord(req,progress) {
  const key=ppSecureSessionKey(req);
  const job=ppParallel.latest.get(key);
  if(!job||job.status!=="running"||!ppParallel.active.has(job.id))return;
  if(!progress||!Number.isFinite(Number(progress.done)))return;
  const {done,total,phase,candidate_preview,best_preview}=progress;
  job.safeProgress={
    done:Math.max(0,Math.trunc(Number(done))),
    total:Math.max(0,Math.trunc(Number(total)||0)),
    phase:String(phase||"setup_aware_schedule"),
    // These plans come ONLY from this request's in-process local search.
    candidate_preview:candidate_preview||null,
    best_preview:best_preview||null
  };
}
async function ppParallelStop(req,invoke,key) {
  const job=ppParallel.latest.get(key);
  if(!job||job.status==="done"||job.status==="stopped")
    return ppParallelReply({ok:false,error:"optimization_not_running"},409);
  if(job.status==="queued") {
    job.cancelled=true;
    ppParallel.queue=ppParallel.queue.filter(j=>j!==job);
    const body=new TextEncoder().encode(JSON.stringify({
      ok:false,stopped:true,error:"optimization_cancelled_before_start"})).buffer;
    ppParallelFinished(job,409,body,[["content-type","application/json; charset=utf-8"]]);
    return ppParallelReply({ok:true,stopped:true,queued:true});
  }
  // Existing optimizer stop routine owns its authenticated run controller;
  // never send a global upstream stop request.
  return ppComputeStop(job);
}
async function ppTenantDispatch(req,invoke) {
  const path=new URL(req.url).pathname;
  const key=ppSecureSessionKey(req);
  if(req.method==="POST"&&path==="/api/plan")
    return ppParallelStart(req,invoke,key);
  if(req.method==="GET"&&path==="/api/plan-progress")
    return ppParallelProgress(req,key);
  if(req.method==="GET"&&path==="/api/tenant-plan-result")
    return ppParallelResult(req,key);
  if(req.method==="GET"&&path==="/api/optimizer-capacity")
    return ppParallelReply({ok:true,active:ppParallel.active.size,
      queued:ppParallel.queue.length,capacity:ppParallelMax,
      peak:ppParallel.peak,completed:ppParallel.completed});
  if(req.method==="POST"&&path==="/api/optimizer-reset") {
    const job=ppParallel.latest.get(key);
    if(job&&(job.status==="queued"||job.status==="running"))
      return ppParallelReply({ok:false,error:"optimization_running_stop_first"},409);
    const response=await invoke(req);
    if(response.ok)ppParallel.latest.delete(key);
    return response;
  }
  if(req.method==="POST"&&path==="/api/optimizer-stop")
    return ppParallelStop(req,invoke,key);
  return invoke(req);
}
