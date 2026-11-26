import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {source as oldSource,transformActionsHtml,serverTransformSource as oldTransform} from "../groq-universal-parameters-20261126/actions-ui.mjs";
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,"UNIT_FORMAT_ANCHOR_DRIFT: "+a.slice(0,90));return s.replace(a,b)};
function fix(s){
 s=once(s,' const v=x=>(x==null?"—":typeof x==="object"?JSON.stringify(x):String(x))+(c.unit?" "+c.unit:"");',' const v=x=>x==null?"—":typeof x==="object"?JSON.stringify(x):String(x);\n const quantity=x=>v(x)+(x!=null&&c.unit?" "+c.unit:"");');
 s=once(s,'if(c.after!==undefined)out+=c.before!==undefined?v(c.before)+" → "+v(c.after):v(c.after);','if(c.after!==undefined)out+=c.before!==undefined?quantity(c.before)+" → "+quantity(c.after):quantity(c.after);');
 return s;
}
export const source=fix(oldSource);
export const serverTransform=()=>"\nfunction ppGroqActionsHtml(html){return ("+transformActionsHtml.toString()+")(html,"+JSON.stringify(source)+");}\n";
export function patchAuth(auth){
 return once(auth,oldTransform(),serverTransform());
}
if(process.argv[1]?.endsWith("/groq-parameter-units-20261126/patch.mjs")){
 const [input,output]=process.argv.slice(2);
 assert(input&&output);writeFileSync(output,patchAuth(readFileSync(input,"utf8")),{mode:0o600});
 console.log("PARAMETER_UNITS_EXACT_AUTH_PATCH_PASS");
}
