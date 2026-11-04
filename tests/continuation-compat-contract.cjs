const assert=require("node:assert/strict");
const fs=require("node:fs");
const base=fs.readFileSync("baselines/2026-10-10/aps-setup-bridge/index.ts","utf8");
const bridge=fs.readFileSync("python-ga-upstream.mjs","utf8");
assert(base.includes("resume_plan:cont&&ppInc"),"continue UI must send a compact incumbent seed");
assert(base.includes("order_sequence:(Array.isArray(ppInc.order_sequence)"),"seed must carry or derive order sequence");
assert(bridge.includes("current?.resume_state"),"bridge must reuse same-account completed resume state");
assert(bridge.includes("compactResumePlan(current?.best||current?.result)"),"bridge must seed continuation after stop");
assert(bridge.includes("continuationError?state.error"),"continuation failures must preserve their safe error code");
console.log("CONTINUATION_COMPAT_CONTRACT_PASS",JSON.stringify({
 uiSeed:true,completedResume:true,stoppedResume:true,errorCode:true
}));
