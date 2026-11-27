import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {css} from "./build.mjs";
export function installToolbar(){
 if(window.__PP_EQUIPMENT_SDK_TOOLBAR_V1__)return;
 window.__PP_EQUIPMENT_SDK_TOOLBAR_V1__=true;
 const section=document.getElementById("sectionView");if(!section)return;
 let scheduled=false;
 function enhance(){
  scheduled=false;
  const table=section.querySelector("table:has(.pp-perf-value-cell)");
  if(!table)return;
  const card=table.closest(".pp-edit-wrap")||table.closest(".pp-sdk-equipment-card");
  const head=card?.querySelector(".pp-edit-head");if(!head)return;
  const add=head.querySelector("button[data-pp-add]"),save=head.querySelector("button[data-pp-save]");
  if(!add||!save)return;
  head.classList.add("pp-sdk-equipment-toolbar");
  for(const [button,variant] of [[add,"outline"],[save,"solid"]]){
   if(!button.classList.contains("pp-sdk-Button")){
    // Keep the native node and events; remove only superseded visual classes.
    button.classList.remove("pp-edit-btn","primary");
    button.classList.add("pp-sdk-Button");
    button.dataset.size="xl";button.dataset.variant=variant;button.dataset.color="primary";button.dataset.pill="";
   }
   let inner=button.querySelector(":scope>.pp-sdk-ButtonInner");
   if(!inner){
    inner=document.createElement("span");inner.className="pp-sdk-ButtonInner";
    while(button.firstChild)inner.append(button.firstChild);
    button.append(inner);
   }
   button.toggleAttribute("data-disabled",button.disabled);
  }
 }
 const schedule=()=>{if(!scheduled){scheduled=true;requestAnimationFrame(enhance)}};
 new MutationObserver(schedule).observe(section,{childList:true,subtree:true,attributes:true,attributeFilter:["disabled"]});
 schedule();
}
export const script='<script id="ppEquipmentSdkToolbarJs">/* PP_EQUIPMENT_SDK_TOOLBAR_V1 */('+installToolbar.toString()+')();</script>';
export function transformPage(html,style,script){
 if(typeof html!=="string"||html.includes('id="ppEquipmentSdkToolbarJs"')||!html.includes("PP_EQUIPMENT_SDK_XL_REGULAR_V1"))return html;
 if(html.split("</head>").length!==2||html.split("</body>").length!==2)throw Error("EQUIPMENT_TOOLBAR_PAGE_ANCHOR");
 return html.replace("</head>",()=>'<style id="ppEquipmentSdkToolbarStyle">'+style+'</style></head>').replace("</body>",()=>script+"</body>");
}
export function patchPreview(html){return transformPage(html,css,script)}
export function patchAuth(s){
 assert(!s.includes("function ppEquipmentSdkToolbarPage("));
 const lines=s.split("\n"),indices=lines.map((l,i)=>l.includes("const assistantHtml=ppPlanDefaultNavPage(")?i:-1).filter(i=>i>=0);
 assert.equal(indices.length,1,"EQUIPMENT_TOOLBAR_AUTH_CHAIN");
 const i=indices[0];assert(lines[i].trim().endsWith(";"));
 lines[i]=lines[i].replace("const assistantHtml=","const assistantHtml=ppEquipmentSdkToolbarPage(").replace(/;\s*$/,");");
 return lines.join("\n")+"\nfunction ppEquipmentSdkToolbarPage(html){return ("+transformPage.toString()+")(html,"+JSON.stringify(css)+","+JSON.stringify(script)+");}\n";
}
if(process.argv[1]?.endsWith("/equipment-sdk-toolbar-20261127/patch.mjs")){
 const [before,after]=process.argv.slice(2);
 writeFileSync(after,patchAuth(readFileSync(before,"utf8")),{mode:0o600});
 console.log("EQUIPMENT_TOOLBAR_EXACT_AUTH_PATCH_PASS");
}
