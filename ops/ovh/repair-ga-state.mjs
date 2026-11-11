// OVH-only: recover explicit fresh GA starts from unreadable historic state.
// No changes to persistence, account isolation, or continuation semantics.
import {readFileSync,writeFileSync} from "node:fs";
import {resolve,join} from "node:path";
const root=resolve(process.argv[2]||"");
if(!root.endsWith("/app"))throw Error("GA_REPAIR_REQUIRES_PINNED_APP_WORKTREE");
const file=join(root,"python-ga-upstream.mjs");
let source=readFileSync(file,"utf8");
const old="    let current;\n    try{current=await currentJob(principal)}catch{return response({ok:false,error:'ga_state_unavailable'},503)}\n    const modelKey=hashModel(model);\n    let args;";
const newBegin="    const modelKey=hashModel(model);\n    let args;";
const pivot="    const asyncStart=args.__pp_async_start===true;\n    delete args.__pp_async_start;";
const next=pivot+`
    const freshRecovery=args.__pp_fresh_recovery===true&&!(args.continue||args.continue_run);
    delete args.__pp_fresh_recovery;
    let current;
    try{current=await currentJob(principal)}catch{
      // Fresh starts only. The worker enforces one active job per account.
      // save() remains mandatory and will cancel the job on any failure.
      if(!freshRecovery)return response({ok:false,error:"ga_state_unavailable"},503);
      console.warn("PP_GA_FRESH_STALE_STATE_SKIPPED");
      current=null;
    }`;
if(source.split(old).length!==2||source.split(pivot).length!==2)throw Error("GA_REPAIR_SOURCE_ANCHORS_CHANGED");
source=source.replace(old,newBegin).replace(pivot,next);
if(!source.includes("PP_GA_FRESH_STALE_STATE_SKIPPED"))throw Error("GA_REPAIR_INTEGRITY_FAILURE");
writeFileSync(file,source);
console.log("OVH_GA_FRESH_RECOVERY_CODE_READY");
