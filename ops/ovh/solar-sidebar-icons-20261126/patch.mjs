import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {icons} from "./icons.mjs";
export const css="<style id=\"ppSolarSidebarIconsV1\">\n.side .item [data-pp-solar-holder] {\n  box-sizing:border-box!important;\n  width:var(--pp-solar-w,22px)!important;\n  height:var(--pp-solar-h,22px)!important;\n  min-width:var(--pp-solar-w,22px)!important;\n  flex-shrink:0;\n  padding:0!important;\n  border:0!important;\n  border-radius:0!important;\n  box-shadow:none!important;\n  background:none!important;\n  color:inherit!important;\n  overflow:visible!important;\n}\n.side .item [data-pp-solar-holder]::before,\n.side .item [data-pp-solar-holder]::after {content:none!important;display:none!important}\n.side .item [data-pp-solar-holder] > svg[data-pp-solar-icon] {\n  display:block!important;width:100%!important;height:100%!important;color:inherit!important;\n}\n.side .item svg[data-pp-solar-icon] {vertical-align:middle;pointer-events:none}\n</style>";
export function installSolarIcons(icons){
 const rail=document.querySelector(".side");if(!rail)return;
 const NS="http://www.w3.org/2000/svg";
 const norm=s=>String(s||"").replace(/\s+/g," ").trim().toLocaleLowerCase();
 const byName=new Map(icons.flatMap(i=>i.names.map(n=>[norm(n),i])));
 function pick(item){
  const direct=[...item.children];
  const svg=direct.find(e=>e.localName==="svg");
  const named=direct.find(e=>e.matches(".ico,.icon,.ic,.glyph,[class*='icon'],[class*='ico']")&&!byName.has(norm(e.textContent)));
  const empty=direct.find(e=>!norm(e.textContent)&&!e.matches("button,input,select,textarea,a"));
  return svg||named||empty||null;
 }
 function render(){
  for(const item of rail.querySelectorAll(".item")){
   const entry=byName.get(norm(item.textContent))||[...item.children].map(e=>byName.get(norm(e.textContent))).find(Boolean);
   if(!entry)continue;
   const present=item.querySelector("svg[data-pp-solar-icon]");
   if(present?.getAttribute("data-pp-solar-icon")===entry.icon)continue;
   const holder=pick(item);if(!holder)continue;
   // Preserve the old icon's box and the native item/event handlers.
   const box=holder.getBoundingClientRect(),computed=getComputedStyle(holder);
   const width=box.width>0?box.width:parseFloat(computed.width)||22;
   const height=box.height>0?box.height:parseFloat(computed.height)||22;
   if(width<10||width>60||height<10||height>60)continue;
   let svg;
   if(holder.localName==="svg"){svg=holder}
   else{
    svg=document.createElementNS(NS,"svg");
    holder.replaceChildren(svg);
   }
   holder.setAttribute("data-pp-solar-holder",entry.key);
   holder.style.setProperty("--pp-solar-w",width+"px");
   holder.style.setProperty("--pp-solar-h",height+"px");
   svg.setAttribute("viewBox","0 0 24 24");
   svg.setAttribute("width","24");svg.setAttribute("height","24");
   svg.setAttribute("aria-hidden","true");svg.setAttribute("focusable","false");
   svg.setAttribute("data-pp-solar-icon",entry.icon);
   svg.innerHTML=entry.body;
   const metadata=document.createElementNS(NS,"metadata");
   metadata.textContent="Solar Linear by 480 Design — CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/ — original SVG paths, color inherited from navigation";
   svg.prepend(metadata);
  }
 }
 render();
 // Only observe the navigation itself; don't watch the Gantt, chat or optimizer.
 let scheduled=false;
 const observer=new MutationObserver(()=>{
  if(scheduled)return;scheduled=true;
  queueMicrotask(()=>{scheduled=false;render()});
 });
 observer.observe(rail,{childList:true,subtree:true,characterData:true});
}
export function transformSolarNav(html,style,script){
 if(typeof html!=="string"||html.includes('id="ppSolarSidebarIconsV1"')||!html.includes("PP_GROQ_ASSISTANT_UI_V1")||html.split("</head>").length!==2||html.split("</body>").length!==2)return html;
 const credit='<!-- Solar Linear icons by 480 Design, licensed CC BY 4.0: https://creativecommons.org/licenses/by/4.0/ . Source: https://www.svgrepo.com/collection/solar-linear-icons/ ; embedded original paths, inherited color. -->';
 return html.replace("</head>",credit+style+"</head>").replace("</body>",script+"</body>");
}
export const script='<script id="ppSolarSidebarIconsScript">('+installSolarIcons.toString()+')('+JSON.stringify(icons).replace(/</g,"\\u003c")+');</script>';
export function patchSource(auth){
 assert(!auth.includes("function ppSolarNavHtml("),"SOLAR_NAV_ALREADY_INSTALLED");
 const anchor="const assistantHtml=ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded)))));";
 const replacement="const assistantHtml=ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded))))));";
 assert.equal(auth.split(anchor).length,2,"SOLAR_NAV_AUTH_ANCHOR_DRIFT");
 const append="\n// PP_SOLAR_SIDEBAR_ICONS_V1\nfunction ppSolarNavHtml(html){return ("+transformSolarNav.toString()+")(html,"+JSON.stringify(css)+","+JSON.stringify(script)+");}\n";
 const result=auth.replace(anchor,replacement)+append;
 assert.equal(result.slice(0,-append.length).replace(replacement,anchor),auth);
 return result;
}
if(process.argv[1]?.endsWith("/solar-sidebar-icons-20261126/patch.mjs")){
 const [input,output]=process.argv.slice(2);assert(input&&output);
 writeFileSync(output,patchSource(readFileSync(input,"utf8")),{mode:0o600});
 console.log("SOLAR_NAV_EXACT_AUTH_PATCH_PASS");
}
