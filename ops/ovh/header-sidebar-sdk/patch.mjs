import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
const css=".top.pp-sdk-header,.side.pp-sdk-sidebar,#ppProtectedAccount.pp-sdk-header-account{--color-surface:light-dark(var(--gray-0), var(--gray-200));\n--gray-0:light-dark(#ffffff, #0d0d0d);\n--gray-200:light-dark(#cdcdcd, #212121);\n--color-text:var(--gray-1000);\n--gray-1000:light-dark(#0d0d0d, #ffffff);\n--color-border:light-dark(var(--alpha-10), var(--alpha-12));\n--alpha-10:color-mix(in oklab, var(--alpha-base) 10%, transparent);\n--alpha-base:light-dark(#0d0d0d, #ffffff);\n--alpha-12:color-mix(in oklab, var(--alpha-base) 12%, transparent);\n--font-sans:ui-sans-serif, -apple-system, system-ui, \"Segoe UI\", \"Noto Sans\", \"Helvetica\",\n    \"Arial\", \"Apple Color Emoji\", \"Segoe UI Emoji\", \"Segoe UI Symbol\", sans-serif;\n--font-text-sm-size:0.875rem;\n--font-text-sm-line-height:1.25rem;\n--spacing:0.25rem;\n--control-size-xl:2.5rem;\n--radius-full:9999px;\n--color-text-secondary:light-dark(var(--gray-500), var(--gray-700));\n--gray-500:#5d5d5d;\n--gray-700:light-dark(#303030, #afafaf);\n--control-font-size-md:var(--font-text-sm-size);\n--font-weight-medium:500;\n--color-background-primary-ghost-hover:light-dark(var(--alpha-08), var(--alpha-12));\n--alpha-08:color-mix(in oklab, var(--alpha-base) 8%, transparent);\n--color-background-primary-soft:light-dark(var(--gray-100), var(--gray-300));\n--gray-100:light-dark(#ededed, #181818);\n--gray-300:light-dark(#afafaf, #303030);\n--font-weight-semibold:600;\n--color-ring:light-dark(var(--blue-500), var(--blue-400));\n--blue-500:#0169cc;\n--blue-400:#0285ff;\n--color-surface-secondary:light-dark(var(--gray-50), var(--gray-100));\n--gray-50:light-dark(#f9f9f9, #131313);\n--radius-lg:0.625rem;\n--font-weight-normal:400;\n--font-text-xs-size:0.75rem;\n--input-outline-border-color:var(--color-border-primary-outline);\n--color-border-primary-outline:light-dark(var(--alpha-16), var(--alpha-25));\n--alpha-16:color-mix(in oklab, var(--alpha-base) 16%, transparent);\n--alpha-25:color-mix(in oklab, var(--alpha-base) 25%, transparent);\n--input-outline-border-color-hover:light-dark(var(--alpha-25), var(--alpha-30));\n--alpha-30:color-mix(in oklab, var(--alpha-base) 30%, transparent);\n--control-gutter-pill-scaling:1.33;}\n\n/* Existing navigation layout, styled with pinned OpenAI Apps SDK UI tokens. */\n.top.pp-sdk-header {\n color-scheme:light;background:var(--color-surface)!important;color:var(--color-text)!important;\n border-color:var(--color-border)!important;box-shadow:none!important;\n font-family:var(--font-sans);font-size:var(--font-text-sm-size);line-height:var(--font-text-sm-line-height);\n}\n.top.pp-sdk-header :is(.brand,.logo) {font-family:var(--font-sans);color:var(--color-text)}\n.top.pp-sdk-header .nav{background:transparent!important;border-color:var(--color-border)!important;box-shadow:none!important;gap:var(--spacing)}\n.top.pp-sdk-header .nav>span{\n box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;min-height:var(--control-size-xl);\n padding:0 calc(var(--spacing)*3);border:0!important;border-radius:var(--radius-full)!important;\n background:transparent!important;box-shadow:none!important;color:var(--color-text-secondary)!important;\n font-family:var(--font-sans);font-size:var(--control-font-size-md);line-height:var(--font-text-sm-line-height);\n font-weight:var(--font-weight-medium);white-space:nowrap;cursor:pointer;--pp-lang-font-size:14px;\n}\n.top.pp-sdk-header .nav>span:hover{background:var(--color-background-primary-ghost-hover)!important;color:var(--color-text)!important}\n.top.pp-sdk-header .nav>span[data-pp-sdk-current]{\n background:var(--color-background-primary-soft)!important;color:var(--color-text)!important;\n font-weight:var(--font-weight-semibold)\n}\n.top.pp-sdk-header .nav>span:focus-visible,.side.pp-sdk-sidebar .item:focus-visible{outline:2px solid var(--color-ring);outline-offset:2px}\n.top.pp-sdk-header #activeProjectChip{\n background:var(--color-surface-secondary)!important;border-color:var(--color-border)!important;color:var(--color-text)!important;\n border-radius:var(--radius-full);box-shadow:none;font-family:var(--font-sans);font-size:var(--font-text-sm-size);font-weight:var(--font-weight-medium)\n}\n.side.pp-sdk-sidebar{\n color-scheme:light;background:var(--color-surface-secondary)!important;\n border-color:var(--color-border)!important;box-shadow:none!important;\n color:var(--color-text);font-family:var(--font-sans);font-size:var(--font-text-sm-size);line-height:var(--font-text-sm-line-height)\n}\n.side.pp-sdk-sidebar .item{\n box-sizing:border-box;min-height:var(--control-size-xl);border:0!important;\n border-radius:var(--radius-lg)!important;background:transparent!important;box-shadow:none!important;\n padding:0 calc(var(--spacing)*3);gap:calc(var(--spacing)*2);\n color:var(--color-text)!important;font-family:var(--font-sans);font-size:var(--control-font-size-md);\n line-height:var(--font-text-sm-line-height);font-weight:var(--font-weight-normal);\n --pp-lang-font-size:14px;cursor:pointer;\n}\n.side.pp-sdk-sidebar .item:hover{background:var(--color-background-primary-ghost-hover)!important}\n.side.pp-sdk-sidebar .item.active{background:var(--color-background-primary-soft)!important;color:var(--color-text)!important;font-weight:var(--font-weight-medium)}\n.side.pp-sdk-sidebar .item [data-pp-solar-holder]{color:inherit!important}\n.side.pp-sdk-sidebar :is(.label,.caption,.group-title,.section-title,.side-title){font-family:var(--font-sans);color:var(--color-text-secondary);font-size:var(--font-text-xs-size);font-weight:var(--font-weight-medium)}\n#ppProtectedAccount.pp-sdk-header-account{\n color-scheme:light;color:var(--color-text);font-family:var(--font-sans);\n font-size:var(--font-text-sm-size);line-height:var(--font-text-sm-line-height);\n gap:calc(var(--spacing)*2);\n}\n#ppProtectedAccount.pp-sdk-header-account .pp-language-control{\n font-family:var(--font-sans);font-size:var(--font-text-sm-size);font-weight:var(--font-weight-normal);\n color:var(--color-text-secondary);gap:calc(var(--spacing)*2);\n}\n#ppProtectedAccount.pp-sdk-header-account .pp-language-label{\n color:var(--color-text-secondary);font-size:var(--font-text-sm-size);font-weight:var(--font-weight-normal)\n}\n/* Native language selection retains its actual options and change handler. */\n#ppProtectedAccount.pp-sdk-header-account #ppLanguageSelect{\n box-sizing:border-box;height:var(--control-size-xl);min-height:var(--control-size-xl);\n min-width:110px;width:auto;max-width:150px;\n border:1px solid var(--input-outline-border-color)!important;border-radius:var(--radius-full)!important;\n background-color:var(--color-surface)!important;color:var(--color-text)!important;\n padding:0 calc(var(--spacing)*3);box-shadow:none!important;cursor:pointer;\n font:var(--font-weight-normal) var(--control-font-size-md)/var(--font-text-sm-line-height) var(--font-sans)!important;\n}\n#ppProtectedAccount.pp-sdk-header-account #ppLanguageSelect:hover{border-color:var(--input-outline-border-color-hover)!important}\n#ppProtectedAccount.pp-sdk-header-account #ppLanguageSelect:focus-visible{outline:2px solid var(--color-ring);outline-offset:2px}\n#ppProtectedAccount.pp-sdk-header-account button.pp-sdk-Button {\n box-sizing:border-box;border:0!important;background:transparent!important;box-shadow:none!important;\n min-width:0;min-height:0;max-height:none;margin:0;font-family:var(--font-sans);\n color:var(--button-text-color)!important;--scale:0.98;\n padding:0 calc(var(--button-gutter)*var(--control-gutter-pill-scaling));\n}\n#ppProtectedAccount.pp-sdk-header-account .pp-sdk-ButtonInner{pointer-events:none}\n@media(max-width:650px){\n #ppProtectedAccount.pp-sdk-header-account{gap:var(--spacing)}\n #ppProtectedAccount.pp-sdk-header-account #ppLanguageSelect{min-width:90px;max-width:110px;padding:0 calc(var(--spacing)*2)}\n #ppProtectedAccount.pp-sdk-header-account button.pp-sdk-Button{padding:0 calc(var(--spacing)*2)}\n .top.pp-sdk-header .nav>span{padding:0 calc(var(--spacing)*2)}\n}\n";
function installShell(){
 if(window.__PP_HEADER_SIDEBAR_SDK_V1__)return;
 const top=document.querySelector(".top"),side=document.querySelector(".side");
 if(!top||!side)return;
 window.__PP_HEADER_SIDEBAR_SDK_V1__=true;
 top.classList.add("pp-sdk-header");side.classList.add("pp-sdk-sidebar");
 let scheduled=false;
 function refresh(){
  scheduled=false;
  const projects=document.body.classList.contains("projects-mode");
  for(const item of top.querySelectorAll(".nav>span")){
   const name=(item.dataset.ppEnLabel||item.textContent).trim().toLowerCase();
   const isProjects=["projects","проекты"].includes(name),isPlan=["planning","планирование"].includes(name);
   if(!isProjects&&!isPlan)continue;
   const active=isProjects?projects:!projects;
   item.toggleAttribute("data-pp-sdk-current",active);
   if(active)item.setAttribute("aria-current","page");else item.removeAttribute("aria-current");
  }
  const account=document.getElementById("ppProtectedAccount");
  if(!account)return;
  account.classList.add("pp-sdk-header-account");
  const b=document.getElementById("ppProtectedLogout");
  if(b){
   if(!b.classList.contains("pp-sdk-Button")){
    b.classList.add("pp-sdk-Button");b.dataset.size="xl";b.dataset.variant="outline";b.dataset.color="primary";b.dataset.pill="";
   }
   if(!b.querySelector(":scope>.pp-sdk-ButtonInner")){
    const inner=document.createElement("span");inner.className="pp-sdk-ButtonInner";while(b.firstChild)inner.append(b.firstChild);b.append(inner);
   }
   b.toggleAttribute("data-disabled",b.disabled);
  }
 }
 const schedule=()=>{if(!scheduled){scheduled=true;requestAnimationFrame(refresh)}};
 new MutationObserver(schedule).observe(top,{childList:true,subtree:true,characterData:true});
 new MutationObserver(schedule).observe(document.body,{attributes:true,attributeFilter:["class"]});
 const a=document.getElementById("ppProtectedAccount");
 if(a)new MutationObserver(schedule).observe(a,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:["disabled"]});
 else new MutationObserver(schedule).observe(document.body,{childList:true});
 document.addEventListener("change",e=>{if(e.target?.id==="ppLanguageSelect")schedule()});
 refresh();
}
function transform(html,css,script){
 if(typeof html!=="string"||!html.includes("PP_ASSISTANT_SDK_V1")||html.includes("PP_HEADER_SIDEBAR_SDK_V1"))return html;
 const anchor='<style id="ppEquipmentSdkToolbarStyle">',a=html.indexOf(anchor),b=html.indexOf("</style>",a+anchor.length);
 if(a<0||b<0)throw Error("Shared SDK Button styles missing");
 const toolbar=html.slice(a+anchor.length,b),cut=toolbar.indexOf("/* LiftOrbit adapter:");
 if(cut<0)throw Error("Shared SDK Button boundary");
 const buttons=toolbar.slice(0,cut).replaceAll("#sectionView .pp-sdk-equipment-toolbar","#ppProtectedAccount.pp-sdk-header-account");
 if(!buttons.includes("pp-sdk-ButtonInner"))throw Error("Shared SDK Button component missing");
 if(html.split("</head>").length!==2||html.split("</body>").length!==2)throw Error("Shell SDK HTML anchor");
 return html.replace("</head>",()=>'<style id="ppHeaderSidebarSdkStyle">/* PP_HEADER_SIDEBAR_SDK_V1 */\n'+buttons+"\n"+css+"</style></head>").replace("</body>",()=>'<script id="ppHeaderSidebarSdkJs">('+script+')();</script></body>');
}
export function patchPreview(html){return transform(html,css,installShell.toString())}
export function patchSource(source){
 const anchor="const assistantHtml=ppAssistantSdkPage(";
 assert(!source.includes("function ppHeaderSidebarSdkPage("),"Already installed");
 assert.equal(source.split(anchor).length,2,"Assistant SDK auth chain");
 const lines=source.split("\n"),i=lines.findIndex(l=>l.includes(anchor));assert(lines[i].trimEnd().endsWith(";"));
 lines[i]=lines[i].replace(anchor,"const assistantHtml=ppHeaderSidebarSdkPage(ppAssistantSdkPage(").replace(/;\s*$/,");");
 return lines.join("\n")+"\nfunction ppHeaderSidebarSdkPage(html){return ("+transform.toString()+")(html,"+JSON.stringify(css)+","+JSON.stringify(installShell.toString())+");}\n";
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)writeFileSync(process.argv[3],patchSource(readFileSync(process.argv[2],"utf8")),{mode:0o600});
