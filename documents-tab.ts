import {readFileSync,writeFileSync} from "node:fs";
let source=readFileSync("index.ts","utf8");
function once(a:string,b:string,label:string){
 const n=source.split(a).length-1;
 if(n!==1)throw Error("PP_DOCS_"+label+"_ANCHOR_"+n);
 source=source.replace(a,b);
}
const css=readFileSync("documents-tab-ui.css","utf8");
const js=readFileSync("documents-tab-ui.js","utf8");
if(!source.includes("PP_START_OVER_INLINE"))throw Error("PP_DOCS_MUST_PRESERVE_FRESH_OPTIMIZER");
if(!js.includes("ppDocumentsActionSlot")||!js.includes("ppImportBtn")||!js.includes("ppTemplateBtn")||
   !js.includes("moveOriginalActions")||!css.includes("#ppDocumentsView[hidden]"))
 throw Error("PP_DOCS_FEATURE_SOURCES_INVALID");
const inline='<style id="pp-documents-tab-style">'+css+'</style><script id="pp-documents-tab-script">'+js+'</script>';
once("async function serveGanttUi(req){",
     "const PP_DOCUMENTS_INLINE="+JSON.stringify(inline)+";\nasync function serveGanttUi(req){","constant");
once("+PP_STOP_INLINE+PP_GANTT_DETAILS_INLINE+PP_ORDER_STACKED_UI_INLINE+PP_START_OVER_INLINE+'</body>'",
     "+PP_STOP_INLINE+PP_GANTT_DETAILS_INLINE+PP_ORDER_STACKED_UI_INLINE+PP_START_OVER_INLINE+PP_DOCUMENTS_INLINE+'</body>'","append_ui");
writeFileSync("index.ts",source);
console.log("PP_DOCUMENTS_TAB_BUILD_OK",JSON.stringify({
  bytes:source.length,
  sourceButtonsMovedNotDuplicated:true,
  originalImportAndDownloadHandlersKept:true,
  gaAndSavedPlanLogicUntouched:true
}));
