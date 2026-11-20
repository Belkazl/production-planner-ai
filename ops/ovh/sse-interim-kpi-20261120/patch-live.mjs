import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
const root=process.argv[2];
if(!root)throw Error("SSE_INTERIM_KPI_APP_ROOT_REQUIRED");
const basis="ops/ovh/sse-interim-kpi-20261120/";
const canonical="ops/ovh/sse-stream-v1-20261120/";
for(const {name,file,old,newFile,updatedMarker} of [
 {name:"frontend",file:"restart-optimizer-ui.js",old:"baseline-frontend.txt",
  newFile:canonical+"frontend.js.txt",updatedMarker:"function updatePreviewKpis(preview)"},
 {name:"backend",file:"python-ga-upstream.mjs",old:"baseline-backend.txt",
  newFile:canonical+"backend-stream.js.txt",updatedMarker:"_pp_preview_kpis:metrics"}]){
 const path=resolve(root,file),source=readFileSync(path,"utf8");
 const baseline=readFileSync(basis+old,"utf8");
 const revised=readFileSync(newFile,"utf8");
 if(source.split(baseline).length!==2)
  throw Error("SSE_INTERIM_KPI_LIVE_SOURCE_DRIFT_"+file);
 if(revised===baseline||!revised.includes(updatedMarker))
  throw Error("SSE_INTERIM_KPI_CANONICAL_PATCH_DRIFT_"+file);
 if(name==="frontend" &&
    (!source.includes("__PP_HIDE_OBSOLETE_GA_WIDGETS_V1__") ||
     !source.includes("const STEP_MS=250;")))
  throw Error("SSE_INTERIM_KPI_PROGRESS_OR_CLEANUP_GUARD_MISSING");
 if(name==="backend" && !source.includes("async function stream(req)"))
  throw Error("SSE_INTERIM_KPI_ACTIVE_BACKEND_MISSING");
 const output=source.replace(baseline,revised);
 if(output.split(revised).length!==2)
  throw Error("SSE_INTERIM_KPI_UNEXPECTED_DUPLICATE_OWNER_"+file);
 writeFileSync(path,output);
 console.log("SSE_INTERIM_KPI_EXACT_PATCH",name,
  "old",createHash("sha256").update(source).digest("hex"),
  "new",createHash("sha256").update(output).digest("hex"));
}
