import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
export function ppProjectCardCaption(parent,raw){
 if(!parent||!document.body.classList.contains("projects-mode"))return null;
 const norm=s=>String(s??"").trim();
 const value=norm(raw);
 const counts={"автоклавов":["оборудование","Equipment"],"автоклава":["оборудование","Equipment"],"автоклав":["оборудование","Equipment"],"оборудование":["оборудование","Equipment"],"сотрудников":["сотрудников","Employees"],"сотрудника":["сотрудника","Employees"],"сотрудник":["сотрудник","Employees"],"заказов":["заказов","Orders"],"заказа":["заказа","Orders"],"заказ":["заказ","Orders"],"расчётов":["расчётов","Calculations"],"расчетов":["расчётов","Calculations"],"расчёта":["расчёта","Calculations"],"расчёт":["расчёт","Calculations"]};
 const buttons={"Копия":["Копия","Copy"],"Экспорт":["Экспорт","Export"]};
 const last={"Последний план":["Последний план","Latest plan"]};
 const date=/^Изменено(?:\s|$)/.test(value);
 const hours=/^(\d+(?:[.,]\d+)?)\s*ч\.?$/.exec(value);
 if(!Object.hasOwn(counts,value)&&!Object.hasOwn(buttons,value)&&!Object.hasOwn(last,value)&&!date&&!hours)return null;
 // Detect the native project-card action cluster, not generic page text.
 // Check both locales because the existing translator visits nodes in order.
 let card=null;
 for(let node=parent,depth=0;node&&depth<9;node=node.parentElement,depth++){
  if(node===document.body||node.matches(".main,.shell"))break;
  const labels=[...node.querySelectorAll("button,[role=button]")].map(b=>norm(b.textContent));
  if(labels.some(t=>["Open","Открыть"].includes(t))&&labels.some(t=>["Delete","Удалить"].includes(t))&&labels.some(t=>["Copy","Копия"].includes(t))&&labels.some(t=>["Export","Экспорт"].includes(t))){card=node;break}
 }
 if(!card)return null;
 if(Object.hasOwn(buttons,value))return parent.closest("button,[role=button]")?buttons[value]:null;
 // Preserve user-entered project names even when they match a system label.
 if(parent.closest("button,input,textarea,[contenteditable],h1,h2,h3,h4,strong,b"))return null;
 const prev=norm(parent.previousElementSibling?.textContent),next=norm(parent.nextElementSibling?.textContent);
 if(Object.hasOwn(counts,value)){
  const numeric=/^\d+(?:[.,]\d+)?$/;
  return numeric.test(prev)||numeric.test(norm(parent.parentElement?.firstElementChild?.textContent))&&parent.parentElement.firstElementChild!==parent?counts[value]:null;
 }
 if(date)return /^Изменено\s+\d/.test(value)?[value,value.replace(/^Изменено/,"Modified")]:null;
 if(Object.hasOwn(last,value))return /^(?:\d|[—–-])/.test(next)?last[value]:null;
 if(hours&&["Последний план","Latest plan"].includes(prev))return [value,hours[1].replace(",",".")+" h"];
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
