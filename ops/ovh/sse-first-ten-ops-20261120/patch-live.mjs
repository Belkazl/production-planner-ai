import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
const root=process.argv[2];
if(!root)throw Error("SSE_FIRST_TEN_OPERATIONS_APP_ROOT_REQUIRED");
const baseline="ops/ovh/sse-first-ten-ops-20261120/";
const canonical="ops/ovh/sse-stream-v1-20261120/";
for(const {name,file,marker} of [
 {name:"backend",file:"python-ga-upstream.mjs",
  marker:"preview_more_than_ten_operations_per_lane"},
 {name:"frontend",file:"restart-optimizer-ui.js",
  marker:"the earliest ten operations per machine, including setups"}]){
 const path=resolve(root,file);
 const current=readFileSync(path,"utf8");
 const prev=readFileSync(baseline+"baseline-"+name+".txt","utf8");
 const next=readFileSync(canonical+(name==="backend"?"backend-stream.js.txt":"frontend.js.txt"),"utf8");
 if(current.split(prev).length!==2)
  throw Error("SSE_FIRST_TEN_OPERATIONS_LIVE_SOURCE_DRIFT_"+file);
 if(prev===next||!next.includes(marker))
  throw Error("SSE_FIRST_TEN_OPERATIONS_CANONICAL_MISSING_"+file);
 if(name==="backend"&&
    (!current.includes("async function stream(req)")||!next.includes("_pp_preview_kpis:metrics")))
  throw Error("SSE_FIRST_TEN_OPERATIONS_BACKEND_SSE_KPI_GUARD");
 if(name==="frontend"&&
    (!current.includes("const STEP_MS=250;")||
     !current.includes("__PP_HIDE_OBSOLETE_GA_WIDGETS_V1__")||
     !current.includes("function updatePreviewKpis(preview)")))
  throw Error("SSE_FIRST_TEN_OPERATIONS_FRONTEND_GUARD");
 const patched=current.replace(prev,next);
 if(patched===current||patched.split(next).length!==2)
  throw Error("SSE_FIRST_TEN_OPERATIONS_PATCH_NOT_EXACT_"+file);
 writeFileSync(path,patched);
 console.log("SSE_FIRST_TEN_OPERATIONS_PATCH",name,
  "old",createHash("sha256").update(current).digest("hex"),
  "new",createHash("sha256").update(patched).digest("hex"));
}
