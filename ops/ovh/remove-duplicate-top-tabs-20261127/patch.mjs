import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
export function ppFindTopNav(doc){
 const norm=s=>String(s||"").replace(/\s+/g," ").trim().toLowerCase();
 const names=new Map([["projects","projects"],["проекты","projects"],["planning","planning"],["планирование","planning"],["analytics","analytics"],["аналитика","analytics"],["scenarios","scenarios"],["сценарии","scenarios"],["documents","documents"],["документы","documents"]]);
 const keys=["projects","planning","analytics","scenarios","documents"];
 const groups=[];
 for(const node of doc.querySelectorAll("header,nav,div,ul,ol")){
  if(node.closest(".side,#sectionView,#planView")||node.children.length<5||node.children.length>16)continue;
  const rows=[...node.children].map(item=>({item,key:names.get(norm(item.textContent))})).filter(row=>row.key);
  if(rows.length===5&&keys.every(k=>rows.filter(r=>r.key===k).length===1))groups.push({node,rows});
 }
 return groups.length===1?groups[0]:null;
}
export function ppHideDuplicateTopTabs(find){
 const hide=()=>{
  const group=find(document);
  if(!group)return false;
  group.node.setAttribute("data-pp-primary-nav","1");
  for(const {item,key} of group.rows){
   if(key==="analytics"||key==="scenarios"){
    item.setAttribute("data-pp-duplicate-top-tab",key);
    item.setAttribute("aria-hidden","true");
   }
  }
  return true;
 };
 if(!hide()&&document.readyState==="loading")document.addEventListener("DOMContentLoaded",hide,{once:true});
}
export function transformTopNav(html,style,script){
 if(typeof html!=="string"||html.includes("PP_HIDE_DUPLICATE_TOP_TABS_V1")||
   !html.includes("PP_WEEKLY_CALENDAR_LANGUAGE_V2")||
   html.split("</head>").length!==2||html.split("</body>").length!==2)return html;
 return html.replace("</head>",style+"</head>").replace("</body>",script+"</body>");
}
export const css='<style id="ppHideDuplicateTopTabs">[data-pp-primary-nav="1"] > [data-pp-duplicate-top-tab]{display:none!important}</style>';
export const script='<script id="ppHideDuplicateTopTabsJs">/* PP_HIDE_DUPLICATE_TOP_TABS_V1 */('+ppHideDuplicateTopTabs.toString()+')(('+ppFindTopNav.toString()+'));</script>';
export function patchSource(auth){
 assert(!auth.includes("function ppPrimaryNavPage("),"TOP_NAV_ALREADY_INSTALLED");
 const before="const assistantHtml=ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded))))))));";
 const after="const assistantHtml=ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded)))))))));";
 assert.equal(auth.split(before).length,2,"TOP_NAV_AUTH_ANCHOR_DRIFT");
 const append="\n// PP_HIDE_DUPLICATE_TOP_TABS_V1\nfunction ppPrimaryNavPage(html){return ("+transformTopNav.toString()+")(html,"+JSON.stringify(css)+","+JSON.stringify(script)+");}\n";
 const result=auth.replace(before,after)+append;
 assert.equal(result.slice(0,-append.length).replace(after,before),auth);
 return result;
}
if(process.argv[1]?.endsWith("/remove-duplicate-top-tabs-20261127/patch.mjs")){
 const [input,output]=process.argv.slice(2);assert(input&&output);
 writeFileSync(output,patchSource(readFileSync(input,"utf8")),{mode:0o600});
 console.log("TOP_NAV_EXACT_PATCH_PASS");
}
