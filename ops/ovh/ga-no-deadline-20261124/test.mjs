import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import assert from "node:assert/strict";

const [beforeClient,afterClient,beforeUpstream,afterUpstream,beforeConfig,afterConfig]=process.argv.slice(2);
assert(afterConfig,"Expected original and candidate files");
const old=readFileSync(beforeClient,"utf8"),next=readFileSync(afterClient,"utf8");
const up0=readFileSync(beforeUpstream,"utf8"),up1=readFileSync(afterUpstream,"utf8");
const config0=JSON.parse(readFileSync(beforeConfig,"utf8"));
const config1=JSON.parse(readFileSync(afterConfig,"utf8"));
assert.equal(config0.PP_PY_GA_TIMEOUT_S,"180");
assert.equal(config1.PP_PY_GA_TIMEOUT_S,"0");
for(const k of Object.keys(config0))if(k!=="PP_PY_GA_TIMEOUT_S")assert.deepEqual(config1[k],config0[k]);
assert(!next.includes("ga_client_wait_timeout")&&!next.includes("Date.now()+15*60*1000"));
assert(next.includes("AbortSignal.timeout(14000)"));
assert(next.includes("ppRouteGaDiagnosticsOutsideValidator"));
assert(next.includes('const nativeFetch=window.fetch.bind(window)'));
assert(next.includes('activePlanPromise=joinOrStart'));
assert(up0.includes("await cancel(req);\n      return response({ok:false,error:'ga_worker_timeout'},504);"));
assert(!up1.includes("error:'ga_worker_timeout'"));
assert(up1.includes("job_id:state.id,running:true"));
assert(up1.includes("if(opts?.signal?.aborted||state.state==='cancelled')"));
assert(up1.includes("if(asyncStart)return response("));
assert(up1.includes("while(now()-state.began<maxWaitMs)"));

async function makeScenario(sequence, opts={}){
 let attempts=0, validator={textContent:opts.validator||"✓ No constraint violations"};
 let status={textContent:"GA: running"};
 const observer={observe(){},callback:null};
 const doc={
  readyState:"complete",
  documentElement:{lang:"en"},
  getElementById(id){return id==="validator"?validator:id==="valid"?status:null},
 };
 const win={
  fetch:async()=>{
   const item=sequence[Math.min(attempts++,sequence.length-1)];
   if(item==="throw")throw new Error("temporary network loss");
   if(item==="invalid")return new Response("not-json",{status:200});
   if(item==="http502")return new Response(JSON.stringify({ok:false,error:"temporary"}),{status:502,headers:{"content-type":"application/json"}});
   if(item==="http401")return new Response(JSON.stringify({ok:false,error:"authentication_required"}),{status:401,headers:{"content-type":"application/json"}});
   return new Response(JSON.stringify(item),{status:200,headers:{"content-type":"application/json"}});
  },
  dispatchEvent(){},
 };
 const nativeSource=next;
 const last=nativeSource.lastIndexOf("})();");
 assert(last>0);
 const injected=nativeSource.slice(0,last)+"window.__ppTestWaitForPlan=waitForPlan;window.__ppTestTelemetry=startTelemetry;\n"+nativeSource.slice(last);
 const fakeDate={now:()=>Date.now()+16*60*1000};
 class Observer{
  constructor(callback){observer.callback=callback}
  observe(){observer.observeCalled=true}
 }
 const ctx={
  window:win,document:doc,MutationObserver:Observer,
  Response,Request,Headers,AbortSignal,DOMException,URL,CustomEvent:class CustomEvent{},
  location:{href:"https://app.liftorbit.app/"},
  setTimeout:fn=>{queueMicrotask(fn);return 1},
  Date:fakeDate
 };
 runInNewContext(injected,ctx,{timeout:3000});
 assert(win.__PP_ASYNC_PLAN_TRANSPORT__===true);
 return {win,validator,status,observer,attempts:()=>attempts};
}
const completed={ok:true,success:true,running:false,phase:"completed",result:{valid:true,duration_minutes:8470,operations:[{id:"op1"}]}};
const scenario=await makeScenario([...Array(9).fill("throw"),"invalid","http502",{ok:true,running:true,phase:"optimizing"},completed]);
const finished=await scenario.win.__ppTestWaitForPlan({aborted:false});
assert.equal(finished.status,200);
assert.equal(finished.data.duration_minutes,8470);
assert.equal(scenario.attempts(),14,"must recover across more than 5 transient errors");
assert.equal(scenario.win.__ppTestTelemetry.lastRecovery,null);
console.log("GA_WAIT_OVER_15MIN_AND_NETWORK_RECOVERY_PASS",scenario.attempts());
const unauthorized=await makeScenario(["http401"]);
assert.equal((await unauthorized.win.__ppTestWaitForPlan({aborted:false})).status,401);
const aborted=await makeScenario([completed]);
await assert.rejects(aborted.win.__ppTestWaitForPlan({aborted:true}),e=>e?.name==="AbortError");
console.log("GA_STOP_SIGNAL_AND_AUTH_FAILURE_PRESERVED_PASS");
const routed=await makeScenario([completed],{validator:"ga_client_wait_timeout"});
assert.equal(routed.validator.textContent,"—");
assert(routed.status.textContent.includes("Optimization status"));
assert(routed.observer.observeCalled);
routed.validator.textContent="✓ No constraint violations";
routed.observer.callback();
assert.equal(routed.validator.textContent,"✓ No constraint violations","must preserve actual constraint validations");
routed.validator.textContent="ga_worker_unavailable";
routed.observer.callback();
assert.equal(routed.validator.textContent,"—");
console.log("GA_DIAGNOSTIC_ROUTED_OUT_OF_CONSTRAINT_VALIDATOR_PASS");
console.log("GA_RUNTIME_NO_DEADLINE_REGRESSIONS_PASS");
