import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";

const root=process.argv[2];
if(!root)throw Error("GA_PROGRESS_PATCH_ROOT_REQUIRED");
const file=resolve(root,"baselines/2026-10-10/aps-setup-bridge/index.ts");
let source=readFileSync(file,"utf8");
const old="async function progress(req){";
const tail="  data.objective=goal;\n  data.aps_setup_bridge=REV;";
if(source.split(old).length!==2||source.split(tail).length!==2)
  throw Error("GA_PROGRESS_PATCH_SOURCE_DRIFT");
if(source.includes("ppReconcileSetupAwareTerminal"))
  throw Error("GA_PROGRESS_PATCH_ALREADY_PRESENT");
const helper=