const assert=require("node:assert/strict");
const fs=require("node:fs");
const base=fs.readFileSync("baselines/2026-10-10/aps-setup-bridge/index.ts","utf8");
const bridge=fs.readFileSync("python-ga-upstream.mjs","utf8");
assert(base.includes("resume_plan:cont&&ppInc"),"continue UI must send a compact incumbent seed");
assert(base.includes("order_sequence:(Array.isArray(ppInc.order_sequence)"),"seed must carry or derive order sequence");
assert(bridge.includes("const sameModel=current?.modelKey===modelKey"),"only the same account/model may seed continuity");
assert(bridge.includes("normalizedContinuationSeed(ownedResult||verifiedBest,model,true)"),"must prefer validated own incumbent");
assert(bridge.includes("if(!seed&&sameModel&&current?.resume_state)"),"legacy state with own sequence must be recoverable");
assert(bridge.includes("if(!seed&&clientPlan)"),"saved-plan order seed must remain usable");
assert(bridge.includes("delete args.resume_state"),"stale resume_state must not reach Python unchanged");
assert(bridge.includes("args.resume_plan=seed"),"continuation must recompute with sanitized order seed");
assert(bridge.includes("if(!seed)return response({ok:false,error:'continuation_seed_missing_or_invalid'},409)"),"missing seed must fail closed, not silently restart");
assert(bridge.includes("continuationError?state.error"),"continuation failures must preserve their safe error code");
console.log("CONTINUATION_COMPAT_CONTRACT_PASS",JSON.stringify({
 uiSeed:true,accountOwned:true,staleStateHandled:true,
 clientSavedSeed:true,safePythonSeed:true,failClosed:true,errorCode:true
}));
