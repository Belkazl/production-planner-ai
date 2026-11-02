import {readFileSync,writeFileSync} from "node:fs";
let s=readFileSync("index.ts","utf8");
const runtime=readFileSync("tenant-model-runtime.js","utf8");
function once(a,b,label){const n=s.split(a).length-1;if(n!==1)throw Error("ACCOUNT_BOUNDARY_"+label+"_ANCHOR_"+n);s=s.replace(a,b)}
if(!runtime.includes("ppReadAccountModel")||!runtime.includes("ppAccountPlanBelongsToModel")||!runtime.includes("ppTenantAuthenticated"))throw Error("ACCOUNT_RUNTIME_MISSING");
const original=[...s.matchAll(/^async function loadModel\(req\)\{[^\n]*\}$/gm)];
if(original.length!==1)throw Error("ACCOUNT_LOAD_MODEL_ANCHOR_"+original.length);
s=s.replace(original[0][0],runtime+"\nasync function loadModel(req){const model=await ppReadAccountModel(req);if(!Array.isArray(model?.orders)||!model.orders.length)throw Error(\"account_model_not_ready\");return model;}");
for(const h of ["export function scheduleWithSetup(base,model,options={}) {","export async function searchWithSetup(base,model, options={}, report=()=>{}) {","function convertOne(base,model,seed){"]){
 once(h,h+"\nmodel=ppAlignOwnedResources(model,base);\n","resource_adapter");
}
once("return await ppAuthenticatedHandler(req)","return await ppTenantAuthenticated(req)","protected_entry");
if(!s.includes("async function loadModel(req){const model=await ppReadAccountModel(req)")||!s.includes("return await ppTenantAuthenticated(req)"))throw Error("ACCOUNT_BOUNDARY_BUILD_INTEGRITY");
writeFileSync("index.ts",s);
console.log("PP_ACCOUNT_MODEL_BOUNDARY_BUILD_OK",JSON.stringify({release:"account-model-boundary-v3",protected:true,sessionOwnedModel:true,planValidation:true,sharedModelCacheDisabled:true}));
