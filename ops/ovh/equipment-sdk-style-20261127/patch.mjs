import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {css} from "./build.mjs";
export function installEquipmentSDK(){
 if(window.__ppEquipmentSdkInstalled)return;window.__ppEquipmentSdkInstalled=true;
 const root=()=>document.getElementById("sectionView");
 const make=(tag,cls)=>{const n=document.createElement(tag);if(cls)n.className=cls;return n};
 const svg=(path,cls,viewBox="0 0 16 16")=>{
  const s=document.createElementNS("http://www.w3.org/2000/svg","svg");s.setAttribute("class",cls);s.setAttribute("viewBox",viewBox);s.setAttribute("fill","none");s.setAttribute("aria-hidden","true");
  const p=document.createElementNS(s.namespaceURI,"path");p.setAttribute("d",path);p.setAttribute("stroke","currentColor");p.setAttribute("stroke-width","1.5");p.setAttribute("stroke-linecap","round");p.setAttribute("stroke-linejoin","round");s.append(p);return s;
 };
 let open=null,seq=0,scheduled=false;
 const close=(focus=false)=>{
  if(!open)return;const {menu,trigger}=open;open=null;
  trigger.setAttribute("aria-expanded","false");trigger.removeAttribute("data-state");
  if(menu.matches(":popover-open"))menu.hidePopover();menu.remove();
  if(focus&&trigger.isConnected)trigger.focus({preventScroll:true});
 };
 const labelFor=s=>s.selectedOptions[0]?.textContent?.trim()||"";
 const synchronize=(s,t)=>{
  const label=labelFor(s),target=t.querySelector(".pp-sdk-TriggerText");
  if(target.textContent!==label)target.replaceChildren(document.createTextNode(label));
  t.setAttribute("aria-disabled",String(s.disabled));t.tabIndex=s.disabled?-1:0;
  t.toggleAttribute("data-disabled",s.disabled);
 };
 const show=(s,t)=>{
  if(s.disabled)return;if(open?.trigger===t){close(true);return}close();
  const menu=make("div","pp-sdk-MenuList");menu.setAttribute("popover","manual");menu.id=t.getAttribute("aria-controls");menu.setAttribute("role","listbox");
  menu.setAttribute("aria-label",s.getAttribute("aria-label")||"Options");
  const inner=make("div","pp-sdk-MenuInner"),list=make("div","pp-sdk-OptionsList");inner.append(list);menu.append(inner);
  const opts=[...s.options].filter(o=>!o.hidden&&!o.disabled);
  const items=opts.map(o=>{
   const item=make("div","pp-sdk-Option");item.setAttribute("role","option");item.tabIndex=-1;item.setAttribute("aria-selected",String(o.selected));item.toggleAttribute("data-selected",o.selected);
   const content=make("div","pp-sdk-PressableInner"),row=make("div","pp-sdk-OptionInner");
   row.append(svg("M3 8l3 3 7-7","pp-sdk-OptionCheck"),document.createTextNode(o.textContent.trim()));content.append(row);item.append(content);
   const choose=()=>{s.value=o.value;synchronize(s,t);close(true);s.dispatchEvent(new Event("input",{bubbles:true}));s.dispatchEvent(new Event("change",{bubbles:true}));};
   item.addEventListener("click",choose);item.addEventListener("pointerenter",()=>highlight(item));item.addEventListener("focus",()=>highlight(item));item.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();choose()}});
   list.append(item);return item;
  });
  const highlight=item=>{for(const i of items)i.toggleAttribute("data-highlight",i===item)};
  const rect=t.getBoundingClientRect();menu.style.setProperty("--pp-sdk-trigger-width",rect.width+"px");document.body.append(menu);
  menu.showPopover();open={menu,trigger:t,select:s};t.setAttribute("aria-expanded","true");t.setAttribute("data-state","open");
  const h=menu.getBoundingClientRect().height,space=Number.parseFloat(getComputedStyle(menu).getPropertyValue("--spacing"))||4;
  menu.style.left=Math.max(space,Math.min(rect.left,innerWidth-rect.width-space))+"px";
  menu.style.top=Math.max(space,rect.bottom+space+h<=innerHeight?rect.bottom+space:rect.top-h-space)+"px";
  const selected=items.find(i=>i.hasAttribute("data-selected"))||items[0];if(selected){highlight(selected);selected.focus({preventScroll:true})}
  menu.addEventListener("keydown",e=>{
   let n=items.indexOf(document.activeElement);
   if(["ArrowDown","ArrowUp","Home","End"].includes(e.key)){e.preventDefault();const next=e.key==="Home"?0:e.key==="End"?items.length-1:(n+(e.key==="ArrowDown"?1:-1)+items.length)%items.length;items[next]?.focus({preventScroll:true});}
   else if(e.key==="Escape"){e.preventDefault();e.stopPropagation();close(true)}
   else if(e.key==="Tab"){close(true)}
  });
 };
 function enhance(){
  scheduled=false;const section=root(),table=section?.querySelector("table:has(.pp-perf-value-cell)");
  if(open&&!open.trigger.isConnected)close();if(!table)return;
  table.classList.add("pp-sdk-equipment-table");
  let card=table.parentElement;while(card&&card!==section&&!card.querySelector("[data-pp-save]"))card=card.parentElement;
  if(card&&card!==section)card.classList.add("pp-sdk-equipment-card");
  for(const input of table.querySelectorAll("tbody input")){
   if(input.parentElement.classList.contains("pp-sdk-InputContainer"))continue;
   const wrap=make("div","pp-sdk-InputContainer");wrap.setAttribute("data-size","md");wrap.setAttribute("data-variant","outline");wrap.setAttribute("data-pill","");
   input.before(wrap);wrap.append(input);input.classList.add("pp-sdk-Input");
   input.addEventListener("focus",()=>wrap.setAttribute("data-focused","true"));input.addEventListener("blur",()=>wrap.removeAttribute("data-focused"));
   input.addEventListener("invalid",()=>wrap.setAttribute("data-invalid",""));input.addEventListener("input",()=>wrap.removeAttribute("data-invalid"));
  }
  for(const s of table.querySelectorAll("tbody select")){
   let t=s.nextElementSibling;
   if(!t?.classList.contains("pp-sdk-SelectControl")){
    t=make("span","pp-sdk-SelectControl");t.setAttribute("role","combobox");t.setAttribute("aria-haspopup","listbox");t.setAttribute("aria-expanded","false");t.setAttribute("aria-controls","pp-sdk-equipment-options-"+(++seq));t.setAttribute("aria-label",s.getAttribute("aria-label")||"Equipment type");
    t.setAttribute("data-size","xl");t.setAttribute("data-variant","outline");t.setAttribute("data-pill","");t.setAttribute("data-block","");t.setAttribute("data-selected","true");
    const label=make("span","pp-sdk-TriggerText"),indicator=make("span","pp-sdk-IndicatorWrapper");
    indicator.append(svg("M1 1l4.5 4 4.5-4","pp-sdk-DropdownIcon pp-sdk-DropdownIconChevron","0 0 11 6"));t.append(label,indicator);
    s.classList.add("pp-sdk-native-select");s.tabIndex=-1;s.setAttribute("aria-hidden","true");s.after(t);
    t.addEventListener("click",()=>show(s,t));t.addEventListener("keydown",e=>{if([" ","Enter","ArrowDown","ArrowUp"].includes(e.key)){e.preventDefault();e.stopPropagation();show(s,t)}else if(e.key==="Escape")close(true)});
    s.addEventListener("change",()=>synchronize(s,t));s.addEventListener("focus",()=>t.focus({preventScroll:true}));
   }
   synchronize(s,t);
  }
 }
 const schedule=()=>{if(!scheduled){scheduled=true;requestAnimationFrame(enhance)}};
 const start=()=>{
  new MutationObserver(ms=>{const section=root();if(ms.some(m=>section&&(section.contains(m.target)||m.target===section.parentElement||[...m.addedNodes].some(n=>n===section||n.nodeType===1&&n.contains(section)))))schedule()}).observe(document.body,{childList:true,subtree:true,characterData:true});
  document.addEventListener("pointerdown",e=>{if(open&&!open.menu.contains(e.target)&&!open.trigger.contains(e.target))close()},true);
  document.addEventListener("change",e=>{if(e.target.id==="ppLanguageSelect"){close();schedule()}},true);
  window.addEventListener("resize",()=>close(),{passive:true});document.addEventListener("scroll",e=>{if(open&&!open.menu.contains(e.target))close()},{capture:true,passive:true});
  schedule();
 };
 if(document.body)start();else document.addEventListener("DOMContentLoaded",start,{once:true});
}
export function transformSDK(html,css,script){
 if(typeof html!=="string"||!html.includes("PP_EQUIPMENT_CALCULATION_MODES_V1")||html.includes("PP_EQUIPMENT_SDK_STYLE_V1"))return html;
 const old=/<style id="ppPerformanceColumnsStyle">[\s\S]*?<\/style>/g;
 if([...html.matchAll(old)].length!==1||html.split("</head>").length!==2||html.split("</body>").length!==2)return html;
 return html.replace(old,"").replace("</head>",()=>'<style id="ppEquipmentSDKStyle">/* PP_EQUIPMENT_SDK_STYLE_V1 */\n'+css+'</style></head>').replace("</body>",()=>'<script id="ppEquipmentSDKScript">('+script+')();</script></body>');
}
export function transformPage(html){return transformSDK(html,css,installEquipmentSDK.toString())}
export function patchSource(auth){
 const anchors=["const assistantHtml=ppCalculationModesPage(ppEquipmentPerformanceUnitsPage(ppEquipmentGroupsPage(ppProjectCardsLanguagePage(ppHideLaunchSettingsPage(ppLaunchAnalyticsPage(ppBottleneckLanguagePage(ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded)))))))))))))))))));","const assistantHtml=ppCalculationModesPage(ppPerformanceColumnsPage(ppEquipmentPerformanceUnitsPage(ppEquipmentGroupsPage(ppProjectCardsLanguagePage(ppHideLaunchSettingsPage(ppLaunchAnalyticsPage(ppBottleneckLanguagePage(ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded))))))))))))))))))));"];
 assert(!auth.includes("function ppEquipmentSDKPage("),"already installed");
 const matches=anchors.filter(a=>auth.split(a).length===2);assert.equal(matches.length,1,"SDK auth anchor");
 const before=matches[0],after="const assistantHtml=ppEquipmentSDKPage("+before.slice("const assistantHtml=".length,-1)+");";
 const append="\nfunction ppEquipmentSDKPage(html){return ("+transformSDK.toString()+")(html,"+JSON.stringify(css)+","+JSON.stringify(installEquipmentSDK.toString())+");}\n";
 const result=auth.replace(before,after)+append;assert.equal(result.slice(0,-append.length).replace(after,before),auth);return result;
}
if(process.argv[1]?.endsWith("/equipment-sdk-style-20261127/patch.mjs")){
 const [input,output]=process.argv.slice(2);writeFileSync(output,patchSource(readFileSync(input,"utf8")),{mode:0o600});console.log("EQUIPMENT_SDK_EXACT_PATCH_PASS");
}
