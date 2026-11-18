import {readFileSync,writeFileSync,existsSync} from "node:fs";
import {resolve} from "node:path";
const root=process.argv[2];
if(!root)throw Error("OWNER_MODEL_HASH_APP_ROOT_REQUIRED");
const file=resolve(root,"tenant-model-runtime.js");
const source=readFileSync(file,"utf8");
const from='const ppAccountModelHash=m=>require("node:crypto").createHash("sha256").update(JSON.stringify(m)).digest("hex");';
const to='// Gantt mutates equipment with __ppid while rendering. It is UI metadata, not a production model revision.\n'+
'const ppAccountModelHash=m=>require("node:crypto").createHash("sha256").update(JSON.stringify(m,(key,value)=>key==="__ppid"?undefined:value)).digest("hex");';
if(source.split(from).length!==2)throw Error("MODEL_HASH_ANCHOR_MISSING_OR_CHANGED");
for(const marker of ["ppAccountPlanBelongsToModel","function ppReadAccountModelUncached","ppAccountModelPending","PP_AUTH_GATEWAY_ORIGIN"]){
 if(!source.includes(marker))throw Error("ACCOUNT_GUARD_NOT_PRESENT_"+marker);
}
if(source.includes('key==="__ppid"?undefined:value'))throw Error("ALREADY_PATCHED");
const updated=source.replace(from,to);
writeFileSync(file,updated);
// The pinned preflight may already have generated index.ts. Patch its derived
// copy too, so the Docker preflight tests the exact change shipped by the
// production builder. Production itself regenerates index.ts from runtime.
const compiled=resolve(root,"index.ts");
let compiledChanged=false;
if(existsSync(compiled)){
 const oldCompiled=readFileSync(compiled,"utf8");
 if(oldCompiled.includes(from)){
  if(oldCompiled.split(from).length!==2)throw Error("COMPILED_MODEL_HASH_MULTIPLE_ANCHORS");
  writeFileSync(compiled,oldCompiled.replace(from,to));
  compiledChanged=true;
 }
}
console.log("PP_ACCOUNT_MODEL_HASH_IGNORE_GANTT_ONLY_RUNTIME_ID_PATCHED",source.length,updated.length,"compiled",compiledChanged);
