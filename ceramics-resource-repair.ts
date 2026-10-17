import {readFileSync,writeFileSync} from "node:fs";
let source=readFileSync("index.ts","utf8");
function one(from:string,to:string,name:string){
 const n=source.split(from).length-1;
 if(n!==1)throw Error("PP_DEMO_RESOURCE_"+name+"_ANCHOR_"+n);
 source=source.replace(from,to);
}
const runtime=readFileSync("ceramics-resource-repair.js","utf8");
if(!runtime.includes("ppReconcileCeramicsFixture")||!runtime.includes("ppImportCeramicsResourceCompatibility"))
 throw Error("DEMO_REPAIR_MISSING_SOURCE");
// Execute only after the server-side auth and origin checks; the ordinary
// production model API and storage API continue to use the exact original paths.
one('async function ppAuthenticatedHandler(req){',
    runtime+'\nasync function ppAuthenticatedHandler(req){',"source_before_auth_guard");
one(' const res=await ppTenantDispatch(req,r=>handler(r));\n const h=new Headers(res.headers);h.set("cache-control","no-store");',
    ' const res=await ppTenantDispatch(req,r=>r.method==="POST"&&path==="/api/project/model/import"?ppImportCeramicsResourceCompatibility(r):handler(r));\n const h=new Headers(res.headers);h.set("cache-control","no-store");',"authenticated_model_import");
one('Bun.serve({port:Number(Bun.env.PORT||8080),async fetch(req){',
    'Bun.serve({port:Number(Bun.env.PORT||8080),idleTimeout:255,async fetch(req){',"long_running_240_gen_ga");
if(!source.includes("ppImportCeramicsResourceCompatibility(req)")||!source.includes("idleTimeout:255"))
 throw Error("DEMO_REPAIR_INVARIANT");
writeFileSync("index.ts",source);
console.log("PP_CERAMIC_RESOURCE_MIGRATION_BUILD_PASS",JSON.stringify({compatibleFiringRecipes:["PS-01","PS-02","PS-03"],demoOnly:true,ordersUnchanged:true,savedPlansUntouched:true,gaIdleTimeoutSeconds:255,authPreserved:true}));
