import {readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";

const MARKER="pp_first_candidate_preview_v1";
const once=(source,before,after,label)=>{
  if(source.split(before).length!==2)throw Error("FIRST_PREVIEW_SOURCE_DRIFT_"+label);
  return source.replace(before,after);
};
function functionSpan(source,name){
  const anchor="  async function "+name+"(req){";
  if(source.split(anchor).length!==2)throw Error("FIRST_PREVIEW_FUNCTION_DRIFT_"+name);
  const start=source.indexOf(anchor),end=source.indexOf("\n  }\n",start)+5;
  if(end<=start)throw Error("FIRST_PREVIEW_FUNCTION_END_"+name);
  const body=source.slice(start,end);
  // Parse this function without invoking it or evaluating runtime imports.
  new Function("return ("+body.trim()+");");
  return {start,end,body};
}
function changeFunction(source,name,edit){
  const {start,end,body}=functionSpan(source,name);
  const updated=edit(body);
  new Function("return ("+updated.trim()+");");
  return source.slice(0,start)+updated+source.slice(end);
}

const progressHeader=String.raw`  async function progress(req, expectedJob=null){
    // pp_first_candidate_preview_v1: identity comes only from this account's job.
    let progressJobId=null,progressPrincipal=null,progressScope=null;
    const requestedId=new URL(req.url).searchParams.get('job_id');
    const progressStillCurrent=async()=>{
      if(!progressScope)return true;
      const activeModel=await readAccountModel(req);
      const active=await currentJob(progressPrincipal);
      return active?.id===progressScope.id&&active?.modelKey===progressScope.modelKey&&
        hashModel(activeModel)===progressScope.modelKey;
    };
    const progressResponse=async(body,status=200)=>{
      if(progressScope){
        try{
          if(!await progressStillCurrent())
            return response({ok:false,error:'job_mismatch'},409);
        }catch{return response({ok:false,error:'ga_state_unavailable'},503)}
      }
      return response(progressJobId?{...body,job_id:progressJobId}:body,status);
    };`;
const progressBinding=String.raw`    if(requestedId!==null&&!/^[0-9a-f]{32}$/.test(requestedId))
      return response({ok:false,error:'invalid_job_id'},400);
    if(requestedId!==null&&state?.id!==requestedId)
      return response({ok:false,error:'job_mismatch'},409);
    if(expectedJob&&(!state||state.id!==expectedJob.id||
       state.modelKey!==expectedJob.modelKey||hashModel(model)!==expectedJob.modelKey))
      return response({ok:false,error:'job_mismatch'},409);
    progressPrincipal=principal;
    progressJobId=state?.id||null;
    progressScope=expectedJob||(requestedId!==null?{id:state.id,modelKey:state.modelKey}:null);
`;
const cancelBinding=String.raw`    // pp_first_candidate_preview_v1: a delayed Stop must not cancel a newer job.
    const requestedId=new URL(req.url).searchParams.get('job_id');
    if(requestedId!==null){
      if(!/^[0-9a-f]{32}$/.test(requestedId))
        return {error:'invalid_job_id',http_status:400};
      if(!job||job.id!==requestedId)return {error:'job_mismatch',http_status:409};
      try{
        const model=await readAccountModel(req);
        const active=await currentJob(principal);
        if(active?.id!==job.id||active?.modelKey!==job.modelKey)
          return {error:'job_mismatch',http_status:409};
        if(hashModel(model)!==job.modelKey)
          return {error:'account_model_changed_since_run',http_status:409,job_id:job.id};
      }catch{return {error:'worker_cancel_failed'}}
      if(!['queued','running'].includes(job.state))
        return {error:'optimization_not_running',http_status:409,job_id:job.id,phase:job.state};
    }
`;

const STOP_CHOICES_MARKER="pp_scoped_stop_verified_choices_v2";
const oldStopTail=String.raw`      if(requestedId!==null){
        const active=await currentJob(principal);
        if(active?.id!==job.id)return {error:'job_mismatch',http_status:409};
      }
      await save(principal,job);
      return requestedId!==null ? {ok:true,stopped:true,job_id:job.id,phase:'cancelled',running:false} : r.body;`;
const newStopTail=String.raw`      // pp_scoped_stop_verified_choices_v2: preserve the native chooser's
      // complete verified options without exposing worker/resume internals.
      if(requestedId===null){await save(principal,job);return r.body;}
      const stoppedModel=await readAccountModel(req);
      const active=await currentJob(principal);
      if(active?.id!==job.id||active?.modelKey!==job.modelKey)
        return {error:'job_mismatch',http_status:409};
      if(hashModel(stoppedModel)!==job.modelKey)
        return {error:'account_model_changed_since_run',http_status:409,job_id:job.id};
      const checkedChoice=raw=>{
        if(!raw||raw._pp_verified_checkpoint_v1!==true||raw.valid!==true||raw.partial===true)
          return null;
        return verifiedWorkerCheckpoint(raw,stoppedModel);
      };
      const publicChoice=plan=>{
        if(!plan)return null;
        const keys=['ok','valid','partial','operations','generic_operations','batches',
          'setup_operations','setup_operation_count','start','finish','duration_minutes',
          'operator_wait_minutes','machine_idle_minutes','batch_count','order_sequence',
          'validation_errors','errors','warnings','messages','violations','conflicts'];
        return Object.fromEntries(keys.filter(key=>Object.hasOwn(plan,key)).map(key=>[key,plan[key]]));
      };
      const stoppedBest=checkedChoice(r.body.best_preview)||checkedChoice(job.best);
      const stoppedVariants=[];
      for(const row of (Array.isArray(r.body.variants)?r.body.variants:[]).slice(0,30)){
        const checked=checkedChoice(row?.plan||row);
        if(checked)stoppedVariants.push({plan:publicChoice(checked)});
      }
      if(stoppedBest)job.best=stoppedBest;
      await save(principal,job);
      const publishModel=await readAccountModel(req);
      const publishJob=await currentJob(principal);
      if(publishJob?.id!==job.id||publishJob?.modelKey!==job.modelKey)
        return {error:'job_mismatch',http_status:409};
      if(hashModel(publishModel)!==job.modelKey)
        return {error:'account_model_changed_since_run',http_status:409,job_id:job.id};
      return {ok:true,stopped:true,job_id:job.id,phase:'cancelled',running:false,
        best_preview:publicChoice(stoppedBest),variants:stoppedVariants};`;
function upgradeStopChoices(source){
  if(!source.includes("const verifiedWorkerCheckpoint = (raw,model) =>"))
    throw Error("FIRST_PREVIEW_VERIFIED_CHECKPOINT_GUARD_MISSING");
  if(source.includes(STOP_CHOICES_MARKER)){
    if(source.split(newStopTail).length!==2||source.includes(oldStopTail))
      throw Error("FIRST_PREVIEW_STOP_CHOICES_INSTALLED_DRIFT");
    return source;
  }
  return changeFunction(source,"cancel",body=>once(body,oldStopTail,newStopTail,"stop_choices_v1_upgrade"));
}

export function patchUpstream(source){
  if(source.includes(MARKER)){
    for(const marker of ["async function progress(req, expectedJob=null)",
      "firstPreviewPending", "await progress(req,job)",
      "const requestedId=new URL(req.url).searchParams.get('job_id');"])
      if(!source.includes(marker))throw Error("FIRST_PREVIEW_PARTIAL_INSTALL");
    return upgradeStopChoices(source);
  }
  for(const marker of ["account(req)","readAccountModel(req)","account_plan_mismatch",
    "state.modelKey!==hashModel(model)","const boundedPreview = (plan,model)",
    "async function stream(req)","candidate._pp_preview_origin=source;"])
    if(!source.includes(marker))throw Error("FIRST_PREVIEW_REQUIRED_GUARD_"+marker);
  source=changeFunction(source,"progress",body=>{
    // Every public branch uses the same account-derived identity, including
    // already completed/cancelled jobs; client query values are never copied.
    body=body.replaceAll("return response(","return progressResponse(");
    body=once(body,"  async function progress(req){",progressHeader,"progress_header");
    const anchor="    if(!state)return progressResponse(";
    body=once(body,anchor,progressBinding+anchor,"progress_binding");
    body=once(body,"    state.state=status.status;state.progress=",
      "    try{if(!await progressStillCurrent())return response({ok:false,error:'job_mismatch'},409)}\n"+
      "    catch{return response({ok:false,error:'ga_state_unavailable'},503)}\n"+
      "    state.state=status.status;state.progress=","progress_prevent_stale_persist");
    return body;
  });
  source=changeFunction(source,"cancel",body=>{
    const anchor="    if(!job||!['queued','running'].includes(job.state))return null;";
    body=once(body,anchor,cancelBinding+anchor,"cancel_binding");
    body=once(body,
      "      if(r.status!==200||r.body.status!=='cancelled')return {error:'worker_cancel_failed'};",
      String.raw`      if(requestedId!==null&&r.status===200&&r.body.job_id===job.id&&
         ['completed','failed','timed_out'].includes(r.body.status))
        return {error:'optimization_not_running',http_status:409,job_id:job.id,phase:r.body.status};
      if(r.status!==200||r.body.status!=='cancelled'||
         (requestedId!==null&&r.body.job_id!==job.id))return {error:'worker_cancel_failed'};`,
      "cancel_result");
    body=once(body,"      await save(principal,job);",
      String.raw`      if(requestedId!==null){
        const active=await currentJob(principal);
        if(active?.id!==job.id)return {error:'job_mismatch',http_status:409};
      }
      await save(principal,job);`,"cancel_persist");
    body=once(body,"      return r.body;",
      "      return requestedId!==null ? {ok:true,stopped:true,job_id:job.id,phase:'cancelled',running:false} : r.body;",
      "cancel_public_metadata");
    return body;
  });
  source=changeFunction(source,"stream",body=>{
    if(body.split("previewTimer=setInterval(()=>{void sendPreview()},4000);").length!==2)
      throw Error("FIRST_PREVIEW_SOURCE_DRIFT_four_second_timer");
    body=once(body,
      '    let lastPreviewHash="",lastPercent=-1,lastPhase="",lastSeq=-1;',
      '    let lastPreviewHash="",lastPercent=-1,lastPhase="",lastSeq=-1;\n    let firstPreviewPending=false;',
      "stream_first_preview_state");
    if(body.split("await progress(req)").length!==4)
      throw Error("FIRST_PREVIEW_SOURCE_DRIFT_stream_progress_calls");
    body=body.replaceAll("await progress(req)","await progress(req,job)");
    body=once(body,"            if(closed||!data?.running)return;",
      "            if(closed||!working||!data?.running||data.job_id!==job.id)return;",
      "preview_job_identity");
    body=once(body,"          previewBusy=true;",
      "          previewBusy=true;\n          firstPreviewPending=false;","preview_begin");
    body=once(body,"          }catch(_){}finally{previewBusy=false}",
      String.raw`          }catch(_){}finally{
            previewBusy=false;
            // A real worker update can arrive while the initial status read
            // is in flight. Preserve that signal without concurrent reads.
            if(firstPreviewPending&&!lastPreviewHash&&!closed&&working){
              firstPreviewPending=false;
              void sendPreview();
            }
          }`,"preview_retry_real_signal");
    body=once(body,
      '                emit("preview",{job_id:job.id,plan:candidate});',
      String.raw`                emit("preview",{job_id:job.id,plan:candidate});
                // The first real candidate is immediate. Later candidates
                // retain a four-second cadence from this successful emission.
                if(previewTimer)clearInterval(previewTimer);
                previewTimer=setInterval(()=>{void sendPreview()},4000);`,
      "preview_cadence");
    body=once(body,
      '            emit("progress",{job_id:job.id,percent:Math.min(99,job.progress||0),',
      '            void sendPreview();\n            emit("progress",{job_id:job.id,percent:Math.min(99,job.progress||0),',
      "preview_initial");
    body=once(body,'                  working=true;\n                  if(pct!==lastPercent||phase!==lastPhase){',
      String.raw`                  working=true;
                  if(!lastPreviewHash){
                    firstPreviewPending=true;
                    void sendPreview();
                  }
                  if(pct!==lastPercent||phase!==lastPhase){`,
      "preview_first_worker_change");
    return body;
  });
  return upgradeStopChoices(source);
}

export function patchBuild(source){
  const installed="pp_first_candidate_preview_v1_stop_route";
  if(source.includes(installed)){
    if(!source.includes("workerStop?.stopped===true")||!source.includes("workerStop.http_status"))
      throw Error("FIRST_PREVIEW_PARTIAL_BUILD_INSTALL");
    return source;
  }
  const old=" if(workerStop?.error==='worker_cancel_failed')return jsonifyBridge({ok:false,error:'worker_cancel_failed'},503);";
  const replacement=String.raw` // pp_first_candidate_preview_v1_stop_route: scoped native Stop cannot fall
 // through to a legacy run after a mismatch or a verified worker cancellation.
 if(new URL(req.url).searchParams.has('job_id')){
   if(workerStop?.error)return jsonifyBridge({ok:false,error:workerStop.error,
     ...(workerStop.job_id?{job_id:workerStop.job_id}:{}),
     ...(workerStop.phase?{phase:workerStop.phase}:{})},workerStop.http_status||503);
   if(workerStop?.ok===true&&workerStop?.stopped===true&&
      /^[0-9a-f]{32}$/.test(String(workerStop.job_id||'')))return jsonifyBridge(workerStop);
   return jsonifyBridge({ok:false,error:'worker_cancel_failed'},503);
 }
`+old;
  return once(source,old,replacement,"stop_build_route");
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=process.argv[2];
  if(!root)throw Error("FIRST_PREVIEW_APP_ROOT_REQUIRED");
  const files=[
    ["python-ga-upstream.mjs",patchUpstream],
    ["python-ga-upstream-build.ts",patchBuild]
  ].map(([name,patch])=>{
    const path=resolve(root,name),old=readFileSync(path,"utf8"),updated=patch(old);
    return {name,path,old,updated};
  });
  // Validate both exact source contracts before writing either staged file.
  for(const file of files){
    if(file.old!==file.updated)writeFileSync(file.path,file.updated);
    console.log("FIRST_CANDIDATE_PREVIEW_PATCHED",file.name,
      createHash("sha256").update(file.updated).digest("hex"));
  }
}
