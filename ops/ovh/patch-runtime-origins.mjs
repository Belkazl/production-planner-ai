// Surgical OVH-only patch applied to a copy of the live Railway app sources.
// No edits are made to the source commit that is currently serving users.
import {readFileSync,writeFileSync} from "node:fs";
import {resolve,join} from "node:path";
const root=resolve(process.argv[2]||"");
if(!root.endsWith("/app"))throw Error("expected checked-out app workspace");
const updates=[
 ["ga-python-state-store.mjs","qa_state_private_origin_required",
  String.raw` if(!(/^http:\/\/[a-z0-9-]+\.railway\.internal:\d+$/.test(String(origin))||(typeof Bun!=="undefined"&&Bun.env?.PP_OVH_STAGING==="1"&&String(origin)==="http://auth-gateway:8080")))throw Error("qa_state_private_origin_required");`],
 ["python-ga-upstream.mjs","private_worker_origin_required",
  String.raw` if(!(/^http:\/\/[a-z0-9-]+\.railway\.internal:\d+$/.test(String(origin))||(typeof Bun!=="undefined"&&Bun.env?.PP_OVH_STAGING==="1"&&String(origin)==="http://ga-worker:8080")))throw Error('private_worker_origin_required');`]
];
for(const [file,marker,replacement] of updates){
 const p=join(root,file);
 const original=readFileSync(p,"utf8");
 const lines=original.split("\n");
 const indices=lines.flatMap((s,i)=>s.includes(marker)?[i]:[]);
 if(indices.length!==1||!lines[indices[0]].includes("railway"))throw Error("stale_source_anchor_"+file);
 lines[indices[0]]=replacement;
 writeFileSync(p,lines.join("\n"));
 console.log("OVH_ONLY_PRIVATE_ORIGIN_PATCH_OK",file);
}
const p=join(root,"auth-runtime.js");
let source=readFileSync(p,"utf8");
const anchor=" if(railwayHost)allowedHosts.add(railwayHost);";
if(source.split(anchor).length!==2)throw Error("auth_origin_anchor_changed");
const patch=anchor + "\n" + [
 ' // Permit same-origin localhost only for explicit, isolated OVH staging.',
 ' if(typeof Bun!=="undefined"&&Bun.env?.PP_OVH_STAGING==="1"',
 '    && parsed.origin==="http://localhost:18082"',
 '    && new URL(req.url).origin==="http://localhost:18082")return true;'
].join("\n");
source=source.replace(anchor,patch);
writeFileSync(p,source);
console.log("OVH_ONLY_LOCAL_AUTH_ORIGIN_PATCH_OK");
