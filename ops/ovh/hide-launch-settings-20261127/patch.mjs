import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
export function transformSettings(html){
 if(typeof html!=="string"||html.includes("PP_HIDE_LAUNCH_SETTINGS_V1"))return html;
 const matches=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter(m=>/\bid=["']ppLaunchAnalyticsJs["']/.test(m[1]));
 if(matches.length!==1)return html;
 const match=matches[0],source=match[2];
 const map='scenarios:["scenarios","сценарии"],plan:';
 const mapNext='scenarios:["scenarios","сценарии"],settings:["settings","настройки"],plan:';
 const original='  const scenario=item("scenarios");\n  if(scenario){if(!scenario.hasAttribute("data-pp-launch-hidden")){scenario.setAttribute("data-pp-launch-hidden","");scenario.setAttribute("aria-hidden","true")}if(scenario.classList.contains("active")){item("plan")?.click();return}}';
 const next='  /* PP_HIDE_LAUNCH_SETTINGS_V1 */\n  for(const key of ["scenarios","settings"]){const deferred=item(key);if(!deferred)continue;if(!deferred.hasAttribute("data-pp-launch-hidden")){deferred.setAttribute("data-pp-launch-hidden","");deferred.setAttribute("aria-hidden","true")}if(deferred.classList.contains("active")){item("plan")?.click();return}}';
 if(!source.includes("PP_LAUNCH_ANALYTICS_V1")||source.split(map).length!==2||source.split(original).length!==2)return html;
 const updated=source.replace(map,()=>mapNext).replace(original,()=>next);
 const offset=match.index+match[0].indexOf(">")+1;
 return html.slice(0,offset)+updated+html.slice(offset+source.length);
}
export function patchSource(auth){
 assert(!auth.includes("function ppHideLaunchSettingsPage("),"SETTINGS_ALREADY_HIDDEN");
 const before="const assistantHtml=ppLaunchAnalyticsPage(ppBottleneckLanguagePage(ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded))))))))))))));",after="const assistantHtml=ppHideLaunchSettingsPage(ppLaunchAnalyticsPage(ppBottleneckLanguagePage(ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded)))))))))))))));";
 assert.equal(auth.split(before).length,2,"SETTINGS_AUTH_ANCHOR_DRIFT");
 const append="\n// PP_HIDE_LAUNCH_SETTINGS_V1\nfunction ppHideLaunchSettingsPage(html){return ("+transformSettings.toString()+")(html);}\n";
 const result=auth.replace(before,after)+append;
 assert.equal(result.slice(0,-append.length).replace(after,before),auth);
 return result;
}
if(process.argv[1]?.endsWith("/hide-launch-settings-20261127/patch.mjs")){
 const [input,output]=process.argv.slice(2);assert(input&&output);writeFileSync(output,patchSource(readFileSync(input,"utf8")),{mode:0o600});console.log("HIDE_SETTINGS_EXACT_PATCH_PASS");
}
