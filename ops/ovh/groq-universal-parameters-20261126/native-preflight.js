  // AI edit validation uses a separate worker identity, never the user's
  // optimizer state, current job, incumbent, SSE stream or stateStore.
  let ppGroqValidationInFlight=false;
  async function ppGroqNativeValidate(req,model){
    if(ppGroqValidationInFlight)return {ok:false,error:"validation_busy"};
    ppGroqValidationInFlight=true;
    let principal,validationPrincipal,jobId,finished=false;
    try{
      principal=await account(req);
      const active=await currentJob(principal);
      if(active&&["queued","running"].includes(active.state))return {ok:false,error:"validation_busy"};
      if(!Array.isArray(model?.orders)||!model.orders.length||JSON.stringify(model).length>1800000)
        return {ok:false,error:"validation_model_not_ready"};
      const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode("liftorbit-edit-validation-v1:"+principal));
      validationPrincipal="edit-validation:"+Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,"0")).join("");
      const submitted=await call(validationPrincipal,"/internal/jobs","POST",{model,options:{generations:3,population:6,seed:1729,objective:"duration",continue:false}});
      if(submitted.status!==202||!/^[0-9a-f]{32}$/.test(submitted.body.job_id||""))
        return {ok:false,error:submitted.status===409?"validation_busy":"validation_unavailable"};
      jobId=submitted.body.job_id;
      const deadline=Date.now()+65000;
      while(Date.now()<deadline&&!req.signal?.aborted){
        const r=await call(validationPrincipal,"/internal/jobs/"+jobId);
        if(r.status!==200)return {ok:false,error:"validation_unavailable"};
        const data=r.body;
        if(data.status==="completed"){
          finished=true;
          const result=data.result,rows=result?.generic_operations?.length?result.generic_operations:result?.operations;
          const scheduled=new Set((Array.isArray(rows)?rows:[]).filter(o=>!o.is_setup).map(o=>String(o.order)));
          if(result?.valid===true&&result.partial!==true&&Array.isArray(rows)&&rows.length&&checkPlan(result,model)&&model.orders.every(o=>scheduled.has(String(o.id))))
            return {ok:true,valid:true,checkedOrders:model.orders.length,operations:rows.length};
          return {ok:false,error:"validation_no_feasible_plan"};
        }
        if(["failed","timed_out","cancelled","interrupted"].includes(data.status)){
          finished=true;
          return {ok:false,error:data.status==="timed_out"?"validation_timed_out":data.status==="failed"?"validation_no_feasible_plan":"validation_unavailable"};
        }
        if(!["queued","running"].includes(data.status))return {ok:false,error:"validation_unavailable"};
        await sleep(600);
      }
      return {ok:false,error:"validation_timed_out"};
    }catch{return {ok:false,error:"validation_unavailable"}}
    finally{
      if(jobId&&!finished)try{await call(validationPrincipal,"/internal/jobs/"+jobId+"/cancel","POST",{})}catch{}
      ppGroqValidationInFlight=false;
    }
  }
  if(enabled)globalThis.__ppGroqNativeValidate=ppGroqNativeValidate;

