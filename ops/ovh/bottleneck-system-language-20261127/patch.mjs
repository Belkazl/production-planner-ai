import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
export const labels={"Самый загруженный ресурс":"Most utilized resource","Ожидание ресурсов":"Resource waiting time","Операций":"Operations","Длительность плана":"Plan duration"};
export function transformBottleneckLanguage(html,labels){
 if(typeof html!=="string"||html.includes("PP_BOTTLENECK_SYSTEM_LANGUAGE_V1")||!html.includes("PP_INDEPENDENT_PLANNER_SCROLL_V1"))return html;
 const matches=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter(m=>/\bid=["']ppLanguageUiJs["']/.test(m[1]));
 if(matches.length!==1)return html;
 const match=matches[0],source=match[2],a=source.indexOf("function transformText(node){"),b=source.indexOf("function transformAttrs(",a);
 if(a<0||b<=a)return html;
 const text=source.slice(a,b),anchor="const tr=translate(ru);";
 if(text.split(anchor).length!==2)return html;
 // Only actual caption nodes in the bottlenecks renderer. The value below
 // a caption (including a user-defined resource name) must not be translated.
 const mapping=JSON.stringify(labels);
 const replacement=`/* PP_BOTTLENECK_SYSTEM_LANGUAGE_V1 */
 const ppBottleneckLabels=${mapping};
 const ppBottleneckCaption=Object.hasOwn(ppBottleneckLabels,ru.trim())&&parent.tagName==="SPAN"&&parent.nextElementSibling?.tagName==="B"&&parent.closest("#ppTabsView")&&document.querySelectorAll("#planView .tabs > div")[5]?.classList.contains("a");
 const tr=ppBottleneckCaption?ppBottleneckLabels[ru.trim()]:translate(ru);`;
 const updated=source.slice(0,a)+text.replace(anchor,()=>replacement)+source.slice(b);
 const offset=match.index+match[0].indexOf(">")+1;
 return html.slice(0,offset)+updated+html.slice(offset+source.length);
}
export function patchSource(auth){
 assert(!auth.includes("function ppBottleneckLanguagePage("),"BOTTLENECK_I18N_ALREADY_INSTALLED");
 const before="const assistantHtml=ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded))))))))))));",after="const assistantHtml=ppBottleneckLanguagePage(ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded)))))))))))));";
 assert.equal(auth.split(before).length,2,"BOTTLENECK_I18N_AUTH_ANCHOR_DRIFT");
 const append="\n// PP_BOTTLENECK_SYSTEM_LANGUAGE_V1\nfunction ppBottleneckLanguagePage(html){return ("+transformBottleneckLanguage.toString()+")(html,"+JSON.stringify(labels)+");}\n";
 const result=auth.replace(before,after)+append;
 assert.equal(result.slice(0,-append.length).replace(after,before),auth);
 return result;
}
if(process.argv[1]?.endsWith("/bottleneck-system-language-20261127/patch.mjs")){
 const [input,output]=process.argv.slice(2);assert(input&&output);
 writeFileSync(output,patchSource(readFileSync(input,"utf8")),{mode:0o600});
 console.log("BOTTLENECK_I18N_EXACT_PATCH_PASS");
}
