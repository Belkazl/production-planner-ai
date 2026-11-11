// Single-purpose compatibility guard: prefer account-owned portable GA state,
 // use validated client incumbent only if the account has no compatible state.
 // Never read another account, change projects, or silently restart as fresh.
import {readFileSync,writeFileSync} from "node:fs";
import {resolve,join} from "node:path";
const root=resolve(process.argv[2]||"");
if(!root.endsWith("/app"))throw Error("CONTINUATION_PATCH_EXPECTS_PINNED_APP_TREE");
const file=join(root,"python-ga-upstream.mjs");
let src=readFileSync(file,"utf8");
const old="    if(continuing&&!args.resume_state&&!args.resume_plan&&current?.resume_state)\n      args.resume_state=current.resume_state;";
const replacement="    if(continuing&&!args.resume_state&&current?.resume_state&&current.modelKey===modelKey&&current.resume_state.objective===(args.objective||'duration')){\n      args.resume_state=current.resume_state;delete args.resume_plan;\n    }";
const anchor="    let state;\n    try{\n      const r=await call(principal,'/internal/jobs','POST',{model,options:args});";
const guarded="    if(continuing&&!args.resume_state&&!args.resume_plan)\n      return response({ok:false,error:'continuation_seed_missing_or_invalid'},409);\n"+anchor;
if(src.split(old).length!==2||src.split(anchor).length!==2)throw Error("CONTINUATION_BACKEND_ANCHOR_CHANGED");
src=src.replace(old,replacement).replace(anchor,guarded);
if(!src.includes("delete args.resume_plan")||!src.includes("CONTINUATION_BACKEND_ANCHOR")&&false)throw Error("CONTINUATION_PATCH_FAILED");
writeFileSync(file,src);
console.log("OVH_CONTINUATION_ACCOUNT_SEED_PRIORITY_AND_NO_PHANTOM_WORKER");
