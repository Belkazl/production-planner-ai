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
  // Only a checkpoint independently verified by this account's worker
  // can replace a rejected final result. Untrusted previews never qualify.
  const verifiedAccountBest = (state,model) => {
    const best=state?.best;
    if(!best||best._pp_verified_checkpoint_v1!==true||
       best.valid!==true||!Array.isArray(best.operations)||!best.operations.length||
       !best.resume_state||typeof best.resume_state!=="object"||
       !owned(best,model))return null;
    return best;
  };
  const restoreOwnedBest = (best,reason="unowned_native_final_rejected") => {
    const restored={...best,optimization_account_check_recovered:true,
      optimization_completed_early:true,
      optimization_termination_reason:reason};
    delete restored._pp_verified_checkpoint_v1;
    return restored;
  };
  // Worker may emit a setup-aware Best found while its terminal result
  // unexpectedly contains only the unprocessed production operations.
  // The final can still be marked valid and account-owned, but it is NOT a
  // valid replacement for the complete earlier setup-aware schedule.
  const setupOperationsDropped = (final,best,model) => {
    if(!Array.isArray(model?.setup_rules)||!model.setup_rules.length||!final||!best)return false;
    const rows=p=>(Array.isArray(p.generic_operations)&&p.generic_operations.length)
      ?p.generic_operations:(Array.isArray(p.operations)?p.operations:[]);
    const isSetup=x=>x?.is_setup===true||String(x?.phase||"").toLowerCase()==="setup"||
      String(x?.type||"").toLowerCase()==="setup";
    const current=rows(final),earlier=rows(best);
    const before=earlier.filter(isSetup).length,after=current.filter(isSetup).length;
    // Identical production workload plus all previously verified setup tasks
    // missing is a structural regression, not an optimization improvement.
    return before>0&&after===0&&
      earlier.length-before===current.length-after;
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
  // Continuation is an ordering hint, never a trusted finished schedule.
  // The Python worker always re-runs the scheduler with today's account model,
  // staff shifts, materials, setup rules and manual locks.
  const normalizedContinuationSeed=(source,model,trustedScore=false) => {
    if(!source||typeof source!=='object'||Array.isArray(source))return null;
    const ids=(model?.orders||[]).map(x=>String(x.id));
    if(!ids.length||ids.length>10000||new Set(ids).size!==ids.length)return null;
    const allowed=new Set(ids),seen=new Set();
    let sequence=Array.isArray(source.order_sequence)?source.order_sequence:[];
    if(!sequence.length){
      const derived=compactResumePlan(source);
      sequence=derived?.order_sequence||[];
    }
    if(!sequence.length||sequence.length>50000)return null;
    const ordered=[];
    for(const raw of sequence){
      if(raw===null||raw===undefined)continue;
      const id=String(raw);
      if(allowed.has(id)&&!seen.has(id)){seen.add(id);ordered.push(id)}
    }
    if(!ordered.length)return null;
    const exact=ordered.length===ids.length;
    for(const id of ids)if(!seen.has(id))ordered.push(id);
    const duration=trustedScore&&exact
      ?Number(source.duration_minutes??source.best_duration_minutes):NaN;
    // Never use an arbitrary client/stale score to bound the new GA search.
    const score=Number.isFinite(duration)&&duration>=0?duration:1000000000;
    const runs=Number(source.optimization_run??source.completed_runs);
    const trials=Number(source.total_generations??source.total_trials);
    return {order_sequence:ordered,duration_minutes:score,
      optimization_run:Number.isInteger(runs)&&runs>=1&&runs<=1000000?runs:1,
      total_generations:Number.isInteger(trials)&&trials>=0&&trials<=100000000?trials:0};
  };
  // Only worker-supplied, account-owned, fully valid previews can become
  // server-verified checkpoints. The worker response is fetched through the
  // private account-scoped API; client resume plans can NEVER call this path.
  // This evidence is retained across progress polls / worker finalization.
  const verifiedWorkerCheckpoint = (raw,model) => {
    const plan=publicPlan(raw);
    if(!plan||plan.valid!==true||plan.partial===true||
       !Array.isArray(plan.operations)||!plan.operations.length||
       !Number.isFinite(Number(plan.duration_minutes))||
       Number(plan.duration_minutes)<0||!owned(plan,model))return null;
    const ownOrders=new Set((model.orders||[]).map(x=>String(x.id)));
    const ownEq=new Set((model.equipment||model.autoclaves||[]).map(x=>String(x.id)));
    const ownEmp=new Set((model.employees||[]).map(x=>String(x.id)));
    const ownMat=new Set((model.materials||[]).map(x=>String(x.id)));
    if((plan.order_sequence||[]).some(x=>!ownOrders.has(String(x))))return null;
    const rows=plan.generic_operations?.length?plan.generic_operations:plan.operations;
    for(const row of rows){
      if(!row||row.order==null||!ownOrders.has(String(row.order)))return null;
      if((row.equipment_ids||[]).some(id=>!ownEq.has(String(id))))return null;
      if((row.employee_ids||[]).some(id=>!ownEmp.has(String(id))))return null;
      if((row.material_ids||[]).some(id=>!ownMat.has(String(id))))return null;
    }
    for(const batch of plan.batches||[]){
      if(batch?.order!=null&&!ownOrders.has(String(batch.order)))return null;
      if((batch?.equipment_ids||[]).some(id=>!ownEq.has(String(id))))return null;
    }
    const seed=normalizedContinuationSeed(plan,model,false);
    if(!seed||!seed.order_sequence.length)return null;
    // This is a verified ordering hint, not an untrusted client-provided
    // Python runtime state. The worker will reconstruct a fresh schedule.
    const nativeState=plan.resume_state&&typeof plan.resume_state==="object"&&!Array.isArray(plan.resume_state)
      ?plan.resume_state:null;
    const saved={...plan,_pp_verified_checkpoint_v1:true,
      resume_state:nativeState||{version:0,order_sequence:seed.order_sequence}};
    return saved;
  };
  const rememberWorkerBest = (raw,model,state) => {
    const checked=verifiedWorkerCheckpoint(raw,model);
    if(checked){state.best=checked;return true}
    // Backwards compatibility: show an incomplete-but-owned progress preview,
    // but never promote it to a verified terminal fallback.
    const ordinary=publicPlan(raw);
    if(owned(ordinary,model)){
      if(state.best?._pp_verified_checkpoint_v1!==true)state.best=ordinary;
      return true;
    }
    return false;
  };
  const publicCheckpoint = plan => {
    if(!plan)return null;
    const copy={...plan};
    delete copy._pp_verified_checkpoint_v1;
    return copy;
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
    if(continuing){
      // The previous implementation trusted resume_state from the browser or
      // account persistence without checking its schema. Python then aborted
      // with continuation_state_missing_or_invalid. Prefer an already owned
      // completed result or independently verified same-account best.
      const sameModel=current?.modelKey===modelKey;
      const ownedResult=sameModel&&current?.result&&current.result.valid===true&&
        owned(current.result,model)?current.result:null;
      const verifiedBest=!ownedResult&&sameModel?verifiedAccountBest(current,model):null;
      const clientPlan=args.resume_plan;
      const clientState=args.resume_state;
      let seed=normalizedContinuationSeed(ownedResult||verifiedBest,model,true);
      let source=seed?"owned_plan":null;
      if(!seed&&sameModel&&current?.resume_state){
        seed=normalizedContinuationSeed(current.resume_state,model,false);
        if(seed)source="stored_order_seed";
      }
      if(!seed&&clientPlan){
        seed=normalizedContinuationSeed(clientPlan,model,false);
        if(seed)source="client_order_hint";
      }
      if(!seed&&clientState){
        seed=normalizedContinuationSeed(clientState,model,false);
        if(seed)source="client_state_order_hint";
      }
      delete args.resume_state;
      delete args.resume_plan;
      if(!seed)return response({ok:false,error:'continuation_seed_missing_or_invalid'},409);
      // Keep continue=true. The worker reconstructs and validates the plan;
      // this is NOT a silent fresh optimization or accepted client schedule.
      args.resume_plan=seed;
      console.warn("PP_GA_RESUME_SAFE_ORDER_SEED",source);
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
        if(data.best_preview)rememberWorkerBest(data.best_preview,model,state);
        if(data.candidate_preview){const liveCandidate=publicPlan(data.candidate_preview);if(owned(liveCandidate,model))state.candidate=liveCandidate;}
        state.state=data.status;state.progress=Math.max(0,Math.min(100,Number(data.progress)||0));
        if(stateStore&&data.status!=='completed')await save(principal,state);
        if(data.status==='completed'){
          const fresh=await readAccountModel(req);
          if(hashModel(fresh)!==modelKey){state.state='stale';return response({ok:false,error:'account_model_changed_during_run'},409)}
          let selected=data.result;
          const finalOwned=owned(selected,fresh);
          const verified=!finalOwned||(fresh.setup_rules||[]).length
            ?verifiedAccountBest(state,fresh):null;
          if(!finalOwned){
            if(!verified){state.state='invalid';await save(principal,state);return response({ok:false,error:'account_plan_mismatch'},409)}
            console.warn("PP_GA_SYNC_UNOWNED_FINAL_REPLACED_BY_VERIFIED_OWNED_BEST");
            selected=restoreOwnedBest(verified);
          }else if(verified&&setupOperationsDropped(selected,verified,fresh)){
            console.warn("PP_GA_SYNC_FINAL_SETUP_LOSS_REPLACED_BY_VERIFIED_BEST");
            selected=restoreOwnedBest(verified,"final_dropped_setup_operations");
          }
          state.result=publicPlan(selected);state.best=state.result;state.progress=100;
          state.resume_state=state.result?.resume_state||null;
          await save(principal,state);
          return response({...state.result,ok:true});
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
    // A completed job belongs to the exact version of this account's model.
    // Changing equipment, shifts, materials or orders makes its result stale,
    // NOT an unowned/foreign schedule. Do not expose outdated previews as
    // current after a model change, even when the order IDs still happen to fit.
    if(state.modelKey!==hashModel(model)){
      if(['queued','running'].includes(state.state)){
        await cancel(req);
        return response({ok:false,error:'account_model_changed_during_run'},409);
      }
      state.state='stale';
      state.error='account_model_changed_since_run';
      try{
        await save(principal,state);
      }catch{return response({ok:false,error:'ga_state_unavailable'},503)}
      console.warn('PP_GA_OWN_MODEL_VERSION_STALE_TERMINAL');
      return response({ok:true,running:false,success:false,done:0,total:100,percent:0,
        phase:'stale',best_preview:null,candidate_preview:null,result:null,
        resume_state:null,error:'account_model_changed_since_run'});
    }
    if(state.state==='completed'&&state.result){
      if(!owned(state.result,model))return response({ok:false,error:'account_plan_mismatch'},409);
      return response({ok:true,running:false,success:true,done:100,total:100,percent:100,phase:'completed',
        best_preview:state.result,candidate_preview:null,result:state.result,resume_state:state.resume_state||null,error:null});
    }
    if(['cancelled','failed','timed_out','interrupted','invalid','stale'].includes(state.state))return response({ok:true,running:false,success:false,done:state.progress||0,total:100,percent:state.progress||0,phase:state.state,best_preview:publicCheckpoint(state.best),candidate_preview:state.candidate||null,result:null,error:state.error||null});
    let status;
    try{const r=await call(principal,'/internal/jobs/'+state.id);
      if(r.status===404&&stateStore){state.state='interrupted';state.error='worker_restarted';await save(principal,state);return response({ok:false,error:'ga_worker_interrupted'},503)}
      if(r.status!==200)throw Error('worker_status_failed');status=r.body}
    catch{return response({ok:false,error:'ga_worker_unavailable'},503)}
    state.state=status.status;state.progress=Math.max(0,Math.min(100,Number(status.progress)||0));
    if(status.best_preview){
      if(!rememberWorkerBest(status.best_preview,model,state))
        console.warn("PP_GA_UNOWNED_BEST_PREVIEW_DISCARDED");
    }
    if(status.candidate_preview){
      const liveCandidate=publicPlan(status.candidate_preview);
      if(owned(liveCandidate,model))state.candidate=liveCandidate;
      else{
        state.candidate=null;
        // A rejected tentative candidate cannot destroy the running GA.
        console.warn("PP_GA_UNOWNED_CANDIDATE_PREVIEW_DISCARDED");
      }
    }
    if(status.status==='completed'){
      let selected=status.result;
      const finalOwned=owned(selected,model);
      const verified=!finalOwned||(model.setup_rules||[]).length
        ?verifiedAccountBest(state,model):null;
      if(!finalOwned){
        if(!verified){
          state.state='invalid';state.error='account_plan_mismatch';
          await save(principal,state);
          return response({ok:false,error:'account_plan_mismatch'},409);
        }
        console.warn("PP_GA_UNOWNED_FINAL_REPLACED_BY_VERIFIED_OWNED_BEST");
        selected=restoreOwnedBest(verified);
      }else if(verified&&setupOperationsDropped(selected,verified,model)){
        console.warn("PP_GA_FINAL_SETUP_LOSS_REPLACED_BY_VERIFIED_BEST");
        selected=restoreOwnedBest(verified,"final_dropped_setup_operations");
      }
      const finalPlan=publicPlan(selected);
      state.best=finalPlan;state.result=finalPlan;state.resume_state=finalPlan?.resume_state||null;state.error=null;
    }else if(['failed','timed_out'].includes(status.status)){
      state.error=typeof status.error==='string'?status.error:null;
    }
    try{await save(principal,state)}catch{return response({ok:false,error:'ga_state_unavailable'},503)}
    const running=['queued','running'].includes(status.status),pct=Math.max(0,Math.min(100,Number(status.progress)||0));
    return response({ok:true,running,success:status.status==='completed',done:pct,total:100,
      percent:pct,phase:status.status,best_preview:publicCheckpoint(state.best),candidate_preview:running?(state.candidate||null):null,
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