import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {ppCalendarResourceMetrics,ppCalendarUtilizationHtml} from "./metrics.mjs";
export const css="<style id=\"ppCalendarUtilizationStyle\">\n.pp-utilization-v2{display:grid;gap:12px}\n.pp-utilization-v2 .pp-util-explainer{padding:0 2px}\n.pp-utilization-v2 h3{margin:0 0 6px}\n.pp-utilization-v2 h3 small{font-weight:400;color:#617388}\n.pp-utilization-v2 .pp-util-caption{font-size:11px;line-height:1.45;color:#617388;margin:5px 0}\n.pp-utilization-v2 .pp-util-legend{display:flex;flex-wrap:wrap;gap:8px 16px;margin:8px 0 0}\n.pp-utilization-v2 .pp-util-legend small{display:flex;align-items:center;gap:5px;color:#50627a}\n.pp-utilization-v2 .pp-util-legend i{display:inline-block;width:9px;height:9px;border-radius:2px}\n.pp-utilization-v2 .pp-util-row{margin:10px 0 0}\n.pp-utilization-v2 .pp-util-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap}\n.pp-utilization-v2 .pp-util-values{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}\n.pp-utilization-v2 .pp-util-values small,.pp-utilization-v2 .pp-util-meta small{color:#617388;font-size:10px}\n.pp-utilization-v2 .pp-util-values span{font-weight:600;font-variant-numeric:tabular-nums}\n.pp-utilization-v2 .pp-util-track{display:flex!important;height:9px;overflow:hidden;border-radius:5px;margin:4px 0;background:#e9eef3}\n.pp-utilization-v2 .pp-util-track i{height:100%;display:block;flex-shrink:0}\n.pp-utilization-v2 .pp-util-meta{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}\n.pp-utilization-v2 .pp-util-production{background:#2464e9}\n.pp-utilization-v2 .pp-util-setup{background:#e4a43b}\n.pp-utilization-v2 .pp-util-wait{background:#8799ad}\n.pp-utilization-v2 .pp-util-free{background:#e9eef3}\n.pp-utilization-v2 .pp-util-warning{color:#9a5a19;font-size:10px}\n.pp-utilization-v2 .pp-util-unknown{background:repeating-linear-gradient(135deg,#edf1f5,#edf1f5 4px,#e1e7ed 4px,#e1e7ed 8px)}\n</style>";
export const marker="PP_CALENDAR_UTILIZATION_V1";
export const helperSource=ppCalendarResourceMetrics.toString()+"\n"+ppCalendarUtilizationHtml.toString()+"\n";
export function transformUtilization(html,style,helpers){
 if(typeof html!=="string"||html.includes("PP_CALENDAR_UTILIZATION_V1"))return html;
 const anchor="window.__ppGroqRenderResourceUtilization=renderLoad;";
 const baseline="let dur=Math.max(1,+plan.duration_minutes||1),ops=plan.generic_operations||[],rows=[];";
 if(html.split(anchor).length!==2||!html.includes(baseline)||html.split("</head>").length!==2)return html;
 const install=helpers+`
/* PP_CALENDAR_UTILIZATION_V1 */
renderLoad=function ppRenderCalendarLoad(plan){
 const language=document.getElementById("ppLanguageSelect")?.value==="ru"?"ru":document.getElementById("ppLanguageSelect")?.value==="en"?"en":document.documentElement.lang==="ru"?"ru":"en";
 try{return ppCalendarUtilizationHtml(ppCalendarResourceMetrics(plan,model,equipment(),employees()),language)}
 catch{return ppCalendarUtilizationHtml(null,language)}
};
window.__ppGroqRenderResourceUtilization=renderLoad;
`;
 return html.replace(anchor,()=>install).replace("</head>",style+"</head>");
}
export function patchSource(auth){
 assert(!auth.includes("function ppCalendarUtilizationPage("),"UTILIZATION_ALREADY_INSTALLED");
 const before="const assistantHtml=ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded))))));";
 const after="const assistantHtml=ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded)))))));";
 assert.equal(auth.split(before).length,2,"UTILIZATION_AUTH_ANCHOR_DRIFT");
 const append="\n// "+marker+"\nfunction ppCalendarUtilizationPage(html){return ("+transformUtilization.toString()+")(html,"+JSON.stringify(css)+","+JSON.stringify(helperSource)+");}\n";
 const result=auth.replace(before,after)+append;
 assert.equal(result.slice(0,-append.length).replace(after,before),auth);
 return result;
}
if(process.argv[1]?.endsWith("/resource-utilization-calendars-20261126/patch.mjs")){
 const [input,output]=process.argv.slice(2);assert(input&&output);
 writeFileSync(output,patchSource(readFileSync(input,"utf8")),{mode:0o600});
 console.log("UTILIZATION_EXACT_AUTH_PATCH_PASS");
}
