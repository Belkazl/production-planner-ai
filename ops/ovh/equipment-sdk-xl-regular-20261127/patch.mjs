import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {css as oldCss} from "../equipment-sdk-style-20261127/build.mjs";
import {installEquipmentSDK} from "../equipment-sdk-style-20261127/patch.mjs";
const oldScript=installEquipmentSDK.toString();
const sizeAnchor='wrap.setAttribute("data-size","md")';
assert.equal(oldScript.split(sizeAnchor).length,2);
export const newScript=oldScript.replace(sizeAnchor,'wrap.setAttribute("data-size","xl")');
export const newCss=oldCss+'\n/* PP_EQUIPMENT_SDK_XL_REGULAR_V1: official XL controls, regular selector labels. */\n#sectionView .pp-sdk-equipment-table .pp-sdk-SelectControl{--select-control-font-weight:var(--font-weight-normal)}\n.pp-sdk-MenuList .pp-sdk-Option{font-weight:var(--font-weight-normal)}\n';
export function transformPage(html){
 if(typeof html!=="string"||!html.includes("PP_EQUIPMENT_SDK_STYLE_V1")||html.includes("PP_EQUIPMENT_SDK_XL_REGULAR_V1"))return html;
 if(html.split(oldCss).length!==2||html.split(oldScript).length!==2)return html;
 return html.replace(oldCss,()=>newCss).replace(oldScript,()=>newScript);
}
export function patchSource(auth){
 const edits=[[JSON.stringify(oldCss),JSON.stringify(newCss)],[JSON.stringify(oldScript),JSON.stringify(newScript)]];
 assert(!auth.includes("PP_EQUIPMENT_SDK_XL_REGULAR_V1"));
 let result=auth;
 for(const [before,after] of edits){assert.equal(result.split(before).length,2,"installed SDK source anchor drift");result=result.replace(before,()=>after)}
 for(const [before,after] of [...edits].reverse())result=result.replace(after,()=>before);
 assert.equal(result,auth,"all other source bytes unchanged");
 result=auth;
 for(const [before,after] of edits)result=result.replace(before,()=>after);
 return result;
}
if(process.argv[1]?.endsWith("/equipment-sdk-xl-regular-20261127/patch.mjs")){
 const [input,output]=process.argv.slice(2);assert(input&&output);writeFileSync(output,patchSource(readFileSync(input,"utf8")),{mode:0o600});console.log("EQUIPMENT_XL_REGULAR_EXACT_PATCH_PASS");
}
