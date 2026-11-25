import {readFileSync,writeFileSync} from "node:fs";
import assert from "node:assert/strict";
const [details,language,newDetails,newLanguage]=process.argv.slice(2);
function replaceOnce(text,from,to){
 assert.equal(text.split(from).length,2,"Unexpected source at "+from);
 return text.replace(from,()=>to);
}
const original=readFileSync(details,"utf8");
const name='val(first(op,["operation_name","name"]))';
let updated=replaceOnce(original,' const title=kind==="setup"', ' const operationName='+name+';\n const title=kind==="setup"');
updated=replaceOnce(updated,':'+name+'||"Операция";',':operationName||"Операция";');
updated=replaceOnce(updated,'heading.textContent=title;',`if(operationName&&!["setup","delivery","consumption","blocked"].includes(kind))heading.setAttribute("translate","no");
 heading.textContent=title;`);
writeFileSync(newDetails,updated);
const i18n=readFileSync(language,"utf8");
writeFileSync(newLanguage,replaceOnce(i18n,'const parent=node.parentElement;','const parent=node.parentElement;\n if(parent.closest(\'[translate="no"]\'))return;'));
