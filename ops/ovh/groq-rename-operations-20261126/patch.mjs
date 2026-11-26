import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {join} from "node:path";
import {prepareSource as oldPrepare} from "../groq-universal-parameters-20261126/prepare.mjs";
import {prepareSource} from "./prepare.mjs";
import {serverTransform as oldUI} from "../groq-parameter-units-20261126/patch.mjs";
import {serverTransform} from "./actions-ui.mjs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,"RENAME_PATCH_ANCHOR_DRIFT: "+a.slice(0,50));return s.replace(a,()=>b)};
export function patchTenant(tenant){
 const prefix="\n// PP_GROQ_ACTIONS_V1\n// PP_GROQ_ORDER_PARAMETERS_V1\n// PP_GROQ_UNIVERSAL_PARAMETERS_V1\n";
 const before=prefix+oldPrepare+"\n"+read("../groq-universal-parameters-20261126/actions-runtime.js")+"\n";
 const after=prefix+"// PP_GROQ_RENAME_OPERATIONS_V1\n"+prepareSource+"\n"+read("./actions-runtime.js")+"\n";
 let s=once(tenant,before,after);
 // Translation of a list may need more output tokens than a single edit.
 s=once(s,'messages,max_completion_tokens:700,reasoning_effort:','messages,max_completion_tokens:editContext?.model?2400:700,reasoning_effort:');
 s=once(s,'Math.ceil(new TextEncoder().encode(JSON.stringify(messages)).length/2)+700','Math.ceil(new TextEncoder().encode(JSON.stringify(messages)).length/2)+(editContext?.model?2400:700)');
 return s;
}
export const patchAuth=auth=>once(auth,oldUI(),serverTransform());
if(process.argv[1]?.endsWith("/groq-rename-operations-20261126/patch.mjs")){
 const [before,after]=process.argv.slice(2);assert(before&&after);
 mkdirSync(after,{recursive:true,mode:0o700});
 for(const name of ["auth-runtime.js","tenant-model-runtime.js","python-ga-upstream.mjs"]){
  const s=readFileSync(join(before,name),"utf8");
  writeFileSync(join(after,name),name==="auth-runtime.js"?patchAuth(s):name==="tenant-model-runtime.js"?patchTenant(s):s,{mode:0o600});
 }
 console.log("RENAME_EXACT_PATCH_PASS");
}
