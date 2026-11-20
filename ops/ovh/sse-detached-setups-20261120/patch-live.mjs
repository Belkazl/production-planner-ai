import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
const root=process.argv[2];
if(!root)throw Error("SSE_DETACHED_SETUPS_APP_ROOT_REQUIRED");
const file=resolve(root,"python-ga-upstream.mjs");
const current=readFileSync(file,"utf8");
const prev=readFileSync("ops/ovh/sse-detached-setups-20261120/baseline-backend.txt","utf8");
const next=readFileSync("ops/ovh/sse-stream-v1-20261120/backend-stream.js.txt","utf8");
if(current.split(prev).length!==2)throw Error("SSE_DETACHED_SETUPS_LIVE_BACKEND_SOURCE_DRIFT");
if(prev===next||!next.includes("const separated=Array.isArray(plan.setup_operations)?")||
   !next.includes("const useBest=setupRows(live)===0&&setupRows(stored)>0;")||
   !next.includes("preview_more_than_ten_operations_per_lane"))
 throw Error("SSE_DETACHED_SETUPS_CANONICAL_GUARDS_MISSING");
const output=current.replace(prev,next);
if(output===current||output.split(next).length!==2)
 throw Error("SSE_DETACHED_SETUPS_BACKEND_PATCH_NONUNIQUE");
writeFileSync(file,output);
console.log("SSE_DETACHED_SETUPS_BACKEND_PATCH",
 "old",createHash("sha256").update(current).digest("hex"),
 "new",createHash("sha256").update(output).digest("hex"));
