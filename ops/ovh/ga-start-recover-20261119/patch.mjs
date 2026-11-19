import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
const dir=process.argv[2];if(!dir)throw Error("GA_START_PATCH_ROOT_REQUIRED");
const file=resolve(dir,"async-plan-transport.js"),source=readFileSync(file,"utf8");
const sha=createHash("sha256").update(source).digest("hex");
if(sha!=="b8f748eb60d6e3b9b86c2dfd3b24fca5460817245956d1fb53f502fe8de972ce")
 throw Error("GA_START_SOURCE_PIN_MISMATCH_"+sha);
const begin=" async function joinOrStart(input,init,payload){";
const end=" window.fetch=async function(input,init){";
if(source.split(begin).length!==2||source.split(end).length!==2)throw Error("GA_START_SOURCE_ANCHOR_DRIFT");
const left=source.indexOf(begin),right=source.indexOf(end);
if(right<=left)throw Error("GA_START_SOURCE_REGION_INVALID");
const replacement=String.raw`
 const startTelemetry={recoveries:0,retries:0,lastHttp:null,lastRecovery:null};
 window.__PP_ASYNC_PLAN_TRANSPORT_STATUS__={get state(){return {...startTelemetry}}};
 const retryableStatus=status=>status===0||status===408||status===425||status===429||(status>=500&&status<=599);
 const normalizeStartError=(status,data)=>{
  if(data&&typeof data==="object"&&data.ok===false&&typeof data.error==="string")return data;
  if(status===401||status===403)return {ok:false,error:"authentication_required"};
  if(status===413)return {ok:false,error:"ga_start_request_too_large"};
  if(status===429)return {ok:false,error:"ga_start_rate_limited"};
  return {ok:false,error:status>=500||status===0?
    "ga_start_server_temporarily_unavailable":"ga_start_http_"+String(status)};
 };
 async function joinOrStart(input,init,payload){
  // A network error or HTML proxy response does NOT tell us whether the POST
  // reached the server. Recheck this authenticated account before any replay.
  const signal=init?.signal||(input instanceof Request?input.signal:null);
  const abortIfStopped=()=>{if(signal?.aborted)throw new DOMException("The operation was aborted.","AbortError")};
  abortIfStopped();
  let prior=null;
  try{
   prior=await progressOnce();
   if(prior.r.ok&&prior.data?.running)return waitForPlan(signal);
  }catch(_){}
  const oldCompleted=prior?.r?.ok&&prior.data?.phase==="completed";
  const oldResult=oldCompleted?prior.data?.result:null;
  payload.__pp_async_start=true;
  const headers=new Headers(init?.headers||(input instanceof Request?input.headers:undefined));
  headers.set("content-type","application/json");headers.set("accept","application/json");
  const url=typeof input==="string"?input:input.url;
  const send=()=>nativeFetch(url,{
   ...(init||{}),method:"POST",headers,body:JSON.stringify(payload),credentials:init?.credentials||"same-origin"
  });
  let lastStatus=503,lastData={ok:false,error:"ga_start_server_temporarily_unavailable"};
  for(let attempt=0;attempt<3;attempt++){
   abortIfStopped();
   let start=null,body=null;
   try{start=await send()}
   catch(e){
    if(signal?.aborted||e?.name==="AbortError")throw e;
    lastStatus=503;
    lastData=normalizeStartError(0,null);
   }
   if(start){
    const status=start.status;
    startTelemetry.lastHttp=status;
    lastStatus=status;
    try{body=await start.json()}catch(_){body=null}
    if(status===202&&body?.ok===true&&body?.started===true){
     window.dispatchEvent(new CustomEvent("pp:ga-async-started",{
      detail:{job_id:body.job_id||null,joined:!!body.joined}
     }));
     return waitForPlan(signal);
    }
    // A valid synchronous 200 result from an older deployment is not an error.
    if(status===200&&body?.ok===true&&Array.isArray(body.operations)&&body.operations.length){
     return {status:200,data:body};
    }
    lastData=normalizeStartError(status,body);
    // Explicitly preserve the non-202 HTTP error branch required by the native contract.
    if(start.status!==202&&status>=400&&status<500&&status!==408&&status!==409&&status!==425&&status!==429)
     return {status,data:lastData};
   }
   // On any uncertain start response, first probe the existing job. A second
   // POST while one is active can otherwise create parallel scheduling work.
   for(let probe=0;probe<3;probe++){
    abortIfStopped();
    await sleep(probe===0?250:probe===1?600:1100);
    abortIfStopped();
    try{
     const cur=await progressOnce();
     if(cur.r.ok&&cur.data?.running){
      startTelemetry.recoveries++;
      startTelemetry.lastRecovery="joined_existing_job";
      return waitForPlan(signal);
     }
     // If there was no previous completed result, a completed GA now belongs
     // to this start attempt; never repeat it.
     if(cur.r.ok&&cur.data?.phase==="completed"&&cur.data?.success===true&&
        cur.data?.result&&(!oldCompleted||!oldResult)){
      startTelemetry.recoveries++;
      startTelemetry.lastRecovery="finished_during_start_response";
      return {status:200,data:{...cur.data.result,ok:true}};
     }
    }catch(e){if(signal?.aborted)throw e}
   }
   if(!retryableStatus(lastStatus)&&lastStatus!==409)return {status:lastStatus,data:lastData};
   if(attempt===2)break;
   startTelemetry.retries++;
   await sleep((attempt+1)*600);
  }
  // Preserve the real backend error when it is JSON. Never turn a 502 HTML
  // page into the old opaque validator message.
  return {status:lastStatus>=400&&lastStatus<=599?lastStatus:503,data:lastData};
 }
`;
const output=source.slice(0,left)+replacement+source.slice(right);
if(output.includes("ga_start_invalid_response")||!output.includes("joined_existing_job")||
 !output.includes("ga_start_server_temporarily_unavailable"))throw Error("GA_START_PATCH_GUARD_FAILED");
writeFileSync(file,output);
console.log("GA_START_GUARDED_RECONNECTION_PATCH_READY",JSON.stringify({oldSha:sha,newSha:createHash("sha256").update(output).digest("hex"),delta:output.length-source.length}));
