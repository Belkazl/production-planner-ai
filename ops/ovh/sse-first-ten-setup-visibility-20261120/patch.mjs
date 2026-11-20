import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
const original=process.argv[2],target=process.argv[3];
if(!original||!target)throw Error("SSE_FIRST10_SETUP_FILES_REQUIRED");
const current=readFileSync(original,"utf8");
const canonical=readFileSync("ops/ovh/sse-stream-v1-20261120/backend-stream.js.txt","utf8");
const startMarker="  const boundedPreview = (plan,model) => {";
const endMarker="  async function stream(req){";
function section(src,label){
 const a=src.indexOf(startMarker),b=src.indexOf(endMarker,a);
 if(a<0||b<=a||src.indexOf(startMarker,a+1)!==-1||
    src.indexOf(endMarker,b+1)!==-1)throw Error("SSE_FIRST10_"+label+"_BOUNDS_DRIFT");
 return {a,b,body:src.slice(a,b)};
}
const before=section(current,"LIVE"),after=section(canonical,"CANONICAL");
if(before.body===after.body)throw Error("SSE_FIRST10_ALREADY_DEPLOYED");
if(!current.includes("const isSetup = op =>")||
   !current.includes("for(const entry of entries.slice(0,10))")||
   !current.includes("_pp_preview_kpis:metrics")||
   !current.includes("const useBest=setupRows(live)===0&&setupRows(stored)>0"))
 throw Error("SSE_FIRST10_LIVE_SECURITY_OR_SSE_PROTOCOL_DRIFT");
if(!after.body.includes("const detached=[];")||
   !after.body.includes("const visibleEnd=Math.max(")||
   !after.body.includes("duration_minutes:visibleEnd")||
   !after.body.includes("for(const entry of entries.slice(0,10))"))
 throw Error("SSE_FIRST10_NEW_CANONICAL_SOURCE_NOT_TESTED");
const patched=current.slice(0,before.a)+after.body+current.slice(before.b);
if(!patched.includes(after.body)||patched.includes(before.body))
 throw Error("SSE_FIRST10_PATCH_NOT_EXACT");
writeFileSync(target,patched);
console.log("SSE_FIRST10_SETUP_SOURCE_UPDATED",JSON.stringify({
 oldBytes:current.length,newBytes:patched.length,
 before:before.body.length,after:after.body.length,
 sha256:createHash("sha256").update(patched).digest("hex")
}));
