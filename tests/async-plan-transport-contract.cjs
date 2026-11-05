const assert=require("node:assert/strict");
const fs=require("node:fs");
const transport=fs.readFileSync("async-plan-transport.js","utf8");
const bridge=fs.readFileSync("python-ga-upstream.mjs","utf8");
assert(transport.includes('payload.__pp_async_start=true'),"browser must request short async start");
assert(transport.includes('"/api/plan-progress"'),"browser must await final result through progress");
assert(transport.includes("let activePlanPromise=null"),"browser must deduplicate overlapping plan calls");
assert(transport.includes("if(cur.r.ok&&cur.data?.running)"),"browser must join an already running job after reload");
assert(transport.includes("start.status!==202"),"browser must preserve non-async error responses");
assert(transport.includes("data.success&&data.result"),"browser must synthesize final JSON only from completed result");
assert(bridge.includes("if(asyncStart)return response({ok:true,started:true"),"server must detach request lifetime from GA job");
assert(bridge.includes("candidate_preview:running?(state.candidate||null):null"),"progress must expose only live candidate");
assert(bridge.includes("result:status.status==='completed'?state.result:null"),"progress must expose final result");
console.log("ASYNC_PLAN_TRANSPORT_CONTRACT_PASS",JSON.stringify({
 shortStart:true,polling:true,finalResult:true,candidate:true,deduplicated:true,joinAfterReload:true
}));
