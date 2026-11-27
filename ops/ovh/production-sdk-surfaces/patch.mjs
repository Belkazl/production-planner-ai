import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
const css="\n/* OpenAI Apps SDK UI semantic/primitive surface tokens, same pinned revision as the other controls. */\n#sectionView.pp-sdk-production-editor,\n:not(body):has(> #sectionView.pp-sdk-production-editor:not([hidden]):not([style*=\"display: none\"]):not([style*=\"display:none\"])) {\n color-scheme:light;\n --color-surface:light-dark(var(--gray-0), var(--gray-200));\n--gray-0:light-dark(#ffffff, #0d0d0d);\n--gray-200:light-dark(#cdcdcd, #212121);\n--color-surface-secondary:light-dark(var(--gray-50), var(--gray-100));\n--gray-50:light-dark(#f9f9f9, #131313);\n--gray-100:light-dark(#ededed, #181818);\n--color-surface-elevated:light-dark(var(--gray-0), var(--gray-300));\n--gray-300:light-dark(#afafaf, #303030);\n--color-border:light-dark(var(--alpha-10), var(--alpha-12));\n--alpha-10:color-mix(in oklab, var(--alpha-base) 10%, transparent);\n--alpha-base:light-dark(#0d0d0d, #ffffff);\n--alpha-12:color-mix(in oklab, var(--alpha-base) 12%, transparent);\n--color-text:var(--gray-1000);\n--gray-1000:light-dark(#0d0d0d, #ffffff);\n--color-text-secondary:light-dark(var(--gray-500), var(--gray-700));\n--gray-500:#5d5d5d;\n--gray-700:light-dark(#303030, #afafaf);\n background:var(--color-surface-secondary)!important;\n}\n#sectionView.pp-sdk-production-editor :is(.pp-sdk-production-main-surface,.pp-edit-wrap,.pp-sdk-equipment-card,.pp-sdk-prod-card,.pp-sdk-production-op-card) {\n background:var(--color-surface-elevated)!important;\n border-color:var(--color-border)!important;\n box-shadow:none!important;\n}\n#sectionView.pp-sdk-production-editor .pp-sdk-production-op-head{\n background:var(--color-surface-secondary)!important;\n border-color:var(--color-border)!important;\n}\n#sectionView.pp-sdk-production-editor .pp-sdk-production-op-body{\n background:var(--color-surface)!important;\n border-color:var(--color-border)!important;\n}\n#sectionView.pp-sdk-production-editor :is(.pp-sdk-production-neutral-wrap,.pp-sdk-prod-table-scroll,.pp-rr-table,.pp-rr-table thead,.pp-rr-table tbody,.pp-rr-table tr,.pp-rr-table th,.pp-rr-table td){\n background:transparent!important;\n border-color:var(--color-border)!important;\n}\n#sectionView.pp-sdk-production-editor .pp-sdk-production-op-card :is(.pp-check,.pp-sdk-production-caption) {\n color:var(--color-text-secondary)!important;\n}\n/* Keep SDK button/checkbox/select states and native field semantics untouched. */\n";
function markProductionSurfaces(){
 if(window.__PP_PRODUCTION_SDK_SURFACES_V1__)return;window.__PP_PRODUCTION_SDK_SURFACES_V1__=true;
 const section=document.getElementById("sectionView");if(!section)return;
 let pending=false;
 function enhance(){
  pending=false;
  if(!/^(Production|Производство)$/i.test(section.querySelector(".titlebar h1")?.textContent.trim()||""))return;
  const sequences=[...section.querySelectorAll('[data-of="sequence"]')];
  const branch=(node,root)=>{let p=node;while(p&&p.parentElement!==root)p=p.parentElement;return p};
  function neutral(el){
   if(el&&el!==section&&!el.matches('.pp-sdk-InputContainer,.pp-sdk-TextareaContainer,.pp-sdk-SelectControl,.pp-sdk-production-op-card,.pp-sdk-production-op-head,.pp-sdk-production-op-body,.pp-sdk-production-main-surface,.pp-sdk-prod-card,.pp-edit-wrap,.pp-sdk-equipment-card'))el.classList.add("pp-sdk-production-neutral-wrap");
  }
  for(const sequence of sequences){
   let card=sequence.parentElement;
   while(card&&card!==section&&!card.querySelector("table.pp-rr-table"))card=card.parentElement;
   if(!card||card===section||card.querySelectorAll('[data-of="sequence"]').length!==1)continue;
   const head=branch(sequence,card);
   if(!head||!head.querySelector('[data-of="name"]')||head.querySelector("table.pp-rr-table"))continue;
   card.classList.add("pp-sdk-production-op-card");
   head.classList.add("pp-sdk-production-op-head");head.classList.remove("pp-sdk-production-neutral-wrap");
   for(const table of card.querySelectorAll("table.pp-rr-table")){
    const body=branch(table,card);
    if(body&&body!==head){body.classList.add("pp-sdk-production-op-body");body.classList.remove("pp-sdk-production-neutral-wrap")}
    for(let p=table.parentElement;p&&p!==card;p=p.parentElement)if(p!==body)neutral(p);
   }
   for(const child of head.querySelectorAll("div,label")){
    if(!child.closest(".pp-sdk-InputContainer,.pp-sdk-TextareaContainer,.pp-sdk-SelectControl,.pp-sdk-Button")&&!child.className?.includes?.("pp-sdk-"))neutral(child);
   }
   for(const caption of card.querySelectorAll("strong,b,span,label,div")){
    if(caption.children.length===0&&/^(Resource requirements|Требования к ресурсам|Необходимые ресурсы)$/i.test(caption.textContent.trim()))caption.classList.add("pp-sdk-production-caption");
   }
   let outer=card.parentElement;
   while(outer&&outer!==section&&!outer.querySelector("[data-save]")){neutral(outer);outer=outer.parentElement}
   if(outer&&outer!==section){outer.classList.remove("pp-sdk-production-neutral-wrap");outer.classList.add("pp-sdk-production-main-surface")}
  }
 }
 const schedule=()=>{if(!pending){pending=true;requestAnimationFrame(enhance)}};
 new MutationObserver(schedule).observe(section,{childList:true,subtree:true});
 document.addEventListener("change",e=>{if(e.target?.id==="ppLanguageSelect")schedule()});
 schedule();
}
function transform(html,css,script){
 if(typeof html!=="string"||!html.includes("PP_PLAN_PRODUCTION_SDK_V1")||html.includes('id="ppProductionSdkSurfacesStyle"'))return html;
 if(html.split("</head>").length!==2||html.split("</body>").length!==2)throw Error("Production SDK surface anchors missing");
 return html.replace("</head>",()=>'<style id="ppProductionSdkSurfacesStyle">/* PP_PRODUCTION_SDK_SURFACES_V1 */\n'+css+"</style></head>").replace("</body>",()=>'<script id="ppProductionSdkSurfacesJs">('+script+')();</script></body>');
}
export function patchPreview(html){return transform(html,css,markProductionSurfaces.toString())}
export function patchSource(source){
 const anchor="const assistantHtml=ppPlanProductionSdkPage(";
 assert(!source.includes("function ppProductionSdkSurfacesPage("),"Already installed");
 assert.equal(source.split(anchor).length,2,"Production SDK auth chain");
 const lines=source.split("\n"),i=lines.findIndex(l=>l.includes(anchor));assert(lines[i].trimEnd().endsWith(";"));
 lines[i]=lines[i].replace(anchor,"const assistantHtml=ppProductionSdkSurfacesPage(ppPlanProductionSdkPage(").replace(/;\s*$/,");");
 return lines.join("\n")+"\nfunction ppProductionSdkSurfacesPage(html){return ("+transform.toString()+")(html,"+JSON.stringify(css)+","+JSON.stringify(markProductionSurfaces.toString())+");}\n";
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)writeFileSync(process.argv[3],patchSource(readFileSync(process.argv[2],"utf8")),{mode:0o600});
