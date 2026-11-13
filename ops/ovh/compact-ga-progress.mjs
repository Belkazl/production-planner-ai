// OVH-only lossless intermediate-GA JSON compaction.
// The etalon Gantt can use operations when generic_operations is an identical alias.
// No GA algorithms, saved plans, auth decisions, result/terminal replies or state writes change.
import {readFileSync,writeFileSync} from "node:fs";
import {resolve,join} from "node:path";
const root=resolve(process.argv[2]||"");
if(!root.endsWith("/app"))throw Error("PP_COMPACT_GA_EXPECTS_PINNED_APP");
const path=join(root,"auth-runtime.js");
let src=readFileSync(path,"utf8");
const anchor="async function ppAuthenticatedHandler(req){";
if(src.split(anchor).length!==2)throw Error("PP_COMPACT_GA_HANDLER_ANCHOR");
const guard=" const res=await handler(req);\n const h=new Headers(res.headers);h.set(\"cache-control\",\"no-store\");\n return new Response(res.body,{status:res.status,headers:h});";
if(src.split(guard).length!==2)throw Error("PP_COMPACT_GA_RESPONSE_ANCHOR");
const helper=`
function ppCompactGaDuplicateOperations(plan){
 if(!plan||typeof plan!=="object"||Array.isArray(plan))return plan;
 const ops=plan.operations,duplicate=plan.generic_operations;
 if(!Array.isArray(ops)||!Array.isArray(duplicate)||ops.length!==duplicate.length||!ops.length)return plan;
 // Strict content equality. Differing generic rows (setup/material semantics)
 // are never removed. This preserves every field needed by each Gantt mode.
 if(JSON.stringify(ops)!==JSON.stringify(duplicate))return plan;
 const result={...plan};
 delete result.generic_operations;
 return result;
}
async function ppCompactGaProgressResponse(req,res){
 if(req.method!=="GET"||new URL(req.url).pathname!=="/api/plan-progress"||res.status!==200)return res;
 try{
  const data=await res.clone().json();
  if(!data||data.ok!==true||data.running!==true)return res;
  const best=ppCompactGaDuplicateOperations(data.best_preview);
  const candidate=ppCompactGaDuplicateOperations(data.candidate_preview);
  if(best===data.best_preview&&candidate===data.candidate_preview)return res;
  const compact={...data,best_preview:best,candidate_preview:candidate};
  const headers=new Headers(res.headers);
  for(const name of ["content-length","content-encoding","transfer-encoding"])headers.delete(name);
  headers.set("content-type","application/json; charset=utf-8");
  headers.set("cache-control","no-store");
  headers.set("x-liftorbit-progress-payload","lossless-dedup");
  return new Response(JSON.stringify(compact),{status:res.status,headers});
 }catch(_){return res}
}
`;
src=src.replace(anchor,helper+"\n"+anchor).replace(guard,
 " const res=await handler(req);\n const compact=await ppCompactGaProgressResponse(req,res);\n const h=new Headers(compact.headers);h.set(\"cache-control\",\"no-store\");\n return new Response(compact.body,{status:compact.status,headers:h});");
if(!src.includes("PP_COMPACT_GA_HANDLER_ANCHOR")&&(!src.includes("ppCompactGaProgressResponse(req,res)")||!src.includes("lossless-dedup")))throw Error("PP_COMPACT_GA_SOURCE_VERIFICATION");
writeFileSync(path,src);
console.log("PP_GA_PROGRESS_DUPLICATE_ROWS_COMPACT_READY");
