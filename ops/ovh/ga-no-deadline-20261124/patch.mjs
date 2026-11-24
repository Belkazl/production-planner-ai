import {readFileSync,writeFileSync} from "node:fs";
import assert from "node:assert/strict";
const [clientOld,clientNew,upstreamOld,upstreamNew,configOld,configNew]=process.argv.slice(2);
if(!clientOld||!clientNew||!upstreamOld||!upstreamNew||!configOld||!configNew)
 throw Error("GA_NO_DEADLINE_SIX_PATHS_REQUIRED");
const client=readFileSync(clientOld,"utf8");
const upstream=readFileSync(upstreamOld,"utf8");
const config=readFileSync(configOld,"utf8");
const begin=" async function waitForPlan(signal){";
const end="\\n const startTelemetry=";
assert.equal(client.split(begin).length,2,"one existing waitForPlan");
assert.equal(client.split(end).length,2,"one existing client telemetry");
const a=client.indexOf(begin),b=client.indexOf(end,a);
assert(b>a);
const originalWait=client.slice(a,b);
assert(originalWait.includes("const deadline=Date.now()+15*60*1000"));
assert(originalWait.includes('error:"ga_client_wait_timeout"'));
const replacement=[
' async function waitForPlan(signal){',
'  // Never fail a GA job because of elapsed time or temporary connection loss.',
'  // Each progress request has its own short network deadline.',
'  let transient=0;',
'  for(;;){',
'   if(signal?.aborted)throw new DOMException("The operation was aborted.","AbortError");',
'   await sleep(transient?Math.min(15000,2000+transient*2000):3000);',
'   if(signal?.aborted)throw new DOMException("The operation was aborted.","AbortError");',
'   let out;',
'   try{out=await progressOnce(AbortSignal.timeout(14000))}',
'   catch(err){',
'    if(signal?.aborted)throw new DOMException("The operation was aborted.","AbortError");',
'    transient=Math.min(10,transient+1);',
'    startTelemetry.lastRecovery="reconnecting_to_worker";',
'    continue;',
'   }',
'   const {r,data}=out;',
'   if(r.status===401||r.status===403)',
'    return {status:r.status,data:{ok:false,error:"authentication_required"}};',
'   if(!r.ok||!data){',
'    transient=Math.min(10,transient+1);',
'    startTelemetry.lastRecovery="reconnecting_to_worker";',
'    continue;',
'   }',
'   transient=0;startTelemetry.lastRecovery=null;',
'   if(data.running || ["queued","loading_runtime","validating_model","installing_model",',
'      "building_first_plan","optimizing","finalizing"].includes(data.phase))continue;',
'   if(data.success&&data.result)return {status:200,data:{...data.result,ok:true}};',
'   if(data.phase==="cancelled"||data.error==="optimization_stopped")',
'    return {status:200,data:{ok:false,stopped:true,error:"optimization_stopped",best_preview:data.best_preview||null}};',
'   if(["failed","timed_out","invalid","stale","interrupted"].includes(data.phase)||data.error){',
'    const status=String(data.error||"").startsWith("continuation_")?409:503;',
'    return {status,data:{ok:false,error:data.error||("ga_"+String(data.phase||"failed"))}};',
'   }',
'   // Unknown nonterminal intermediate statuses are not a reason to stop a job.',
'  }',
' }'
].join("\\n");
const nextClient=client.slice(0,a)+replacement+client.slice(b);
assert(!nextClient.includes('ga_client_wait_timeout'));
assert(!nextClient.includes("Date.now()+15*60*1000"));
assert(nextClient.includes("if(signal?.aborted)throw"));
assert(nextClient.includes('window.__PP_ASYNC_PLAN_TRANSPORT__=true'));
assert(nextClient.includes("activePlanPromise=joinOrStart"));
const upstreamTail="      await cancel(req);\\n      return response({ok:false,error:'ga_worker_timeout'},504);";
const upstreamSafe=[
'      // A legacy synchronous HTTP request reached its transport lifetime.',
'      // Return an account-owned async job. Never cancel the GA worker.',
'      return response({ok:true,started:true,job_id:state.id,running:true,',
'        phase:state.state,percent:state.progress},202);'
].join("\\n");
assert.equal(upstream.split(upstreamTail).length,2,"sync upstream tail changed");
const nextUpstream=upstream.replace(upstreamTail,upstreamSafe);
assert(nextUpstream.includes("if(asyncStart)return response({ok:true,started:true"));
assert(!nextUpstream.includes("error:'ga_worker_timeout'"));
assert(nextUpstream.includes("while(now()-state.began<maxWaitMs)"));
assert(nextUpstream.includes("if(opts?.signal?.aborted||state.state==='cancelled')"));
const obj=JSON.parse(config);
assert.equal(String(obj.PP_PY_GA_TIMEOUT_S),"180","old GA-worker config expected");
obj.PP_PY_GA_TIMEOUT_S="0";
const configNext=JSON.stringify(obj,null,2)+"\\n";
assert.equal(String(JSON.parse(configNext).PP_PY_GA_TIMEOUT_S),"0");
writeFileSync(clientNew,nextClient);
writeFileSync(upstreamNew,nextUpstream);
writeFileSync(configNew,configNext);
console.log("GA_RUNTIME_NO_DEADLINE_EXACT_PATCH_PASS",JSON.stringify({
 clientOld:client.length,clientNew:nextClient.length,
 upstreamOnlyTransportLifetime:true,workerTimeoutSeconds:0,
 manualAbortPreserved:true,networkRetriesWithoutDeadline:true
}));
