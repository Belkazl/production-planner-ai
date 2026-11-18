const {readFileSync}=require("node:fs");
const {resolve}=require("node:path");
const {runInNewContext}=require("node:vm");
const assert=require("node:assert/strict");
const next=process.argv[2],prior=process.argv[3];
if(!next||!prior)throw Error("FREEZE_FIX_TEST_APP_DIRS_REQUIRED");
const a=readFileSync(resolve(prior,"restart-optimizer-ui.js"),"utf8");
const b=readFileSync(resolve(next,"restart-optimizer-ui.js"),"utf8");
assert(b.startsWith(a+"\n;"),"Existing production scripts must remain byte-for-byte intact");
assert.equal((b.match(/function ppResolveDuplicateGaProgress20261118\(/g)||[]).length,1);
const addon=b.slice(a.length+2);
assert(addon.includes("oldRenderer.stop();"));
assert(addon.includes("legacyObserverStopped:true"));
assert(addon.includes("currentRenderer?.installed"));
assert(!a.includes("ppResolveDuplicateGaProgress20261118"));
let stops=0,refreshes=0;
const fakeWindow={
 __PP_TRUTHFUL_SMOOTH_GA_PERCENT_V1__:{installed:true,stop(){stops++}},
 __PP_SMOOTH_VERIFIED_PROGRESS_V1__:{installed:true,refresh(){refreshes++}}
};
const ctx={window:fakeWindow,console};
runInNewContext(addon,ctx);
assert.equal(stops,1);
assert.equal(refreshes,0);
assert.equal(fakeWindow.__PP_SINGLE_GA_PROGRESS_RENDERER_V1__.active,"confirmed-only");
runInNewContext(addon,ctx);
assert.equal(stops,1,"Idempotence across repeated injection");
console.log("CHROME_FREEZE_PROGRESS_OBSERVER_SINGLE_OWNER_TEST_PASS");
