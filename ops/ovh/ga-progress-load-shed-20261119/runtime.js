(function ppLargeGaProgressLoadShedV1(){
"use strict";
if(window.__PP_GA_PROGRESS_LOAD_SHED_V1__?.installed)return;
const nativeFetch=window.fetch.bind(window);
const minOps=350,intervalMs=7000;
let heavy=false,lastAt=0,summary=null,inFlight=null,closed=false;
let realCalls=0,lightweight=0,joined=0,parseFailures=0,maxOps=0,runCount=0;
const running=()=>!!document.getElementById("opt")?.classList.contains("pp-opt-running");
function forget(){
 heavy=false;lastAt=0;summary=null;inFlight=null;
}
function statusRequest(input,init){
 try{
  const method=String(init?.method||(input instanceof Request?input.method:"GET")||"GET").toUpperCase();
  if(method!=="GET")return false;
  const url=new URL(typeof input==="string"?input:input?.url,location.href);
  return url.origin===location.origin&&url.pathname==="/api/plan-progress"&&
    !url.searchParams.has("ppForce")&&!url.searchParams.has("ppNoCache");
 }catch(_){return false}
}
window.fetch=async function ppSharedGaFetch(input,init){
 if(closed||!statusRequest(input,init))return nativeFetch(input,init);
 if(!running()){
  if(heavy)forget();
  return nativeFetch(input,init);
 }
 const now=Date.now();
 if(heavy&&summary&&now-lastAt<intervalMs){
  lightweight++;
  return new Response(JSON.stringify({...summary,
    best_preview:null,candidate_preview:null,variants:[],result:null
  }),{status:200,headers:{"content-type":"application/json","cache-control":"no-store"}});
 }
 if(inFlight){joined++;return (await inFlight).clone()}
 realCalls++;
 const promised=nativeFetch(input,init).then(async response=>{
  if(response.ok){
   try{
    const payload=await response.clone().json();
    if(payload?.running===true&&payload.phase==="running"){
     const count=Math.max(payload.best_preview?.operations?.length||0,
       payload.candidate_preview?.operations?.length||0);
     maxOps=Math.max(maxOps,count);
     if(count>=minOps)heavy=true;
     if(heavy){
      summary={ok:payload.ok!==false,running:true,success:false,
        phase:"running",percent:Number(payload.percent)||0,
        done:Number(payload.done??payload.percent)||0,
        total:Number(payload.total)||100,error:null};
      lastAt=Date.now();
     }
    }else if(payload?.phase==="completed"||payload?.running===false){
     forget();
    }
   }catch(_){parseFailures++}
  }
  return response;
 });
 inFlight=promised;
 try{return (await promised).clone()}
 finally{if(inFlight===promised)inFlight=null}
};
window.addEventListener("pp:optimizer-started",()=>{forget();runCount++});
window.addEventListener("pp:optimizer-reconnect-pending",()=>{forget()});
window.__PP_GA_PROGRESS_LOAD_SHED_V1__={
 installed:true,mode:"full-candidate-every-seven-seconds-for-350plus-ops",
 get state(){return{heavy,realCalls,lightweight,joined,parseFailures,maxOps,
  runCount,lastPercent:summary?.percent||0,msSinceLastFull:lastAt?Date.now()-lastAt:null}},
 reset:forget,
 dispose(){closed=true;forget();window.fetch=nativeFetch}
};
})();