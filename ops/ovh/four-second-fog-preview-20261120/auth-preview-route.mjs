import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
const dir=process.argv[2];if(!dir)throw Error("FOG_AUTH_PATCH_DIR_REQUIRED");
const file=resolve(dir,"auth-runtime.js");
let s=readFileSync(file,"utf8");
const anchor='  if(req.method==="GET"&&path==="/"){';
const snippet=[
 '  // An authenticated read-only GA endpoint bypasses legacy APS Gantt/status',
 '  // decorators. It never writes, commits, or modifies the best plan.',
 '  if(req.method==="GET"&&path==="/api/ga-candidate-snapshot"){',
 '    if(typeof ppPythonGAUpstream==="undefined")',
 '      return Response.json({ok:false,error:"ga_snapshot_unavailable"},{status:503});',
 '    const target=new URL(req.url);',
 '    target.pathname="/api/plan-progress";',
 '    if(!target.searchParams.has("ppPreview")&&!target.searchParams.has("ppLight"))',
 '      return Response.json({ok:false,error:"ga_snapshot_mode_required"},{status:400});',
 '    const internal=new Request(target.toString(),{method:"GET",headers:req.headers});',
 '    return ppPythonGAUpstream.fetch(internal,{});',
 '  }'
].join("\n")+"\n";
if(s.split(anchor).length!==2||s.includes("ga_snapshot_mode_required"))throw Error("FOG_AUTH_SOURCE_DRIFT");
s=s.replace(anchor,snippet+anchor);
if(!s.includes("ga-candidate-snapshot")||!s.includes("ppPythonGAUpstream.fetch(internal,{});"))
 throw Error("FOG_AUTH_PATCH_GUARDS");
writeFileSync(file,s);
console.log("FOG_DIRECT_AUTHENTICATED_GA_ROUTE_READY",s.length);
