(function(){
 if(window.__PP_ASYNC_PLAN_TRANSPORT__)return;
 window.__PP_ASYNC_PLAN_TRANSPORT__=true;
 const nativeFetch=window.fetch.bind(window);
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const jsonResponse=(data,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
 });
 const pathOf=input=>{
  try{
   const raw=typeof input==="string"?input:(input&&input.url)||"";
   return new URL(raw,location.href).pathname;
  }catch{return ""}
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
 async function waitForPlan(signal){
  const deadline=Date.now()+15*60*1000;
  let transient=0;
  while(Date.now()<deadline){
   if(signal?.aborted)throw new DOMException("The operation was aborted.","AbortError");
   await sleep(1400);
   let r,data;
   try{
    r=await nativeFetch("/api/plan-progress",{method:"GET",cache:"no-store",credentials:"same-origin",
      headers:{accept:"application/json"}});
    const text=await r.text();
    try{data=JSON.parse(text)}catch{
     transient++;
     if(transient<5)continue;
     return jsonResponse({ok:false,error:"ga_progress_invalid_json"},502);
    }
   }catch(err){
    if(signal?.aborted)throw err;
    transient++;
    if(transient<5)continue;
    return jsonResponse({ok:false,error:"ga_progress_unavailable"},503);
   }
   if(!r.ok){
    transient++;
    if(transient<5&&r.status>=500)continue;
    return jsonResponse(data||{ok:false,error:"ga_progress_failed"},r.status);
   }
   transient=0;
   if(data?.running)continue;
   if(data?.success&&data?.result)return jsonResponse({...data.result,ok:true},200);
   if(data?.phase==="cancelled"||data?.error==="optimization_stopped")
    return jsonResponse({ok:false,stopped:true,error:"optimization_stopped",best_preview:data?.best_preview||null},200);
   const status=String(data?.error||"").startsWith("continuation_")?409:503;
   return jsonResponse({ok:false,error:data?.error||("ga_"+String(data?.phase||"failed"))},status);
  }
  return jsonResponse({ok:false,error:"ga_client_wait_timeout"},504);
 }
 window.fetch=async function(input,init){
  if(pathOf(input)!=="/api/plan"||methodOf(input,init)!=="POST")
   return nativeFetch(input,init);
  let payload;
  try{
   const raw=await originalBody(input,init);
   payload=raw?JSON.parse(raw):{};
   if(!payload||typeof payload!=="object"||Array.isArray(payload))throw Error("invalid");
  }catch{
   return nativeFetch(input,init);
  }
  if(payload.__pp_async_start===true)return nativeFetch(input,init);
  payload.__pp_async_start=true;
  const headers=new Headers(init?.headers||(input instanceof Request?input.headers:undefined));
  headers.set("content-type","application/json");
  headers.set("accept","application/json");
  const start=await nativeFetch(typeof input==="string"?input:input.url,{
   ...(init||{}),method:"POST",headers,body:JSON.stringify(payload),credentials:init?.credentials||"same-origin"
  });
  if(start.status!==202)return start;
  let started;
  try{started=await start.clone().json()}catch{return jsonResponse({ok:false,error:"ga_start_invalid_json"},502)}
  if(!started?.ok||!started?.started)return jsonResponse(started||{ok:false,error:"ga_start_failed"},503);
  window.dispatchEvent(new CustomEvent("pp:ga-async-started",{detail:{job_id:started.job_id||null}}));
  return waitForPlan(init?.signal||(input instanceof Request?input.signal:null));
 };
})();