/**
 * Optional, internal-only Python GA upstream for the existing Bun plan bridge.
 * The Bun plan(req) remains authoritative for setup-aware scheduling, manual
 * locks, objective selection, account-model validation, and frontend format.
 * Never enable before a real legacy-GA black-box compatibility test passes.
 */
export function createPythonGAUpstream({
  enabled = false, origin, token, upstreamUrl, stateStore = null,
  sessionKey, verifyLogin, readAccountModel, hashModel, checkPlan,
  fetchImpl = fetch, sleep = ms => new Promise(ok => setTimeout(ok, ms)),
  now = () => Date.now(), maxWaitMs = 340000, pollMs = 250
}) {
  const jobs = new Map();
  const response = (body, status=200) => Response.json(body,{status,headers:{'cache-control':'no-store'}});
  const fallback = (req,opts) => fetchImpl(upstreamUrl(req),opts);
  if (!enabled) return {fetch:fallback,cancel:async()=>null,status:()=>({enabled:false})};
  if(!/^http:\/\/[a-z0-9-]+\.railway\.internal:\d+$/.test(String(origin)))throw Error('private_worker_origin_required');
  if(typeof token!=='string'||token.length<24)throw Error('worker_token_unavailable');
  for(const [label,fn] of Object.entries({upstreamUrl,sessionKey,verifyLogin,readAccountModel,hashModel,checkPlan}))
    if(typeof fn!=='function')throw Error('missing_dependency_'+label);
  async function call(principal,path,method='GET',body){
    const res=await fetchImpl(origin+path,{method,headers:{authorization:'Bearer '+token,
      'x-authenticated-account':principal,accept:'application/json',
      ...(method==='POST'?{'content-type':'application/json'}:{})},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000),redirect:'manual',cache:'no-store'});
    return {status:res.status,body:await res.json().catch(()=>({}))};
  }
  const account = async req => {
    const principal=await sessionKey(req);
    if(typeof principal!=='string'||principal.length<1||principal.length>256||!await verifyLogin(req))throw Error('account_not_authenticated');
    return principal;
  };
  const publicPlan = plan => {
    if(!plan||typeof plan!=='object')return plan;
    const rawOps=Array.isArray(plan.operations)&&plan.operations.length
      ? plan.operations
      : (Array.isArray(plan.generic_operations)?plan.generic_operations:[]);
    const operations=rawOps
      .filter(x=>x&&typeof x==='object')
      .map(x=>({
        ...x,
        equipment_ids:Array.isArray(x.equipment_ids)?x.equipment_ids:(x.equipment_id!=null?[x.equipment_id]:[]),
        employee_ids:Array.isArray(x.employee_ids)?x.employee_ids:(x.employee_id!=null?[x.employee_id]:[]),
        resources:Array.isArray(x.resources)?x.resources:[],
        material_ids:Array.isArray(x.material_ids)?x.material_ids:[]
      }));
    const generic=Array.isArray(plan.generic_operations)&&plan.generic_operations.length
      ? plan.generic_operations.map(x=>x&&typeof x==='object'?({
          ...x,
          equipment_ids:Array.isArray(x.equipment_ids)?x.equipment_ids:(x.equipment_id!=null?[x.equipment_id]:[]),
          employee_ids:Array.isArray(x.employee_ids)?x.employee_ids:(x.employee_id!=null?[x.employee_id]:[]),
          resources:Array.isArray(x.resources)?x.resources:[],
          material_ids:Array.isArray(x.material_ids)?x.material_ids:[]
        }):x)
      : operations;
    const batches=(Array.isArray(plan.batches)?plan.batches:[]).map(b=>b&&typeof b==='object'?({
      ...b,
      equipment_ids:Array.isArray(b.equipment_ids)?b.equipment_ids:[],
      employee_ids:Array.isArray(b.employee_ids)?b.employee_ids:[]
    }):b);
    return {
      ...plan,
      ok:plan.ok!==false,
      valid:plan.valid!==false,
      validation_errors:Array.isArray(plan.validation_errors)?plan.validation_errors:[],
      errors:Array.isArray(plan.errors)?plan.errors:[],
      warnings:Array.isArray(plan.warnings)?plan.warnings:[],
      messages:Array.isArray(plan.messages)?plan.messages:[],
      violations:Array.isArray(plan.violations)?plan.violations:[],
      conflicts:Array.isArray(plan.conflicts)?plan.conflicts:[],
      order_sequence:Array.isArray(plan.order_sequence)?plan.order_sequence:[],
      operations,
      generic_operations:generic,
      batches
    };
  };
  const owned = (plan,model) => {
    plan=publicPlan(plan);
    return !!plan&&Array.isArray(plan.operations)&&plan.operations.length>0&&checkPlan(plan,model);
  };
  const compactResumePlan = plan => {
    if(!plan||typeof plan!=='object')return null;
    let sequence=Array.isArray(plan.order_sequence)?plan.order_sequence.filter(x=>x!=null):[];
    if(!sequence.length){
      const rows=(Array.isArray(plan.generic_operations)&&plan.generic_operations.length?plan.generic_operations:plan.operations)||[];
      const seen=new Set();
      sequence=[...rows]
        .filter(x=>x&&x.order!=null&&!x.is_setup&&String(x.phase||'').toLowerCase()!=='setup')
        .sort((a,b)=>Number(a.start_min||0)-Number(b.start_min||0)||Number(a.end_min||0)-Number(b.end_min||0))
        .map(x=>String(x.order))
        .filter(x=>{if(seen.has(x))return false;seen.add(x);return true});
    }
    if(!sequence.length)return null;
    return {order_sequence:sequence,duration_minutes:Number(plan.duration_minutes||0),
      optimization_run:Number(plan.optimization_run||0),total_generations:Number(plan.total_generations||0)};
  };
  async function currentJob(principal){
    const local=jobs.get(principal);
    if(local||!stateStore)return local||null;
    const saved=await stateStore.load(principal);
    if(!saved)return null;
    if(!/^[0-9a-f]{32}$/.test(String(saved.job_id||'')))throw Error('persisted_job_invalid');
    const restored={id:saved.job_id,modelKey:saved.model_hash,state:saved.status,began:now(),
      best:saved.best_preview||saved.result||null,candidate:null,progress:saved.progress||0,
      result:saved.result||null,resume_state:saved.resume_state||null,error:saved.error||null};
    jobs.set(principal,restored);
    return restored;
  }
  async function save(principal,state){
    if(stateStore)await stateStore.save(principal,state);
  }
  async function cancel(req){
    let principal;
    try{principal=await account(req)}catch{return {error:'worker_cancel_failed'}}
    let job;
    try{job=await currentJob(principal)}catch{return {error:'worker_cancel_failed'}}
    if(!job||!['queued','running'].includes(job.state))return null;
    // A failed cancellation must never be treated as successful.
    try{
      const r=await call(principal,'/internal/jobs/'+job.id+'/cancel','POST',{});
      if(r.status!==200||r.body.status!=='cancelled')return {error:'worker_cancel_failed'};
      job.state='cancelled';job.progress=Math.max(0,job.progress||0);
      await save(principal,job);
      return r.body;
    }catch{return {error:'worker_cancel_failed'}}
  }
  async function run(req,opts){
    let principal,model;
    try{principal=await account(req);model=await readAccountModel(req)}
    catch{return response({ok:false,error:'authentication_or_model_unavailable'},503)}
    if(!model||!Array.isArray(model.orders)||!model.orders.length)return response({ok:false,error:'account_model_not_ready'},409);
    let current;
    try{current=await currentJob(principal)}catch{return response({ok:false,error:'ga_state_unavailable'},503)}
    const modelKey=hashModel(model);
    let args;
    try{
      const bytes=opts?.body;
      const raw=bytes===undefined?'{}':typeof bytes==='string'?bytes:typeof ArrayBuffer!=='undefined'&&bytes instanceof ArrayBuffer?new TextDecoder().decode(bytes):JSON.stringify(bytes);
      if(raw.length>128000)return response({ok:false,error:'ga_options_too_large'},413);
      args=JSON.parse(raw);if(!args||typeof args!=='object'||Array.isArray(args))throw Error('invalid_args');
      for(const key of ['account','accountId','account_id','model','cookie'])delete args[key];
    }catch{return response({ok:false,error:'invalid_ga_options'},422)}
    const asyncStart=args.__pp_async_start===true;
    delete args.__pp_async_start;
    if(current&&['queued','running'].includes(current.state)){
      if(asyncStart&&current.modelKey===modelKey)
        return response({ok:true,started:true,joined:true,job_id:current.id,percent:current.progress||0,phase:current.state},202);
      return response({ok:false,error:'optimization_running_stop_first'},409);
    }
    const continuing=!!(args.continue||args.continue_run);
    if(continuing&&!args.resume_state&&!args.resume_plan&&current?.resume_state)
      args.resume_state=current.resume_state;
    if(continuing&&!args.resume_state&&!args.resume_plan){
      const seed=compactResumePlan(current?.best||current?.result);
      if(seed)args.resume_plan=seed;
    }
    let state;
    try{
      const r=await call(principal,'/internal/jobs','POST',{model,options:args});
      if(r.status!==202||!/^[0-9a-f]{32}$/.test(r.body.job_id||''))
        return response({ok:false,error:r.status===409?'optimization_running_stop_first':'ga_worker_unavailable'},r.status===409?409:503);
      state={id:r.body.job_id,modelKey,state:'queued',began:now(),best:null,candidate:null,progress:0,result:null,resume_state:null,error:null};
      jobs.set(principal,state);
      try{await save(principal,state)}catch{
       try{await call(principal,'/internal/jobs/'+state.id+'/cancel','POST',{})}catch{}
       state.state='failed';return response({ok:false,error:'ga_state_unavailable'},503);
      }
    }catch{return response({ok:false,error:'ga_worker_unavailable'},503)}
    if(asyncStart)return response({ok:true,started:true,job_id:state.id,percent:0,phase:'queued'},202);
    const abort=()=>{if(state.state!=='cancelled')void cancel(req)};
    if(opts?.signal)opts.signal.addEventListener('abort',abort,{once:true});
    try{
      while(now()-state.began<maxWaitMs){
        if(opts?.signal?.aborted||state.state==='cancelled')throw Error('ga_upstream_aborted');
        const r=await call(principal,'/internal/jobs/'+state.id);
        if(r.status!==200)throw Error('ga_worker_status_unavailable');
        const data=r.body;
        if(data.best_preview){const live=publicPlan(data.best_preview);if(owned(live,model))state.best=live;}
        if(data.candidate_preview){const liveCandidate=publicPlan(data.candidate_preview);if(owned(liveCandidate,model))state.candidate=liveCandidate;}
        state.state=data.status;state.progress=Math.max(0,Math.min(100,Number(data.progress)||0));
        if(stateStore&&data.status!=='completed')await save(principal,state);
        if(data.status==='completed'){
          const fresh=await readAccountModel(req);
          if(hashModel(fresh)!==modelKey){state.state='stale';return response({ok:false,error:'account_model_changed_during_run'},409)}
          if(!owned(data.result,fresh)){state.state='invalid';await save(principal,state);return response({ok:false,error:'account_plan_mismatch'},409)}
          state.result=data.result;state.best=data.result;state.progress=100;
          state.resume_state=data.result?.resume_state||null;
          await save(principal,state);
          return response({...data.result,ok:true});
        }
        if(data.status==='cancelled'){await save(principal,state);return response({ok:false,stopped:true,error:'optimization_stopped'});}
        if(['failed','timed_out'].includes(data.status)){
          state.error=typeof data.error==='string'?data.error:null;await save(principal,state);
          const continuationError=state.error&&state.error.startsWith('continuation_');
          return response({ok:false,error:continuationError?state.error:'ga_worker_'+data.status},continuationError?409:503);
        }
        if(!['queued','running'].includes(data.status))throw Error('ga_worker_invalid_status');
        await sleep(pollMs);
      }
      await cancel(req);
      return response({ok:false,error:'ga_worker_timeout'},504);
    }catch(e){
      await cancel(req);
      if(state.state==='cancelled'||opts?.signal?.aborted)throw Object.assign(new Error('ga_upstream_aborted'),{name:'AbortError'});
      state.state='failed';
      try{await save(principal,state)}catch{}
      return response({ok:false,error:'ga_worker_unavailable'},503);
    }finally{opts?.signal?.removeEventListener('abort',abort)}
  }
  async function progress(req){
    let principal,model;
    try{principal=await account(req);model=await readAccountModel(req)}
    catch{return response({ok:false,error:'authentication_or_model_unavailable'},503)}
    let state;
    try{state=await currentJob(principal)}catch{return response({ok:false,error:'ga_state_unavailable'},503)}
    if(!state)return response({ok:true,running:false,success:false,done:0,total:0,percent:0,phase:'idle',best_preview:null,candidate_preview:null});
    if(state.state==='completed'&&state.result){
      if(!owned(state.result,model))return response({ok:false,error:'account_plan_mismatch'},409);
      return response({ok:true,running:false,success:true,done:100,total:100,percent:100,phase:'completed',
        best_preview:state.result,candidate_preview:null,result:state.result,resume_state:state.resume_state||null,error:null});
    }
    if(['cancelled','failed','timed_out','interrupted','invalid','stale'].includes(state.state))return response({ok:true,running:false,success:false,done:state.progress||0,total:100,percent:state.progress||0,phase:state.state,best_preview:state.best,candidate_preview:state.candidate||null,result:null,error:state.error||null});
    if(hashModel(model)!==state.modelKey){await cancel(req);return response({ok:false,error:'account_model_changed_during_run'},409)}
    let status;
    try{const r=await call(principal,'/internal/jobs/'+state.id);
      if(r.status===404&&stateStore){state.state='interrupted';state.error='worker_restarted';await save(principal,state);return response({ok:false,error:'ga_worker_interrupted'},503)}
      if(r.status!==200)throw Error('worker_status_failed');status=r.body}
    catch{return response({ok:false,error:'ga_worker_unavailable'},503)}
    state.state=status.status;state.progress=Math.max(0,Math.min(100,Number(status.progress)||0));
    if(status.best_preview){
      const live=publicPlan(status.best_preview);
      if(!owned(live,model)){await cancel(req);return response({ok:false,error:'account_plan_mismatch'},409)}
      state.best=live;
    }
    if(status.candidate_preview){
      const liveCandidate=publicPlan(status.candidate_preview);
      if(!owned(liveCandidate,model)){await cancel(req);return response({ok:false,error:'account_plan_mismatch'},409)}
      state.candidate=liveCandidate;
    }
    if(status.status==='completed'){
      if(!owned(status.result,model))return response({ok:false,error:'account_plan_mismatch'},409);
      const finalPlan=publicPlan(status.result);
      state.best=finalPlan;state.result=finalPlan;state.resume_state=finalPlan?.resume_state||null;state.error=null;
    }else if(['failed','timed_out'].includes(status.status)){
      state.error=typeof status.error==='string'?status.error:null;
    }
    try{await save(principal,state)}catch{return response({ok:false,error:'ga_state_unavailable'},503)}
    const running=['queued','running'].includes(status.status),pct=Math.max(0,Math.min(100,Number(status.progress)||0));
    return response({ok:true,running,success:status.status==='completed',done:pct,total:100,
      percent:pct,phase:status.status,best_preview:state.best,candidate_preview:running?(state.candidate||null):null,
      result:status.status==='completed'?state.result:null,resume_state:status.status==='completed'?(state.resume_state||null):null,
      error:state.error||null});
  }
  async function fetchUpstream(req,opts){
    if(!enabled)return fallback(req,opts);
    const path=new URL(req.url).pathname;
    if(path==='/api/plan'&&req.method==='POST')return run(req,opts);
    if(path==='/api/plan-progress'&&req.method==='GET')return progress(req);
    return fallback(req,opts);
  }
  return {fetch:fetchUpstream,cancel,status:()=>({enabled:true,trackedSessions:jobs.size})};
}