import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
const root=process.argv[2];
if(!root)throw Error("CONTINUE_SEED_HOTFIX_APP_ROOT_REQUIRED");
const file=resolve(root,"restart-optimizer-ui.js");
let source=readFileSync(file,"utf8");
const old="  const existing=body.resume_plan;\n  if(existing&&Array.isArray(existing.order_sequence)&&existing.order_sequence.length)\n   return previousFetch.apply(this,arguments);\n  const hint=seed();";
const updated="  // The native planner may attach a legacy resume_plan. Treat it as an\n  // untrusted order hint, never as a verified saved performance score.\n  const existing=body.resume_plan;\n  const ownProject=project();\n  const ownIds=Array.isArray(ownProject?.model?.orders)?\n   ownProject.model.orders.map(x=>String(x?.id)):[];\n  const allowedIds=new Set(ownIds);\n  let hint=null;\n  if(Array.isArray(existing?.order_sequence)&&existing.order_sequence.length&&\n    existing.order_sequence.length<=50000&&ownIds.length&&\n    allowedIds.size===ownIds.length&&\n    existing.order_sequence.every(x=>x!=null&&allowedIds.has(String(x)))){\n   const seen=new Set(),ordered=[];\n   for(const item of existing.order_sequence){\n    const id=String(item);\n    if(!seen.has(id)){seen.add(id);ordered.push(id)}\n   }\n   for(const id of ownIds)if(!seen.has(id))ordered.push(id);\n   hint={order_sequence:ordered};\n  }\n  if(!hint)hint=seed();";
if(source.split(old).length!==2)throw Error("CONTINUE_SEED_HOTFIX_SOURCE_DRIFT");
if(!source.includes("window.__PP_CONTINUATION_SEED_V2__={installed:true")||
  !source.includes("quick:Object.freeze({generations:10,population:12})")||
  !source.includes("window.__PP_GA_OBJECTIVE_FLOOR_V1__"))
 throw Error("CONTINUE_SEED_HOTFIX_REQUIRED_GUARDS_NOT_PRESENT");
source=source.replace(old,updated);
if(source.split(updated).length!==2)throw Error("CONTINUE_SEED_HOTFIX_POSTCONDITION");
writeFileSync(file,source);
console.log("CONTINUE_SEED_HOTFIX_SANITIZES_LEGACY_HINT_AND_PRESERVES_CURRENT_MODEL_ONLY");
