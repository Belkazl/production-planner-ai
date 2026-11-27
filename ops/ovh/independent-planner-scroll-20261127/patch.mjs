import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
export const css="<style id=\"ppIndependentPlannerScrollV1\">\n/* Keep the established desktop grid; only its block-size and scroll ownership change. */\n@media(min-width:961px){\n html:has(body[data-pp-fixed-shell]:not(.projects-mode)){overflow:hidden!important}\n body[data-pp-fixed-shell]:not(.projects-mode){overflow:hidden!important;min-height:0!important}\n body[data-pp-fixed-shell]:not(.projects-mode) .shell{\n   box-sizing:border-box;min-height:0!important;height:calc(100dvh - var(--pp-shell-top,58px))!important;\n   max-height:calc(100dvh - var(--pp-shell-top,58px))!important;\n   grid-template-rows:minmax(0,1fr);align-items:stretch;overflow:hidden;\n }\n body[data-pp-fixed-shell]:not(.projects-mode) .shell>.side{\n   box-sizing:border-box;position:relative!important;top:auto!important;align-self:stretch;\n   height:100%!important;min-height:0!important;max-height:100%!important;\n   overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;\n }\n body[data-pp-fixed-shell]:not(.projects-mode) .shell>.assist{\n   box-sizing:border-box;position:relative!important;top:auto!important;align-self:stretch;\n   height:100%!important;min-height:0!important;max-height:100%!important;overflow:hidden;\n }\n body[data-pp-fixed-shell]:not(.projects-mode) .shell>.assist #messages{\n   flex:1 1 0;min-height:0;max-height:none!important;overflow-y:auto;overscroll-behavior:contain;\n }\n body[data-pp-fixed-shell]:not(.projects-mode) .shell>.main{\n   box-sizing:border-box;min-width:0!important;min-height:0!important;height:100%!important;\n   max-height:100%!important;overflow:auto!important;overscroll-behavior:contain;\n }\n}\n</style>";
export function installIndependentScroll(){
 const shell=document.querySelector(".shell"),top=document.querySelector(".top");
 if(!shell||!top||!shell.querySelector(":scope>.side")||!shell.querySelector(":scope>.main")||!shell.querySelector(":scope>.assist"))return;
 const desktop=matchMedia("(min-width:961px)");
 function measure(){
  if(!desktop.matches||document.body.classList.contains("projects-mode"))return;
  // The header's real border box, rather than an assumed 58px, sets the viewport budget.
  const h=top.getBoundingClientRect().height;
  if(h>0&&h<window.innerHeight/2){
   const pageTop=top.offsetTop;
   const gap=Math.max(0,parseFloat(getComputedStyle(shell).marginTop)||0);
   shell.style.setProperty("--pp-shell-top",Math.max(0,pageTop+h+gap)+"px");
   document.body.setAttribute("data-pp-fixed-shell","");
  }
 }
 const observer=new ResizeObserver(measure);
 observer.observe(top);
 window.addEventListener("resize",measure,{passive:true});
 desktop.addEventListener("change",measure);
 new MutationObserver(measure).observe(document.body,{attributes:true,attributeFilter:["class"]});
 measure();
 // A navigation change should open the next working area at its beginning.
 const main=shell.querySelector(":scope>.main");
 shell.querySelector(":scope>.side").addEventListener("click",e=>{
  const item=e.target.closest(".item");
  if(item&&!item.classList.contains("active")&&desktop.matches)
   requestAnimationFrame(()=>{main.scrollTop=0;main.scrollLeft=0});
 },true);
}
export function transformScroll(html,style,script){
 if(typeof html!=="string"||html.includes("PP_INDEPENDENT_PLANNER_SCROLL_V1")||!html.includes("PP_UNIVERSAL_CONSUMPTION_V1")||html.split("</head>").length!==2||html.split("</body>").length!==2)return html;
 return html.replace("</head>",()=>style+"</head>").replace("</body>",()=>script+"</body>");
}
export const script='<script id="ppIndependentPlannerScrollJs">/* PP_INDEPENDENT_PLANNER_SCROLL_V1 */('+installIndependentScroll.toString()+')();</script>';
export function patchSource(auth){
 assert(!auth.includes("function ppIndependentScrollPage("),"SCROLL_ALREADY_INSTALLED");
 const before="const assistantHtml=ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded)))))))))));",after="const assistantHtml=ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded))))))))))));";
 assert.equal(auth.split(before).length,2,"SCROLL_AUTH_ANCHOR_DRIFT");
 const append="\n// PP_INDEPENDENT_PLANNER_SCROLL_V1\nfunction ppIndependentScrollPage(html){return ("+transformScroll.toString()+")(html,"+JSON.stringify(css)+","+JSON.stringify(script)+");}\n";
 const result=auth.replace(before,after)+append;
 assert.equal(result.slice(0,-append.length).replace(after,before),auth);
 return result;
}
if(process.argv[1]?.endsWith("/independent-planner-scroll-20261127/patch.mjs")){
 const [input,output]=process.argv.slice(2);assert(input&&output);
 writeFileSync(output,patchSource(readFileSync(input,"utf8")),{mode:0o600});
 console.log("SCROLL_EXACT_PATCH_PASS");
}
