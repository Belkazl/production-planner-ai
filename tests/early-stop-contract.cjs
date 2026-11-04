const assert=require("node:assert/strict");
const fs=require("node:fs");

const ui=fs.readFileSync("stop-ui.js","utf8");
assert(ui.includes("running=true;requestStop=false;items=[];stop.disabled=false"),
  "stop must be enabled immediately when a GA run starts");
assert(!ui.includes("if(!running||requestStop||!items.length)return;"),
  "stop handler must not wait for the first candidate");
assert(ui.includes("window.__ppFreshDisplayBaseline||null"),
  "early stop must retain the display baseline as fallback");
assert(ui.includes('fetch("/api/optimizer-stop"'),
  "stop must call the server endpoint directly");

const server=fs.readFileSync("feature-stop.ts","utf8");
assert(!server.includes('error:"no_complete_plan_yet"'),
  "server must allow cancellation before a best plan exists");
assert(server.includes("best_preview:state.best||null"),
  "early stop response may safely contain no new best plan");

const pythonBuild=fs.readFileSync("python-ga-upstream-build.ts","utf8");
assert(pythonBuild.includes("const workerStop=await ppPythonGAUpstream.cancel(req);"),
  "stop endpoint must cancel the isolated Python worker first");

console.log("EARLY_STOP_CONTRACT_PASS",JSON.stringify({
  immediateClientStop:true,
  noCandidateRequired:true,
  baselineFallback:true,
  pythonWorkerCancellation:true
}));
