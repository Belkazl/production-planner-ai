import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {join} from "node:path";
import {prepareSource as oldPrepare} from "../groq-ceramic-order-runtime-20261126/prepare.mjs";
import {serverTransformSource as oldUI} from "../groq-ceramic-order-runtime-20261126/actions-ui.mjs";
import {prepareSource} from "./prepare.mjs";
import {serverTransformSource} from "./actions-ui.mjs";
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,"UNIVERSAL_ANCHOR_DRIFT: "+a.slice(0,80));return s.replace(a,b)};
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
export function patchTenant(tenant){
 const prior="\n// PP_GROQ_ACTIONS_V1\n// PP_GROQ_ORDER_PARAMETERS_V1\n"+oldPrepare+"\n"+read("../groq-ceramic-order-runtime-20261126/actions-runtime.js")+"\n";
 const next="\n// PP_GROQ_ACTIONS_V1\n// PP_GROQ_ORDER_PARAMETERS_V1\n// PP_GROQ_UNIVERSAL_PARAMETERS_V1\n"+prepareSource+"\n"+read("./actions-runtime.js")+"\n";
 let s=once(tenant,prior,next);
 s=once(s,'if(path==="/api/assistant")return ppGroqAssistant(req);','if(path==="/api/assistant/validate-edit")return ppGroqValidateEdit(req);\n if(path==="/api/assistant")return ppGroqAssistant(req);');
 s=once(s,"Never invent or silently overwrite production attributes.","Never invent or silently overwrite production attributes. You can create or edit typed order parameters, apply a parameter to orders of a selected process, manage allowed/min/max equipment capabilities, link an operation to a setup parameter, and add or edit setup transition durations. Use the exact parameter names and current types in the editing catalog. The application checks each confirmed edit on a temporary copy using the native scheduler; never claim success until the application confirms it. Ask for missing values or rules, not irrelevant metadata.");
 return s+"\n"+read("./validate-runtime.js")+"\n";
}
export function patchAuth(auth){return once(auth,oldUI(),serverTransformSource())}
export function patchNative(native){
 assert(!native.includes("ppGroqNativeValidate"),"UNIVERSAL_ALREADY_INSTALLED");
 for(const anchor of ["async function call(principal,path,method='GET',body)","const account = async req =>","async function currentJob(principal)","function createPythonGAUpstream(","checkPlan","return {fetch:fetchUpstream,cancel,resetPermission"])assert(native.includes(anchor),"UNIVERSAL_NATIVE_CONTRACT_DRIFT_"+anchor);
 const a="  async function fetchUpstream(req,opts){";
 return once(native,a,read("./native-preflight.js")+a);
}
if(process.argv[1]?.endsWith("/groq-universal-parameters-20261126/patch.mjs")){
 const [before,after]=process.argv.slice(2);assert(before&&after);
 const outputs={"auth-runtime.js":patchAuth(readFileSync(join(before,"auth-runtime.js"),"utf8")),"tenant-model-runtime.js":patchTenant(readFileSync(join(before,"tenant-model-runtime.js"),"utf8")),"python-ga-upstream.mjs":patchNative(readFileSync(join(before,"python-ga-upstream.mjs"),"utf8"))};
 mkdirSync(after,{recursive:true,mode:0o700});
 for(const [name,s] of Object.entries(outputs))writeFileSync(join(after,name),s,{mode:0o600});
 console.log("UNIVERSAL_EXACT_THREE_FILE_PATCH_PASS");
}
