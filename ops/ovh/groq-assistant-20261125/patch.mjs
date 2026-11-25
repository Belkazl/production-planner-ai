import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {serverTransformSource} from "./assistant-ui.mjs";
const authHash="c60ae5026f9906b0c4fb1496bd9a74e7a579124dd5f647f4d44104e92ccee9e8";
const tenantHash="77544897a595c4effd16f631fd3194c9eab74dace4bdbfc60ba07f59b744fa48";
const sha=s=>createHash("sha256").update(s).digest("hex");
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,"GROQ_PATCH_ANCHOR_DRIFT");return s.replace(a,b)};
export function patch(auth,tenant,assistant){
 assert.equal(sha(auth),authHash,"GROQ_AUTH_SOURCE_DRIFT");
 assert.equal(sha(tenant),tenantHash,"GROQ_TENANT_SOURCE_DRIFT");
 assert(!auth.includes("ppGroqUiHtml")&&!tenant.includes("ppGroqAssistant("),"GROQ_ALREADY_INSTALLED");
 const a='const output=branded.includes("</body>")?branded.replace("</body>",ppLogoutUi+"</body>"):branded;';
 const b='const assistantHtml=ppGroqUiHtml(branded);\n   const output=assistantHtml.includes("</body>")?assistantHtml.replace("</body>",ppLogoutUi+"</body>"):assistantHtml;';
 const hook='async function ppTenantAuthenticated(req){\n const path=new URL(req.url).pathname;';
 const newHook=hook+'\n if(path==="/api/assistant")return ppGroqAssistant(req);';
 const ui=serverTransformSource();
 const runtime="\n"+assistant+"\n";
 const nextAuth=once(auth,a,b)+ui;
 const nextTenant=once(tenant,hook,newHook)+runtime;
 // Undo precisely the two reviewed additions and verify all original bytes.
 assert.equal(once(nextAuth.slice(0,-ui.length),b,a),auth);
 assert.equal(once(nextTenant.slice(0,-runtime.length),newHook,hook),tenant);
 return {"auth-runtime.js":nextAuth,"tenant-model-runtime.js":nextTenant};
}
if(import.meta.main||process.argv[1]?.endsWith("/patch.mjs")){
 const [before,after]=process.argv.slice(2);
 assert(before&&after,"GROQ_PATCH_ARGUMENTS");
 const result=patch(readFileSync(join(before,"auth-runtime.js"),"utf8"),readFileSync(join(before,"tenant-model-runtime.js"),"utf8"),readFileSync(new URL("./assistant-runtime.js",import.meta.url),"utf8"));
 mkdirSync(after,{recursive:true,mode:0o700});
 for(const [name,source] of Object.entries(result))writeFileSync(join(after,name),source,{mode:0o600});
 console.log("GROQ_EXACT_CHAT_ONLY_PATCH_PASS");
}
