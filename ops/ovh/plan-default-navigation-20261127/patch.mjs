import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";

export function installSidebar(){
 const side=document.querySelector(".side");if(!side)return;
 const matches=(el,key,labels)=>el.querySelector('[data-pp-solar-holder="'+key+'"]')||labels.includes((el.getAttribute("data-pp-en-label")||el.textContent||"").trim().toLowerCase());
 const items=[...side.querySelectorAll(".item")];
 const chat=items.find(el=>matches(el,"chat",["chat","чат"]));
 const plan=items.find(el=>matches(el,"plan",["plan","план"]));
 if(!chat||!plan)return;
 // Keep the legacy node and its index for existing native section mappings.
 // It is no longer a navigable or visible tab.
 chat.setAttribute("data-pp-nav-chat-hidden","");
 chat.setAttribute("aria-hidden","true");
 chat.setAttribute("tabindex","-1");
 chat.inert=true;
 if(chat.classList.contains("active")){
   items.forEach(el=>el.classList.remove("active"));
   plan.classList.add("active");
 }
 window.__PP_PLAN_DEFAULT_NAV_V1__=true;
}
export function transformPage(html,script,css){
 if(typeof html!=="string"||html.includes('id="ppPlanDefaultNavJs"')||!html.includes('id="ppPlanningStartJs"'))return html;
 const manager=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter(m=>/\bid=["']projectManagerJsV2["']/.test(m[1]));
 if(manager.length!==1)throw Error("PLAN_DEFAULT_NAV_MANAGER_ANCHOR");
 const match=manager[0],body=match[2];
 const old="const chat=[...document.querySelectorAll('.side .item')].find(x=>x.textContent.trim()==='Чат');if(chat){document.querySelectorAll('.side .item').forEach(x=>x.classList.remove('active'));chat.classList.add('active')}";
 const next="const planTab=[...document.querySelectorAll('.side .item')].find(x=>x.querySelector('[data-pp-solar-holder=\"plan\"]')||x.getAttribute('data-pp-en-label')==='Plan'||['План','Plan'].includes(x.textContent.trim()));if(planTab){document.querySelectorAll('.side .item').forEach(x=>x.classList.remove('active'));planTab.classList.add('active')}";
 if(body.split(old).length!==2||html.split("</head>").length!==2||html.split("</body>").length!==2)throw Error("PLAN_DEFAULT_NAV_EXACT_ANCHOR");
 const offset=match.index+match[0].indexOf(">")+1;
 const replaced=html.slice(0,offset)+body.replace(old,()=>next)+html.slice(offset+body.length);
 return replaced.replace("</head>",()=>css+"</head>").replace("</body>",()=>script+"</body>");
}
export const css='<style id="ppPlanDefaultNavStyle">.side .item[data-pp-nav-chat-hidden],.side .item[data-pp-en-label="Chat"],.side .item:has([data-pp-solar-holder="chat"]){display:none!important}</style>';
export const script='<script id="ppPlanDefaultNavJs">/* PP_PLAN_DEFAULT_NAV_V1 */('+installSidebar.toString()+')();</script>';
export function patchPreview(html){return transformPage(html,script,css)}
export function patchAuth(s){
 assert(!s.includes("function ppPlanDefaultNavPage("));
 const lines=s.split("\n"),indices=lines.map((l,i)=>l.includes("const assistantHtml=ppPlanningStartPage(")?i:-1).filter(i=>i>=0);
 assert.equal(indices.length,1,"PLAN_DEFAULT_NAV_AUTH_CHAIN");
 const i=indices[0];assert(lines[i].trim().endsWith(";"));
 lines[i]=lines[i].replace("const assistantHtml=","const assistantHtml=ppPlanDefaultNavPage(").replace(/;\s*$/,");");
 return lines.join("\n")+"\nfunction ppPlanDefaultNavPage(html){return ("+transformPage.toString()+")(html,"+JSON.stringify(script)+","+JSON.stringify(css)+");}\n";
}
if(process.argv[1]?.endsWith("/plan-default-navigation-20261127/patch.mjs")){
 const [before,after]=process.argv.slice(2);
 writeFileSync(after,patchAuth(readFileSync(before,"utf8")),{mode:0o600});
 console.log("PLAN_DEFAULT_NAV_EXACT_AUTH_PATCH_PASS");
}
