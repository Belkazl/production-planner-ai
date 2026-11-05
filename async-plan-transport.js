(function(){
 if(window.__PP_ASYNC_PLAN_TRANSPORT__)return;
 window.__PP_ASYNC_PLAN_TRANSPORT__=true;
 const nativeFetch=window.fetch.bind(window);
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 let activePlanPromise=null;
 const jsonResponse=(data,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
 });
 const pathOf=input=>{
  try{const raw=typeof input==="string"?input:(input&&input.url)||"";return new URL(raw,location.href).pathname}catch{return ""}
 };
 const methodOf=(input,init)=>String(init?.method||(input instanceof Request?input.method:"GET")||"GET").toUpperCase();
 async function originalBody(input,init){
  if(init&&init.body!==undefined){
   if(typeof init.body==="string")return init.body;
   if(init.body instanceof URLSearchParams)return init.body.toString();
   return String(init.body);
  }
  if(input instanceof Request)return await input.clone().text();
  return "";
 }
 async function progressOnce(){
  const r=await nativeFetch("/api/plan-progress",{method:"GET",cache:"no-store",credentials:"same-origin",
    headers:{accept:"application/json"}});
  const text=await r.text();
  let data=null;try{data=JSON.parse(text)}catch{}
  return {r,data};
 }
 async function waitForPlan(signal){
  const deadline=Date.now()+15*60*1000;let transient=0;
  while(Date.now()<deadline){
   if(signal?.aborted)throw new DOMException("The operation was aborted.","AbortError");
   await sleep(1200);
   let out;
   try{out=await progressOnce()}catch(err){
    if(signal?.aborted)throw err;if(++transient<5)continue;
    return {status:503,data:{ok:false,error:"ga_progress_unavailable"}};
   }
   const {r,data}=out;
   if(!data){
    if(++transient<5)continue;
    return {status:502,data:{ok:false,error:"ga_progress_invalid_json"}};
   }
   if(!r.ok){
    if(++transient<5&&r.status>=500)continue;
    return {status:r.status,data:data||{ok:false,error:"ga_progress_failed"}};
   }
   transient=0;
   if(data.running)continue;
   if(data.success&&data.result)return {status:200,data:{...data.result,ok:true}};
   if(data.phase==="cancelled"||data.error==="optimization_stopped")
    return {status:200,data:{ok:false,stopped:true,error:"optimization_stopped",best_preview:data.best_preview||null}};
   const status=String(data.error||"").startsWith("continuation_")?409:503;
   return {status,data:{ok:false,error:data.error||("ga_"+String(data.phase||"failed"))}};
  }
  return {status:504,data:{ok:false,error:"ga_client_wait_timeout"}};
 }
 async function joinOrStart(input,init,payload){
  // A page reload or a duplicate UI wrapper may call POST again while the same
  // account already has a live job. Join it instead of creating a second job.
  try{
   const cur=await progressOnce();
   if(cur.r.ok&&cur.data?.running)
    return waitForPlan(init?.signal||(input instanceof Request?input.signal:null));
  }catch{}
  payload.__pp_async_start=true;
  const headers=new Headers(init?.headers||(input instanceof Request?input.headers:undefined));
  headers.set("content-type","application/json");headers.set("accept","application/json");
  const start=await nativeFetch(typeof input==="string"?input:input.url,{
   ...(init||{}),method:"POST",headers,body:JSON.stringify(payload),credentials:init?.credentials||"same-origin"
  });
  if(start.status===409){
   // Race: another wrapper/tab started the job between the progress check and
   // this POST. If a job is now running, join it.
   try{
    const cur=await progressOnce();
    if(cur.r.ok&&cur.data?.running)
     return waitForPlan(init?.signal||(input instanceof Request?input.signal:null));
   }catch{}
  }
  if(start.status!==202){
   const text=await start.text();let data;try{data=JSON.parse(text)}catch{data={ok:false,error:"ga_start_invalid_response"}}
   return {status:start.status,data};
  }
  let started;try{started=await start.json()}catch{return {status:502,data:{ok:false,error:"ga_start_invalid_json"}}}
  if(!started?.ok||!started?.started)return {status:503,data:started||{ok:false,error:"ga_start_failed"}};
  window.dispatchEvent(new CustomEvent("pp:ga-async-started",{detail:{job_id:started.job_id||null,joined:!!started.joined}}));
  return waitForPlan(init?.signal||(input instanceof Request?input.signal:null));
 }
 window.fetch=async function(input,init){
  if(pathOf(input)!=="/api/plan"||methodOf(input,init)!=="POST")return nativeFetch(input,init);
  let payload;
  try{
   const raw=await originalBody(input,init);payload=raw?JSON.parse(raw):{};
   if(!payload||typeof payload!=="object"||Array.isArray(payload))throw Error("invalid");
  }catch{return nativeFetch(input,init)}
  if(payload.__pp_async_start===true)return nativeFetch(input,init);
  if(!activePlanPromise){
   activePlanPromise=joinOrStart(input,init,payload).finally(()=>{activePlanPromise=null});
  }
  const out=await activePlanPromise;
  return jsonResponse(out.data,out.status);
 };
})();