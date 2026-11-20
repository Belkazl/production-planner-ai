import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
const root=process.argv[2];if(!root)throw Error("SSE_BUN_SOURCE_ROOT_REQUIRED");
const path=resolve(root,"python-ga-upstream.mjs");
let s=readFileSync(path,"utf8");
const edit=(before,after,label)=>{
 if(s.split(before).length!==2)throw Error("SSE_BUN_SOURCE_DRIFT_"+label);
 s=s.replace(before,after);
};
if(s.includes("async function stream(req)"))throw Error("SSE_BUN_ALREADY_INSTALLED");
edit("  async function fetchUpstream(req,opts){",
 readFileSync("ops/ovh/sse-stream-v1-20261120/backend-stream.js.txt","utf8")+
 "  async function fetchUpstream(req,opts){","new_worker_stream");
edit("    if(path==='/api/plan-progress'&&req.method==='GET')return progress(req);",
 "    if(path==='/api/plan-progress'&&req.method==='GET')return progress(req);\n"+
 "    if(path==='/api/plan-events'&&req.method==='GET')return stream(req);","route");
writeFileSync(path,s);
console.log("SSE_BUN_NATIVE_PUSH_PATCHED",s.length,createHash("sha256").update(s).digest("hex"));
