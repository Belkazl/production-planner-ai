// LiftOrbit tenant execution gate.
// The legacy optimizer has a global /api/plan-progress and stop state.
// Keep exactly one upstream optimizer job active, while each authenticated
// session has its own queued job, final response and progress visibility.
const ppTenantExecution = {
  active: null, queue: [], byId: new Map(), latest: new Map(), sequence: 0
};
const PP_TENANT_JOB_TTL = 15 * 60 * 1000;
const PP_TENANT_MAX_QUEUE = 32;
const PP_TENANT_MAX_BODY = 1024 * 1024;

function ppTenantJson(data,status=200) {
  return Response.json(data,{status,headers:{"cache-control":"no-store","x-pp-tenant-gate":"v1"}});
}
function ppTenantStoredResponse(job) {
  if(!job.result)return ppTenantJson({ok:true,queued:job.status==="queued",running:job.status==="running",job_id:job.id},202);
  const headers=new Headers(job.result.headers||{});
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.set("cache-control","no-store");
  headers.set("x-pp-tenant-gate","v1");
  return new Response(job.result.body.slice(0),{status:job.result.status,headers});
}
function ppTenantPrune() {
  const now=Date.now();
  for(const [id,job] of ppTenantExecution.byId) {
    if((job.status==="done"||job.status==="stopped")&&now-job.finished>PP_TENANT_JOB_TTL) {
      ppTenantExecution.byId.delete(id);
      if(ppTenantExecution.latest.get(job.key)===job)ppTenantExecution.latest.delete(job.key);
      job.invoke=null;
    }
  }
}
async function ppTenantRunJob(job) {
  let result;
  try {
    const response=await job.invoke();
    // Materialize the response before the next user's optimizer starts.
    const body=await response.arrayBuffer();
    result={status:response.status,headers:[...response.headers.entries()],body};
  } catch(err) {
    console.error("PP_TENANT_PLAN_ERROR",String(err?.message||err).slice(0,180));
    result={status:502,headers:[["content-type","application/json; charset=utf-8"]],
      body:new TextEncoder().encode(JSON.stringify({ok:false,error:"tenant_plan_failed"})).buffer};
  } finally {
    job.invoke=null;
  }
  job.result=result;
  job.status="done";
  job.finished=Date.now();
  job.resolve(ppTenantStoredResponse(job));
  ppTenantExecution.active=null;
  ppTenantPump();
}
function ppTenantPump() {
  if(ppTenantExecution.active)return;
  let next;
  while((next=ppTenantExecution.queue.shift())) {
    if(next.status!=="queued")continue;
    next.status="running";
    ppTenantExecution.active=next;
    // Keep the job alive after a 202 response to a queued browser request.
    void ppTenantRunJob(next);
    return;
  }
}
async function ppTenantStartPlan(req,invoke,key) {
  ppTenantPrune();
  const old=ppTenantExecution.latest.get(key);
  if(old&&(old.status==="queued"||old.status==="running"))
    return ppTenantJson({ok:false,error:"optimization_already_running"},409);
  if(ppTenantExecution.queue.length>=PP_TENANT_MAX_QUEUE)
    return ppTenantJson({ok:false,error:"optimizer_queue_full"},503);
  const body=await req.arrayBuffer();
  if(body.byteLength>PP_TENANT_MAX_BODY)
    return ppTenantJson({ok:false,error:"plan_request_too_large"},413);
  // A queued incoming Request cannot be trusted to retain its network stream.
  // Reconstruct it now and release no tenant data to another session.
  const copy=new Request(req.url,{method:"POST",headers:new Headers(req.headers),body});
  const id="tjob-"+(++ppTenantExecution.sequence)+"-"+Date.now().toString(36);
  let resolve;
  const completion=new Promise(r=>{resolve=r});
  const job={id,key,created:Date.now(),finished:0,status:"queued",
    invoke:()=>invoke(copy),resolve,completion,result:null};
  ppTenantExecution.byId.set(id,job);
  ppTenantExecution.latest.set(key,job);
  const immediately=!ppTenantExecution.active&&ppTenantExecution.queue.length===0;
  ppTenantExecution.queue.push(job);
  ppTenantPump();
  if(immediately)return completion;
  return ppTenantJson({ok:true,queued:true,job_id:id,phase:"queued"},202);
}
function ppTenantPollResult(req,key) {
  ppTenantPrune();
  const id=new URL(req.url).searchParams.get("job_id");
  const job=id&&ppTenantExecution.byId.get(id);
  // A job identifier is never authorization to read another tenant's result.
  if(!job||job.key!==key)return ppTenantJson({error:"job_not_found"},404);
  return ppTenantStoredResponse(job);
}
async function ppTenantProgress(req,invoke,key) {
  ppTenantPrune();
  const job=ppTenantExecution.latest.get(key);
  if(!job)return ppTenantJson({ok:true,running:false,success:false,done:0,total:0,
    candidate_preview:null,best_preview:null,phase:"idle"});
  if(job.status==="queued")return ppTenantJson({ok:true,running:false,queued:true,
    done:0,total:0,phase:"queued",candidate_preview:null,best_preview:null});
  if(job.status==="running"&&ppTenantExecution.active===job) {
    // The shared upstream progress endpoint is safe only for its one active owner.
    return invoke();
  }
  if(job.status==="stopped")return ppTenantJson({ok:true,running:false,stopped:true,
    success:false,done:0,total:0,candidate_preview:null,best_preview:null});
  let data={};
  try{data=JSON.parse(new TextDecoder().decode(job.result.body))}catch(_){}
  const valid=job.result.status>=200&&job.result.status<300&&data?.ok===true;
  return ppTenantJson({ok:valid,running:false,success:valid,
    done:valid?(Number(data.generations)||Number(data.total_generations)||0):0,
    total:valid?(Number(data.generations)||Number(data.total_generations)||0):0,
    phase:valid?"completed":"failed",
    candidate_preview:null,best_preview:valid?data:null,
    ...(valid?{}:{error:data?.error||"optimization_failed"})});
}
async function ppTenantStop(req,invoke,key) {
  const job=ppTenantExecution.latest.get(key);
  if(!job||job.status==="done"||job.status==="stopped")
    return ppTenantJson({ok:false,error:"optimization_not_running"},409);
  if(job.status==="queued") {
    job.status="stopped";job.finished=Date.now();job.invoke=null;
    job.result={status:409,headers:[["content-type","application/json; charset=utf-8"]],
      body:new TextEncoder().encode(JSON.stringify({ok:false,stopped:true,error:"optimization_stopped_before_start"})).buffer};
    ppTenantExecution.queue=ppTenantExecution.queue.filter(q=>q!==job);
    job.resolve(ppTenantStoredResponse(job));
    return ppTenantJson({ok:true,stopped:true,queued:true});
  }
  if(ppTenantExecution.active!==job)return ppTenantJson({ok:false,error:"optimization_not_owned"},409);
  return invoke();
}
async function ppTenantDispatch(req,invoke) {
  const path=new URL(req.url).pathname;
  const key=ppSecureSessionKey(req);
  if(req.method==="POST"&&path==="/api/plan")
    return ppTenantStartPlan(req,invoke,key);
  if(req.method==="GET"&&path==="/api/tenant-plan-result")
    return ppTenantPollResult(req,key);
  if(req.method==="GET"&&path==="/api/plan-progress")
    return ppTenantProgress(req,invoke,key);
  if(req.method==="POST"&&path==="/api/optimizer-stop")
    return ppTenantStop(req,invoke,key);
  return invoke();
}
