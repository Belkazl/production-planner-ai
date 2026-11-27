import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
export function ppProjectCardCaption(parent,raw){
 if(!parent||!document.body.classList.contains("projects-mode")||!parent.closest(".pm-card"))return null;
 const value=String(raw??"").trim();
 const counts={"автоклавов":["оборудование","Equipment"],"автоклава":["оборудование","Equipment"],"автоклав":["оборудование","Equipment"],"оборудование":["оборудование","Equipment"],"сотрудников":["сотрудников","Employees"],"сотрудника":["сотрудника","Employees"],"сотрудник":["сотрудник","Employees"],"заказов":["заказов","Orders"],"заказа":["заказа","Orders"],"заказ":["заказ","Orders"],"расчётов":["расчётов","Calculations"],"расчетов":["расчётов","Calculations"],"расчёта":["расчёта","Calculations"],"расчёт":["расчёт","Calculations"]};
 if(parent.matches(".pm-stat")&&Object.hasOwn(counts,value))return counts[value];
 if(parent.matches(".pm-actions button")){
  if(value==="Копия")return [value,"Copy"];
  if(value==="Экспорт")return [value,"Export"];
 }
 if(parent.matches(".pm-name > small")&&/^Изменено(?:\s|$)/.test(value))return [value,value.replace(/^Изменено/,"Modified")];
 if(parent.matches(".pm-last > span")&&value==="Последний план")return [value,"Latest plan"];
 const hours=/^(\d+(?:[.,]\d+)?)\s*ч\.?$/.exec(value);
 if(parent.matches(".pm-last > b")&&hours)return [value,hours[1].replace(",",".")+" h"];
 return null;
}
export function transformProjectsLanguage(html,helper){
 if(typeof html!=="string"||html.includes("PP_PROJECT_CARD_LANGUAGE_V1")||!html.includes("PP_HIDE_LAUNCH_SETTINGS_V1"))return html;
 const matches=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter(m=>/\bid=["']ppLanguageUiJs["']/.test(m[1]));
 if(matches.length!==1)return html;
 const match=matches[0],source=match[2],anchor="function transformText(node){",hook=' const current=node.nodeValue||"",stored=nodeStore.get(node);';
 if(source.split(anchor).length!==2||source.split(hook).length!==2)return html;
 const next=hook+`
 /* PP_PROJECT_CARD_LANGUAGE_V1 */
 const ppCardText=ppProjectCardCaption(parent,stored&&current===stored.en?stored.ru:current);
 if(ppCardText){
  const [ru,en]=ppCardText;nodeStore.set(node,{ru,en});
  const desired=lang==="ru"?ru:en;if(current!==desired)node.nodeValue=desired;return;
 }`;
 const updated=source.replace(anchor,()=>helper+"\n"+anchor).replace(hook,()=>next);
 const offset=match.index+match[0].indexOf(">")+1;
 return html.slice(0,offset)+updated+html.slice(offset+source.length);
}
export const helper=ppProjectCardCaption.toString();
export function patchSource(auth){
 assert(!auth.includes("function ppProjectCardsLanguagePage("),"PROJECT_CARD_LANGUAGE_ALREADY_INSTALLED");
 const before="const assistantHtml=ppHideLaunchSettingsPage(ppLaunchAnalyticsPage(ppBottleneckLanguagePage(ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded)))))))))))))));",after="const assistantHtml=ppProjectCardsLanguagePage(ppHideLaunchSettingsPage(ppLaunchAnalyticsPage(ppBottleneckLanguagePage(ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded))))))))))))))));";
 assert.equal(auth.split(before).length,2,"PROJECT_CARD_LANGUAGE_AUTH_ANCHOR_DRIFT");
 const append="\n// PP_PROJECT_CARD_LANGUAGE_V1\nfunction ppProjectCardsLanguagePage(html){return ("+transformProjectsLanguage.toString()+")(html,"+JSON.stringify(helper)+");}\n";
 const result=auth.replace(before,after)+append;
 assert.equal(result.slice(0,-append.length).replace(after,before),auth);
 return result;
}
if(process.argv[1]?.endsWith("/projects-card-language-20261127/patch.mjs")){
 const [input,output]=process.argv.slice(2);assert(input&&output);writeFileSync(output,patchSource(readFileSync(input,"utf8")),{mode:0o600});console.log("PROJECT_CARD_LANGUAGE_EXACT_PATCH_PASS");
}
