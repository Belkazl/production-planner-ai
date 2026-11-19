import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
const root=process.argv[2];
if(!root)throw Error("SETUP_BOUND_ROOT_REQUIRED");
const path=resolve(root,"worker-manager.ts");
let s=readFileSync(path,"utf8");
const before=`  const data={kind:"setup_search",base,model,options:{
   iterations:options.iterations||48,seed:options.seed||1729,objective:options.objective||"duration",
   ...(Bun.env.PP_WORKER_TEST==="1"&&options.testHoldMs?{testHoldMs:options.testHoldMs}:{})
  }};`;
const after=`  // Full GA generations/candidates are not affected. This is only the
  // secondary setup-enrichment search applied to an ALREADY computed plan.
  // For hundreds of operations, 48 full O(n^2) schedule replays can outlive
  // the public progress request and spawn overlapping Bun worker processes.
  // Keep deterministic alternative modes, yet bound the secondary work.
  const rawRows=Array.isArray(base?.generic_operations)&&base.generic_operations.length
   ?base.generic_operations:(Array.isArray(base?.operations)?base.operations:[]);
  const n=rawRows.filter(row=>row&&!row.is_setup).length;
  const desired=Math.max(1,Math.min(300,Math.trunc(Number(options.iterations)||48)));
  const iterations=n>=700?Math.min(desired,4):n>=300?Math.min(desired,12):desired;
  const data={kind:"setup_search",base,model,options:{
   iterations,seed:options.seed||1729,objective:options.objective||"duration",
   ...(Bun.env.PP_WORKER_TEST==="1"&&options.testHoldMs?{testHoldMs:options.testHoldMs}:{})
  }};`;
if(s.split(before).length!==2)throw Error("SETUP_WORKER_ANCHOR_UNEXPECTED");
if(!s.includes("child=Bun.spawn({")||!s.includes("runIsolatedSetupSearch"))throw Error("SETUP_WORKER_GUARD_MISSING");
s=s.replace(before,after);
writeFileSync(path,s);
console.log("BOUND_SECONDARY_SETUP_SEARCH_READY");
