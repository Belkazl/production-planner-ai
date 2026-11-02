/**
 * Optional, internal-only Python GA upstream for the existing Bun plan bridge.
 * The Bun plan(req) remains authoritative for setup-aware scheduling, manual
 * locks, objective selection, account-model validation, and frontend format.
 * Never enable before a real legacy-GA black-box compatibility test passes.
 */
export function createPythonGAUpstream({
  enabled = false, origin, token, upstreamUrl,
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
    const principal=sessionKey(req);
    if(typeof principal!=='string'||principal.length<1||principal.length>256||!await verifyLogin(req))throw Error('account_not_authenticated');
    return principal;
  };
  const owned = (plan,model) => !!plan&&Array.isArray(plan.operations)&&plan.operations.length>0&&checkPlan(plan,model);
  async function cancel(req){
    let principal;
    try{principal=await account(req)}catch{return {error:'worker_cancel_failed'}}
    const job=jobs.get(principal);
    if(!job||!['queued','running'].includes(job.state))return null;
    // A failed cancellation must never be treated as successful.
    try{
      const r=await call(principal,'/internal/jobs/'+job.id+'/cancel','POST',{});
      if(r.status!==200||r.body.status!=='cancelled')return {error:'worker_cancel_failed'};
      job.state='cancelled';
      return r.body;
    }catch{return {error:'worker_cancel_failed'}}
  }
  async function run(req,opts){
    let principal,model;
    try{principal=await account(req);model=await readAccountModel(req)}
    catch{return response({ok:false,error:'authentication_or_model_unavailable'},503)}
    if(!model||!Array.isArray(model.orders)||!model.orders.length)return response({ok:false,error:'account_model_not_ready'},409);
    const current=jobs.get(principal);
    if(current&&['queued','running'].includes(current.state))return response({ok:false,error:'optimization_running_stop_first'},409);
    const modelKey=hashModel(model);
    let args;
    try{
      const bytes=opts?.body;
      const raw=bytes===undefined?'{}':typeof bytes==='string'?bytes:typeof ArrayBuffer!=='undefined'&&bytes instanceof ArrayBuffer?new TextDecoder().decode(bytes):JSON.stringify(bytes);
      if(raw.length>128000)return response({ok:false,error:'ga_options_too_large'},413);
      args=JSON.parse(raw);if(!args||typeof args!=='object'||Array.isArray(args))throw Error('invalid_args');
      for(const key of ['account','accountId','account_id','model','cookie'])delete args[key];
    }catch{return response({ok:false,error:'invalid_ga_options'},422)}
    let state;
    try{
      const r=await call(principal,'/internal/jobs','POST',{model,options:args});
      if(r.status!==202||!/^[0-9a-f]{32}$/.test(r.body.job_id||''))
        return response({ok:false,error:r.status===409?'optimization_running_stop_first':'ga_worker_unavailable'},r.status===409?409:503);
      state={id:r.body.job_id,modelKey,state:'queued',began:now(),best:null};
      jobs.set(principal,state);
    }catch{return response({ok:false,error:'ga_worker_unavailable'},503)}
    const abort=()=>{if(state.state!=='cancelled')void cancel(req)};
    if(opts?.signal)opts.signal.addEventListener('abort',abort,{once:true});
    try{
      while(now()-state.began<maxWaitMs){
        if(opts?.signal?.aborted||state.state==='cancelled')throw Error('ga_upstream_aborted');
        const r=await call(principal,'/internal/jobs/'+state.id);
        if(r.status!==200)throw Error('ga_worker_status_unavailable');
        const data=r.body;
        if(data.best_preview&&owned(data.best_preview,model))state.best=data.best_preview;
        state.state=data.status;
        if(data.status==='completed'){
          const fresh=await readAccountModel(req);
          if(hashModel(fresh)!==modelKey){state.state='stale';return response({ok:false,error:'account_model_changed_during_run'},409)}
          if(!owned(data.result,fresh)){state.state='invalid';return response({ok:false,error:'account_plan_mismatch'},409)}
          return response({...data.result,ok:true});
        }
        if(data.status==='cancelled')return response({ok:false,stopped:true,error:'optimization_stopped'});
        if(['failed','timed_out'].includes(data.status))return response({ok:false,error:'ga_worker_'+data.status},503);
        if(!['queued','running'].includes(data.status))throw Error('ga_worker_invalid_status');
        await sleep(pollMs);
      }
      await cancel(req);
      return response({ok:false,error:'ga_worker_timeout'},504);
    }catch(e){
      await cancel(req);
      if(state.state==='cancelled'||opts?.signal?.aborted)throw Object.assign(new Error('ga_upstream_aborted'),{name:'AbortError'});
      state.state='failed';
      return response({ok:false,error:'ga_worker_unavailable'},503);
    }finally{opts?.signal?.removeEventListener('abort',abort)}
  }
  async function progress(req){
    let principal,model;
    try{principal=await account(req);model=await readAccountModel(req)}
    catch{return response({ok:false,error:'authentication_or_model_unavailable'},503)}
    const state=jobs.get(principal);
    if(!state)return response({ok:true,running:false,success:false,done:0,total:0,percent:0,phase:'idle',best_preview:null,candidate_preview:null});
    if(hashModel(model)!==state.modelKey){await cancel(req);return response({ok:false,error:'account_model_changed_during_run'},409)}
    let status;
    try{const r=await call(principal,'/internal/jobs/'+state.id);if(r.status!==200)throw Error('worker_status_failed');status=r.body}
    catch{return response({ok:false,error:'ga_worker_unavailable'},503)}
    state.state=status.status;
    if(status.best_preview){
      if(!owned(status.best_preview,model)){await cancel(req);return response({ok:false,error:'account_plan_mismatch'},409)}
      state.best=status.best_preview;
    }
    if(status.status==='completed'){
      if(!owned(status.result,model))return response({ok:false,error:'account_plan_mismatch'},409);
      state.best=status.result;
    }
    const running=['queued','running'].includes(status.status),pct=Math.max(0,Math.min(100,Number(status.progress)||0));
    return response({ok:true,running,success:status.status==='completed',done:pct,total:100,
      percent:pct,phase:status.status,best_preview:state.best,candidate_preview:null});
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