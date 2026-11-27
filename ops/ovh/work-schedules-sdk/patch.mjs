import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {pathToFileURL} from "node:url";

const checkboxCss="/* OpenAI Apps SDK UI Checkbox (MIT), pinned 0f00143c7a639906f1621fe58e1b6be7b5bea46d. Native inputs remain the source of truth. */\n#sectionView [data-pp-weekly-calendar]{--gray-200:light-dark(#cdcdcd, #212121);\n--gray-500:#5d5d5d;\n--radius-xs:0.25rem;\n--gray-300:light-dark(#afafaf, #303030);\n--gray-600:light-dark(#414141, #8f8f8f);\n--gray-900:light-dark(#181818, #ededed);\n--color-ring:light-dark(var(--blue-500), var(--blue-400));\n--blue-500:#0169cc;\n--blue-400:#0285ff;\n--gray-150:light-dark(#dfdfdf, #1c1c1c);\n--gray-25:light-dark(#fcfcfc, #101010);\n--gray-0:light-dark(#ffffff, #0d0d0d);\n--gray-100:light-dark(#ededed, #181818);}\n#sectionView [data-pp-weekly-calendar] .pp-sdk-calendar-Checkbox {\n  position: relative;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  flex-shrink: 0;\n  width: 18px;\n  max-width: 18px;\n  height: 18px;\n  padding: 0;\n  border: 1px solid light-dark(var(--gray-200), var(--gray-500));\n  border-radius: var(--radius-xs);\n  background-color: transparent;\n  cursor: pointer;\n  transition:\n    border-color 150ms ease,\n    background-color 150ms ease;\n\n  [data-has-label] & {\n    /* Adjust downward for label line-height - not using center to account for long labels than can wrap. */\n    top: 1px;\n  }\n\n  &:where(:not([data-disabled], [data-state=\"checked\"])) {\n    &:hover {\n      border-color: light-dark(var(--gray-300), var(--gray-600));\n    }\n  }\n\n  &[data-state=\"indeterminate\"],\n  &[data-state=\"checked\"] {\n    border-color: var(--gray-900);\n    background-color: var(--gray-900);\n  }\n\n  &:focus {\n    outline: none;\n  }\n\n  &:focus-visible {\n    outline: 2px solid var(--color-ring);\n    outline-offset: 2px;\n  }\n\n  &[data-disabled] {\n    border-color: light-dark(var(--gray-150), var(--gray-300));\n    background: light-dark(var(--gray-25), var(--gray-200));\n    cursor: not-allowed;\n\n    &[data-state=\"checked\"] {\n      border-color: light-dark(var(--gray-300), var(--gray-200));\n      background-color: light-dark(var(--gray-300), var(--gray-200));\n    }\n  }\n}\n\n#sectionView [data-pp-weekly-calendar] .pp-sdk-calendar-CheckMark {\n  position: absolute;\n  top: 0;\n  left: 0;\n  width: 64%;\n  height: 32%;\n  transform: rotate(-45deg) translate(-10%, 100%);\n  transform-origin: center;\n  transition:\n    opacity 150ms ease,\n    transform 150ms ease;\n\n  @starting-style {\n    opacity: 0;\n  }\n\n  [data-state=\"indeterminate\"] & {\n    transform: translate(30%, 80%);\n\n    &::before {\n      opacity: 0;\n    }\n  }\n\n  /* CheckMark arms */\n  &::before,\n  &::after {\n    position: absolute;\n    display: block;\n    background: var(--gray-0);\n    content: \"\";\n    will-change: transform;\n\n    @starting-style {\n      transform: scale(0);\n    }\n  }\n\n  :where([data-theme=dark]) & {\n    /* pure black checkbox is not low enough contrast to look disabled */\n    &[data-disabled] {\n      &::before,\n      &::after {\n        background: var(--gray-100);\n      }\n    }\n  }\n\n  &::before {\n    top: 0;\n    bottom: 0;\n    left: 0;\n    width: 2px;\n    transform-origin: 0 0;\n    transition:\n      transform 100ms ease 80ms,\n      opacity 200ms ease;\n  }\n\n  [data-state=\"indeterminate\"]::before {\n    opacity: 0;\n  }\n\n  &::after {\n    right: 0;\n    bottom: 0;\n    left: 0;\n    height: 2px;\n    transform-origin: 0 100%;\n    transition: transform 100ms ease 160ms;\n  }\n}\n\n";
const adapter="\n/* Scope the existing SDK controls to the native weekly-calendar editor only. */\n#sectionView [data-pp-weekly-calendar] {\n  box-sizing:border-box;font-family:var(--font-sans);font-size:var(--font-text-sm-size);line-height:var(--font-text-sm-line-height);color:var(--color-text);\n  background:transparent;border:1px solid var(--color-border)!important;border-radius:var(--radius-2xl)!important;padding:calc(var(--spacing)*4)!important;gap:calc(var(--spacing)*4)!important;\n}\n#sectionView [data-pp-weekly-calendar]>div:first-child>strong {font-size:var(--font-text-md-size);line-height:var(--font-text-md-line-height);font-weight:var(--font-weight-semibold)}\n#sectionView [data-pp-weekly-calendar]>div:first-child>div {display:flex;flex-direction:row;align-items:center;flex-wrap:wrap;gap:calc(var(--spacing)*2);margin-left:auto}\n#sectionView [data-pp-weekly-calendar] [data-pp-shift] {\n  border:1px solid var(--color-border)!important;border-radius:var(--radius-xl)!important;padding:calc(var(--spacing)*4)!important;gap:calc(var(--spacing)*4)!important\n}\n#sectionView [data-pp-weekly-calendar] [data-pp-shift]>div:first-child {align-items:flex-end!important;gap:calc(var(--spacing)*3)!important}\n#sectionView [data-pp-weekly-calendar] [data-pp-shift]>div:first-child>strong {align-self:center;font-weight:var(--font-weight-semibold)}\n#sectionView [data-pp-weekly-calendar] label:has([data-pp-calendar-field]) {display:flex;flex-direction:column;gap:var(--spacing);font-size:var(--font-text-sm-size);font-weight:var(--font-weight-normal)}\n#sectionView [data-pp-weekly-calendar] button.pp-sdk-Button {\n  box-sizing:border-box;border:0;background:transparent;box-shadow:none;min-width:0;min-height:0;max-height:none;margin:0;width:auto;font-family:var(--font-sans);--scale:0.98\n}\n#sectionView [data-pp-weekly-calendar] .pp-sdk-ButtonInner {pointer-events:none}\n#sectionView [data-pp-weekly-calendar] button.pp-sdk-calendar-remove {width:40px;padding:0}\n#sectionView [data-pp-weekly-calendar] .pp-sdk-InputContainer {width:132px;display:inline-flex;align-items:center}\n#sectionView [data-pp-weekly-calendar] .pp-sdk-InputContainer:has([data-pp-calendar-field=\"name\"]) {width:200px}\n#sectionView [data-pp-weekly-calendar] .pp-sdk-InputContainer>input[type=time]::-webkit-calendar-picker-indicator {cursor:pointer;opacity:.65}\n#sectionView [data-pp-weekly-calendar] label:has(.pp-sdk-calendar-native-check) {position:relative;display:inline-flex;align-items:center;gap:8px;min-height:20px;font-size:14px;line-height:20px;cursor:pointer}\n#sectionView [data-pp-weekly-calendar] label:has([data-pp-calendar-full-day]) {min-height:40px}\n#sectionView [data-pp-weekly-calendar] .pp-sdk-calendar-native-check {position:absolute;inset-inline-start:0;top:50%;transform:translateY(-50%);width:18px!important;height:18px!important;margin:0!important;opacity:0;z-index:1;cursor:pointer}\n#sectionView [data-pp-weekly-calendar] .pp-sdk-calendar-native-check:focus-visible+.pp-sdk-calendar-Checkbox {outline:2px solid var(--color-ring);outline-offset:2px}\n#sectionView [data-pp-weekly-calendar] .pp-sdk-calendar-Checkbox {box-sizing:border-box;pointer-events:none}\n#sectionView [data-pp-weekly-calendar] .pp-sdk-calendar-Checkbox:not([data-state=\"checked\"]) .pp-sdk-calendar-CheckMark {display:none}\n#sectionView [data-pp-weekly-calendar] [data-pp-calendar-break] {gap:calc(var(--spacing)*2)!important;align-items:center!important}\n#sectionView [data-pp-weekly-calendar] [role=status]:empty {display:none}\n";
function installSchedulesSDK(){
  if(window.__PP_WORK_SCHEDULES_SDK_V1__)return;window.__PP_WORK_SCHEDULES_SDK_V1__=true;
  const section=document.getElementById("sectionView");if(!section)return;
  const make=(tag,cls)=>{const el=document.createElement(tag);el.className=cls;return el};
  let scheduled=false;
  function enhance(){
    scheduled=false;
    const panel=section.querySelector("[data-pp-weekly-calendar]");if(!panel)return;
    for(const button of panel.querySelectorAll("button")){
      if(!button.classList.contains("pp-sdk-Button")){
        button.classList.remove("pp-edit-input","pp-edit-btn","primary");
        button.classList.add("pp-sdk-Button");
        button.dataset.size="xl";button.dataset.variant=button.hasAttribute("data-pp-save-schedules")?"solid":"outline";button.dataset.color="primary";button.dataset.pill="";
        if(button.textContent.trim()==="×")button.classList.add("pp-sdk-calendar-remove");
      }
      let inner=button.querySelector(":scope>.pp-sdk-ButtonInner");
      if(!inner){inner=make("span","pp-sdk-ButtonInner");while(button.firstChild)inner.append(button.firstChild);button.append(inner)}
      button.toggleAttribute("data-disabled",button.disabled);
    }
    for(const input of panel.querySelectorAll("input[type=text],input[type=time]")){
      if(input.parentElement.classList.contains("pp-sdk-InputContainer"))continue;
      const wrap=make("span","pp-sdk-InputContainer");wrap.dataset.size="xl";wrap.dataset.variant="outline";wrap.dataset.pill="";
      input.classList.remove("pp-edit-input");input.classList.add("pp-sdk-Input");input.before(wrap);wrap.append(input);
      input.addEventListener("focus",()=>wrap.dataset.focused="true");input.addEventListener("blur",()=>wrap.removeAttribute("data-focused"));
      input.addEventListener("invalid",()=>wrap.setAttribute("data-invalid",""));input.addEventListener("input",()=>wrap.removeAttribute("data-invalid"));
    }
    for(const input of panel.querySelectorAll("input[type=checkbox]")){
      if(input.classList.contains("pp-sdk-calendar-native-check"))continue;
      input.classList.add("pp-sdk-calendar-native-check");
      const box=make("span","pp-sdk-calendar-Checkbox"),mark=make("span","pp-sdk-calendar-CheckMark");box.setAttribute("aria-hidden","true");box.append(mark);input.after(box);
      const sync=()=>{box.dataset.state=input.checked?"checked":"unchecked";box.toggleAttribute("data-disabled",input.disabled)};
      input.addEventListener("input",sync);input.addEventListener("change",sync);sync();
    }
  }
  const schedule=()=>{if(!scheduled){scheduled=true;requestAnimationFrame(enhance)}};
  new MutationObserver(schedule).observe(section,{childList:true,subtree:true,attributes:true,attributeFilter:["disabled"]});
  schedule();
}
function transform(html,checkboxCss,adapter,script){
  if(typeof html!=="string"||!html.includes("/* PP_EMPLOYEES_SDK_V1 */")||html.includes('id="ppWorkSchedulesSdkJs"'))return html;
  function style(id){const tag='<style id="'+id+'">',a=html.indexOf(tag);if(a<0)throw Error("Missing SDK style "+id);const b=html.indexOf("</style>",a+tag.length);if(b<0)throw Error("Missing style end "+id);return html.slice(a+tag.length,b)}
  const toolbar=style("ppEquipmentSdkToolbarStyle"),cut=toolbar.indexOf("/* LiftOrbit adapter:");
  if(cut<0)throw Error("Missing SDK button integration boundary");
  const buttons=toolbar.slice(0,cut).replaceAll(".pp-sdk-equipment-toolbar","[data-pp-weekly-calendar]");
  const inputs=style("ppEquipmentSDKStyle").split("\n").filter(l=>l.startsWith("#sectionView .pp-sdk-equipment-table .pp-sdk-InputContainer")).map(l=>l.replaceAll(".pp-sdk-equipment-table","[data-pp-weekly-calendar]")).join("\n");
  if(!inputs.includes(">input.pp-sdk-Input")||!buttons.includes("pp-sdk-ButtonInner"))throw Error("SDK control CSS not found");
  if(html.split("</head>").length!==2||html.split("</body>").length!==2)throw Error("Calendar SDK HTML anchor");
  return html.replace("</head>",()=>'<style id="ppWorkSchedulesSdkStyle">'+buttons+"\n"+inputs+"\n"+checkboxCss+"\n"+adapter+"</style></head>").replace("</body>",()=>'<script id="ppWorkSchedulesSdkJs">('+script+')();</script></body>');
}
export function patchPreview(html){return transform(html,checkboxCss,adapter,installSchedulesSDK.toString())}
export function patchSource(source){
 const anchor="const assistantHtml=ppEmployeesSdkPage(";
 assert(!source.includes("function ppWorkSchedulesSdkPage("),"Already installed");
 assert.equal(source.split(anchor).length,2,"Employees SDK auth anchor");
 const lines=source.split("\n"),i=lines.findIndex(l=>l.includes(anchor));
 assert(lines[i].trimEnd().endsWith(";"));
 lines[i]=lines[i].replace(anchor,"const assistantHtml=ppWorkSchedulesSdkPage(ppEmployeesSdkPage(").replace(/;\s*$/,");");
 return lines.join("\n")+"\nfunction ppWorkSchedulesSdkPage(html){return ("+transform.toString()+")(html,"+JSON.stringify(checkboxCss)+","+JSON.stringify(adapter)+","+JSON.stringify(installSchedulesSDK.toString())+");}\n";
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)writeFileSync(process.argv[3],patchSource(readFileSync(process.argv[2],"utf8")),{mode:0o600});
