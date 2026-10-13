import {readFileSync,writeFileSync} from "node:fs";
let source=readFileSync("index.ts","utf8");
function once(oldText:string,replacement:string,name:string){
 const count=source.split(oldText).length-1;
 if(count!==1)throw Error("PP_ORDER_LAYOUT_"+name+"_ANCHOR_"+count);
 source=source.replace(oldText,replacement);
}
const css=readFileSync("order-accordion.css","utf8");
const js=readFileSync("order-accordion.js","utf8");
if(!css.includes("grid-template-areas:")||!js.includes("MutationObserver")||!js.includes('data-pp-expanded'))
 throw Error("PP_ORDER_LAYOUT_MISSING_FEATURE");
const inject='<style id="pp-order-stacked-layout">'+css+'</style><script id="pp-order-stacked-accordion">'+js+'</script>';
once("async function serveGanttUi(req){","const PP_ORDER_STACKED_UI_INLINE="+JSON.stringify(inject)+";\nasync function serveGanttUi(req){","constant");
once("+PP_STOP_INLINE+PP_GANTT_DETAILS_INLINE+'</body>'",
     "+PP_STOP_INLINE+PP_GANTT_DETAILS_INLINE+PP_ORDER_STACKED_UI_INLINE+'</body>'","ui_injection");
writeFileSync("index.ts",source);
console.log("PP_ORDER_LAYOUT_BUILD_OK",JSON.stringify({revision:"stacked-collapsed-20261013",bytes:source.length,uiBytes:inject.length,storageUntouched:true}));
