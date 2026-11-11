// OVH-only guard: do not turn an outdated HTML compatibility transformer
// into HTTP 502 for an already authenticated LiftOrbit account.
// This patch is applied to the pinned application source copy before image build.
import {readFileSync,writeFileSync} from "node:fs";
import {resolve,join} from "node:path";
const root=resolve(process.argv[2]||"");
if(!root.endsWith("/app"))throw Error("REPAIR_REQUIRES_PINNED_APP_WORKTREE");
const file=join(root,"auth-runtime.js");
let source=readFileSync(file,"utf8");
function once(oldText,newText,label){
 const n=source.split(oldText).length-1;
 if(n!==1)throw Error("REPAIR_ANCHOR_"+label+"_"+n);
 source=source.replace(oldText,newText);
}
const fallback=`
async function ppSafePlannerUiForAuthenticatedUser(req){
 try{
  return await handler(req);
 }catch(error){
  // A legacy HTML-rewrite module expects exact source anchors from the old
  // planner. If a newer planner does not contain them, serve its own page.
  // Never catch auth errors, API errors, arbitrary exceptions, or data writes.
  const code=String(error?.message||"");
  if(code!=="PP_OPT_ETALON_DECISION_ANCHOR_MISSING")throw error;
  console.warn("LIFTORBIT_UI_COMPATIBILITY_FALLBACK",code);
  const upstream=await fetch(PP_PLANNER_HTML_ORIGIN+"/",{
   method:"GET",
   headers:{"accept":"text/html"},
   redirect:"error",
   signal:AbortSignal.timeout(20000),
   cache:"no-store"
  });
  if(!upstream.ok)throw error;
  const type=(upstream.headers.get("content-type")||"").toLowerCase();
  if(!type.includes("text/html"))throw error;
  const raw=await upstream.text();
  if(!/<!doctype html|<html[\\s>]/i.test(raw)||!/<\\/body>/i.test(raw))throw error;
  // The verified upstream fallback was missing all etalon UI modules. Restore
  // *the same frozen module assets already built into the pinned app* without
  // changing models, saved plans, auth, database persistence or GA endpoints.
  const modules=[
    ["gantt",typeof PP_GANTT_INLINE==="string"?PP_GANTT_INLINE:""],
    ["secondary",typeof PP_SECONDARY_GANTTS_INLINE==="string"?PP_SECONDARY_GANTTS_INLINE:""],
    ["stop",typeof PP_STOP_INLINE==="string"?PP_STOP_INLINE:""],
    ["details",typeof PP_GANTT_DETAILS_INLINE==="string"?PP_GANTT_DETAILS_INLINE:""],
    ["orders",typeof PP_ORDER_STACKED_UI_INLINE==="string"?PP_ORDER_STACKED_UI_INLINE:""],
    ["restart",typeof PP_START_OVER_INLINE==="string"?PP_START_OVER_INLINE:""],
    ["documents",typeof PP_DOCUMENTS_INLINE==="string"?PP_DOCUMENTS_INLINE:""],
    ["language",typeof PP_LANGUAGE_INLINE==="string"?PP_LANGUAGE_INLINE:""]
  ];
  const required=["gantt","stop","restart","language"];
  if(required.some(name=>!modules.find(m=>m[0]===name)?.[1]))throw error;
  const enhanced=raw.replace("</body>",modules.map(m=>m[1]).join("")+"</body>");
  return new Response(enhanced,{
   status:200,
   headers:{"content-type":"text/html; charset=utf-8",
            "cache-control":"no-store","x-liftorbit-ui":"etalon-modules-compat"}
  });
 }
}
`;
once("async function ppAuthenticatedHandler(req){",fallback+"\nasync function ppAuthenticatedHandler(req){","safe_wrapper_inject");
once(' if(req.method==="GET"&&path==="/"){\n  const res=await handler(req);',
     ' if(req.method==="GET"&&path==="/"){\n  const res=await ppSafePlannerUiForAuthenticatedUser(req);',
     "protected_root_only");
if(!source.includes("ppSafePlannerUiForAuthenticatedUser(req)")||!source.includes('if(code!=="PP_OPT_ETALON_DECISION_ANCHOR_MISSING")'))
 throw Error("REPAIR_GUARD_MISSING");
writeFileSync(file,source);
console.log("OVH_AUTHENTICATED_HTML_COMPATIBILITY_GUARD_APPLIED");
