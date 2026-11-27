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
const assistantCss=".assist.pp-sdk-assistant{--color-surface:light-dark(var(--gray-0), var(--gray-200));\n--gray-0:light-dark(#ffffff, #0d0d0d);\n--gray-200:light-dark(#cdcdcd, #212121);\n--color-text:var(--gray-1000);\n--gray-1000:light-dark(#0d0d0d, #ffffff);\n--color-border:light-dark(var(--alpha-10), var(--alpha-12));\n--alpha-10:color-mix(in oklab, var(--alpha-base) 10%, transparent);\n--alpha-base:light-dark(#0d0d0d, #ffffff);\n--alpha-12:color-mix(in oklab, var(--alpha-base) 12%, transparent);\n--font-sans:ui-sans-serif, -apple-system, system-ui, \"Segoe UI\", \"Noto Sans\", \"Helvetica\",\n    \"Arial\", \"Apple Color Emoji\", \"Segoe UI Emoji\", \"Segoe UI Symbol\", sans-serif;\n--font-text-sm-size:0.875rem;\n--font-text-sm-line-height:1.25rem;\n--spacing:0.25rem;\n--font-text-md-size:1rem;\n--font-text-md-line-height:1.5rem;\n--font-weight-semibold:600;\n--font-text-xs-size:0.75rem;\n--font-text-xs-line-height:1.125rem;\n--gray-150:light-dark(#dfdfdf, #1c1c1c);\n--color-background-primary-soft:light-dark(var(--gray-100), var(--gray-300));\n--gray-100:light-dark(#ededed, #181818);\n--gray-300:light-dark(#afafaf, #303030);\n--radius-2xl:1rem;\n--color-text-secondary:light-dark(var(--gray-500), var(--gray-700));\n--gray-500:#5d5d5d;\n--gray-700:light-dark(#303030, #afafaf);\n--font-weight-medium:500;\n--font-weight-normal:400;\n--color-text-tertiary:light-dark(var(--gray-400), var(--gray-600));\n--gray-400:light-dark(#8f8f8f, #414141);\n--gray-600:light-dark(#414141, #8f8f8f);\n--control-size-xl:2.5rem;\n--radius-full:9999px;}\n\n/* Chat layout uses existing SDK surface, typography and control tokens. */\n.assist.pp-sdk-assistant{\n color-scheme:light;background:var(--color-surface)!important;color:var(--color-text)!important;\n border-color:var(--color-border)!important;box-shadow:none!important;\n font-family:var(--font-sans);font-size:var(--font-text-sm-size);line-height:var(--font-text-sm-line-height);\n gap:calc(var(--spacing)*3);\n}\n.assist.pp-sdk-assistant .hrow {background:transparent!important;border-color:var(--color-border)!important;color:var(--color-text)!important}\n.assist.pp-sdk-assistant .hrow :is(b,strong,h2,h3) {font-family:var(--font-sans);font-size:var(--font-text-md-size);line-height:var(--font-text-md-line-height);font-weight:var(--font-weight-semibold);color:var(--color-text)}\n.assist.pp-sdk-assistant .hrow .online{font-family:var(--font-sans);font-size:var(--font-text-xs-size);line-height:var(--font-text-xs-line-height)}\n.assist.pp-sdk-assistant #messages{\n display:flex;flex-direction:column;align-items:stretch;gap:calc(var(--spacing)*3);padding:0;\n color:var(--color-text);background:transparent!important;border:0;min-width:0;\n scrollbar-color:var(--gray-150) transparent;scrollbar-width:thin;\n}\n.assist.pp-sdk-assistant #messages .bubble{\n box-sizing:border-box;background:transparent!important;color:var(--color-text)!important;border:0!important;box-shadow:none!important;\n margin:0;padding:calc(var(--spacing)*2) 0;max-width:100%;width:100%;min-width:0;align-self:stretch;\n font-family:var(--font-sans);font-size:var(--font-text-sm-size);line-height:var(--font-text-sm-line-height);\n white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal;\n}\n.assist.pp-sdk-assistant #messages .bubble:is(.me,.user,[data-groq-message=\"user\"]){\n width:fit-content;max-width:90%;align-self:flex-end;margin:0!important;\n padding:calc(var(--spacing)*3) calc(var(--spacing)*4);\n background:var(--color-background-primary-soft)!important;border-radius:var(--radius-2xl);\n}\n.assist.pp-sdk-assistant #messages .bubble[data-groq-action]{\n border:1px solid var(--color-border)!important;border-radius:var(--radius-2xl);\n padding:calc(var(--spacing)*3);background:var(--color-surface)!important;\n}\n.assist.pp-sdk-assistant #messages .bubble[data-groq-action]>div:nth-child(3){\n font-family:var(--font-sans);font-size:var(--font-text-xs-size)!important;line-height:var(--font-text-xs-line-height);color:var(--color-text-secondary)\n}\n.assist.pp-sdk-assistant #messages .bubble[data-groq-action]>div:has(>button){\n display:flex;flex-wrap:wrap;gap:calc(var(--spacing)*2)!important;align-items:center;\n}\n.assist.pp-sdk-assistant :is(#summary,.pp-groq-controls,#ppGroqNotice,#ppGroqStatus){\n font-family:var(--font-sans);font-size:var(--font-text-xs-size);line-height:var(--font-text-xs-line-height);\n background:transparent!important;border-color:var(--color-border);color:var(--color-text-secondary)!important;\n}\n.assist.pp-sdk-assistant #ppGroqStatus:not(:empty){font-weight:var(--font-weight-medium);color:var(--color-text)!important}\n.assist.pp-sdk-assistant .compose{\n display:flex;align-items:flex-end;gap:calc(var(--spacing)*2);min-width:0;background:transparent!important;\n border:0!important;box-shadow:none!important;flex:0 0 auto;\n}\n.assist.pp-sdk-assistant .compose>.pp-sdk-TextareaContainer{\n flex:1 1 0;min-width:0;width:auto;--textarea-min-rows:2;--textarea-max-rows:6;\n background:var(--color-surface)!important;border-radius:var(--radius-2xl);\n}\n.assist.pp-sdk-assistant .compose .pp-sdk-TextareaContainer>textarea#chatInput{\n box-sizing:border-box;display:block;width:100%;min-width:0;min-height:60px;height:60px;max-height:140px;\n border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;outline:0!important;\n padding:var(--textarea-gutter-y) var(--textarea-gutter-x);font-family:var(--font-sans);font-size:var(--font-text-md-size);\n font-weight:var(--font-weight-normal);line-height:var(--font-text-sm-line-height);color:var(--color-text);resize:none;\n}\n.assist.pp-sdk-assistant .compose #chatInput::placeholder{color:var(--color-text-tertiary);opacity:1}\n.assist.pp-sdk-assistant button.pp-sdk-Button{\n box-sizing:border-box;background:transparent!important;border:0!important;box-shadow:none!important;\n min-width:0;min-height:0;max-height:none;margin:0;font-family:var(--font-sans);--scale:0.98;\n color:var(--button-text-color)!important;\n}\n.assist.pp-sdk-assistant button.pp-sdk-Button .pp-sdk-ButtonInner{pointer-events:none}\n.assist.pp-sdk-assistant .compose #chatSend{\n flex:0 0 var(--control-size-xl);width:var(--control-size-xl);height:var(--control-size-xl);\n min-width:var(--control-size-xl);padding:0;border-radius:var(--radius-full);font-size:var(--font-text-md-size);\n}\n.assist.pp-sdk-assistant button.pp-sdk-Button:disabled{cursor:wait}\n";
function markAssistant(){
 if(window.__PP_ASSISTANT_SDK_V1__)return;
 const panel=document.querySelector(".assist");if(!panel)return;
 window.__PP_ASSISTANT_SDK_V1__=true;
 panel.classList.add("pp-sdk-assistant");
 const enhanceButton=(b,variant,send)=>{
  if(!b.classList.contains("pp-sdk-Button")){
   b.removeAttribute("style");b.classList.add("pp-sdk-Button");b.dataset.variant=variant;b.dataset.color="primary";b.dataset.size=send?"xl":"md";b.dataset.pill="";
   if(send)b.dataset.uniform="";
  }
  if(!b.querySelector(":scope>.pp-sdk-ButtonInner")){
   const inner=document.createElement("span");inner.className="pp-sdk-ButtonInner";while(b.firstChild)inner.append(b.firstChild);b.append(inner);
  }
  b.toggleAttribute("data-disabled",b.disabled);
 };
 let queued=false;
 function enhance(){
  queued=false;
  const input=panel.querySelector("#chatInput"),send=panel.querySelector("#chatSend");
  if(input&&!input.parentElement.classList.contains("pp-sdk-TextareaContainer")){
   const wrap=document.createElement("div");wrap.className="pp-sdk-TextareaContainer";wrap.dataset.variant="outline";wrap.dataset.size="xl";
   input.classList.add("pp-sdk-Textarea");input.before(wrap);wrap.append(input);
   input.addEventListener("focus",()=>wrap.dataset.focused="true");input.addEventListener("blur",()=>wrap.removeAttribute("data-focused"));
  }
  if(input)input.parentElement.toggleAttribute("data-disabled",input.disabled);
  if(send){enhanceButton(send,"solid",true);if(!send.hasAttribute("aria-label"))send.setAttribute("aria-label",document.documentElement.lang.startsWith("ru")?"Отправить":"Send message")}
  for(const button of panel.querySelectorAll("button[data-groq-apply],button[data-groq-cancel]"))enhanceButton(button,button.hasAttribute("data-groq-apply")?"solid":"outline",false);
 }
 const schedule=()=>{if(!queued){queued=true;requestAnimationFrame(enhance)}};
 new MutationObserver(schedule).observe(panel,{childList:true,subtree:true,attributes:true,attributeFilter:["disabled"]});
 schedule();
}
function transformAssistant(html,css,script){
 if(typeof html!=="string"||!html.includes("PP_GROQ_ASSISTANT_UI_V1")||html.includes('id="ppAssistantSdkStyle"'))return html;
 const toolbarAnchor='<style id="ppEquipmentSdkToolbarStyle">',taAnchor='<style id="ppOrdersMaterialsSdkStyle">';
 const read=anchor=>{const a=html.indexOf(anchor),b=html.indexOf("</style>",a+anchor.length);if(a<0||b<0)throw Error("Missing SDK CSS "+anchor);return html.slice(a+anchor.length,b)};
 const toolbar=read(toolbarAnchor),cut=toolbar.indexOf("/* LiftOrbit adapter:");
 if(cut<0)throw Error("Shared SDK Button boundary");
 const buttons=toolbar.slice(0,cut).replaceAll("#sectionView .pp-sdk-equipment-toolbar",".assist.pp-sdk-assistant");
 const resource=read(taAnchor),a=resource.indexOf("/* OpenAI Apps SDK UI Textarea"),b=resource.indexOf("/* Scoped integration of the same SDK controls",a);
 if(a<0||b<0)throw Error("Shared SDK Textarea boundary");
 const textarea=resource.slice(a,b).replaceAll("#sectionView.pp-sdk-resource-editor",".assist.pp-sdk-assistant");
 if(!buttons.includes(".pp-sdk-ButtonInner")||!textarea.includes(".pp-sdk-TextareaContainer"))throw Error("SDK components missing");
 if(html.split("</head>").length!==2||html.split("</body>").length!==2)throw Error("Assistant SDK HTML anchor");
 return html.replace("</head>",()=>'<style id="ppAssistantSdkStyle">/* PP_ASSISTANT_SDK_V1 */\n'+buttons+"\n"+textarea+"\n"+css+"</style></head>").replace("</body>",()=>'<script id="ppAssistantSdkJs">('+script+')();</script></body>');
}
export function patchPreview(html){return transformAssistant(transform(html,css,markProductionSurfaces.toString()),assistantCss,markAssistant.toString())}
export function patchSource(source){
 const anchor="const assistantHtml=ppPlanProductionSdkPage(";
 assert(!source.includes("function ppProductionSdkSurfacesPage(")&&!source.includes("function ppAssistantSdkPage("),"Already installed");
 assert.equal(source.split(anchor).length,2,"Production SDK auth chain");
 const lines=source.split("\n"),i=lines.findIndex(l=>l.includes(anchor));assert(lines[i].trimEnd().endsWith(";"));
 lines[i]=lines[i].replace(anchor,"const assistantHtml=ppAssistantSdkPage(ppProductionSdkSurfacesPage(ppPlanProductionSdkPage(").replace(/;\s*$/,"));");
 return lines.join("\n")+"\nfunction ppProductionSdkSurfacesPage(html){return ("+transform.toString()+")(html,"+JSON.stringify(css)+","+JSON.stringify(markProductionSurfaces.toString())+");}\nfunction ppAssistantSdkPage(html){return ("+transformAssistant.toString()+")(html,"+JSON.stringify(assistantCss)+","+JSON.stringify(markAssistant.toString())+");}\n";
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)writeFileSync(process.argv[3],patchSource(readFileSync(process.argv[2],"utf8")),{mode:0o600});
