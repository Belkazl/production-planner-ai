import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {join} from "node:path";
import {prepareSource as oldPrepare} from "../groq-project-actions-20261126/prepare.mjs";
import {serverTransformSource as oldUI} from "../groq-project-actions-20261126/actions-ui.mjs";
import {prepareSource} from "./prepare.mjs";
import {serverTransformSource} from "./actions-ui.mjs";
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,"ORDER_PARAM_ANCHOR_DRIFT: "+a.slice(0,70));return s.replace(a,b)};
const read=(path)=>readFileSync(new URL(path,import.meta.url),"utf8");
export function patchTenant(tenant){
 const prior="\n// PP_GROQ_ACTIONS_V1\n"+oldPrepare+"\n"+read("../groq-project-actions-20261126/actions-runtime.js")+"\n";
 const next="\n// PP_GROQ_ACTIONS_V1\n// PP_GROQ_ORDER_PARAMETERS_V1\n"+prepareSource+"\n"+read("./actions-runtime.js")+"\n";
 let s=once(tenant,prior,next);
 s=once(s,"Do not ask for priority, deadline, parameters or other fields that are not required by the tool.","Do not ask for priority, deadline or other fields that are not required by the tool. Production parameters are essential: propose an existing same-process order as a template, with exact values shown for confirmation. When asked to repair an existing order, use complete_order_parameters, not add_order. Never invent or silently overwrite production attributes. If the user requests a particular template, select its index from the catalog; if it is ambiguous, ask which order.");
 return s;
}
export function patchAuth(auth){
 return once(auth,oldUI(),serverTransformSource());
}
if(process.argv[1]?.endsWith("/groq-ceramic-order-runtime-20261126/patch.mjs")){
 const [before,after]=process.argv.slice(2);assert(before&&after);
 const outputs={"auth-runtime.js":patchAuth(readFileSync(join(before,"auth-runtime.js"),"utf8")),"tenant-model-runtime.js":patchTenant(readFileSync(join(before,"tenant-model-runtime.js"),"utf8"))};
 mkdirSync(after,{recursive:true,mode:0o700});
 for(const [name,s] of Object.entries(outputs))writeFileSync(join(after,name),s,{mode:0o600});
 console.log("ORDER_PARAMETER_EXACT_PATCH_PASS");
}
