import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
export function transformCalendarLanguage(html){
 if(typeof html!=="string"||html.includes("PP_WEEKLY_CALENDAR_LANGUAGE_V2"))return html;
 const start="function ppWCMount(){",end="ppWCInstall();";
 if(html.split(start).length!==2||html.split(end).length!==2)return html;
 const a=html.indexOf(start),b=html.indexOf(end,a)+end.length;
 if(b<=a)return html;
 let source=html.slice(a,b);
 const edits=[
  ["  const ru=String(document.documentElement.lang||'').startsWith('ru')||Array.from(table.querySelectorAll('th')).some(x=>x.textContent.trim()==='Сотрудник');\n  const t=(en,rs)=>ru?rs:en;",
   "  /* PP_WEEKLY_CALENDAR_LANGUAGE_V2: selected language is authoritative; a freshly rendered Russian table header is not a language preference. */\n  const ru=()=>{const selected=document.getElementById('ppLanguageSelect')?.value;return selected==='ru'||(selected!=='en'&&String(document.documentElement.lang||'').startsWith('ru'))};\n  const t=(en,rs)=>ru()?rs:en;\n  let previousLocale=ru();"],
  ["  const labels=ru?['Пн','Вт','Ср','Чт','Пт','Сб','Вс']:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];",
   "  const labels=()=>ru()?['Пн','Вт','Ср','Чт','Пт','Сб','Вс']:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];"],
  ["  head.append(el('strong',t('Work schedules','Рабочие графики')));",
   "  const heading=el('strong',t('Work schedules','Рабочие графики'));head.append(heading);"],
  ["      labels.forEach((label,i)=>","      labels().forEach((label,i)=>"],
  ["  for(const row of table.querySelectorAll('tbody tr')){","  const refreshSchedule=[];\n  for(const row of table.querySelectorAll('tbody tr')){"],
  ["map(d=>labels[d-1]).join(', ');","map(d=>labels()[d-1]).join(', ');"],
  ["    };update();select.addEventListener('change',update);","    };update();refreshSchedule.push(update);select.addEventListener('change',update);"],
  ["  }\n}\n\nfunction ppWCInstall(){",
   "  }\n  panel.__ppRefreshLocale=()=>{\n    const locale=ru();if(locale===previousLocale||!panel.isConnected)return;\n    previousLocale=locale;\n    heading.textContent=t('Work schedules','Рабочие графики');\n    add.textContent=t('+ Add shift','+ Добавить смену');\n    commit.textContent=t('Save schedules','Сохранить графики');\n    message.textContent='';\n    // Reuse the current editable draft, not the saved model. Language changes never write model data or discard dirty fields.\n    render();for(const refresh of refreshSchedule)refresh();\n  };\n}\n\nfunction ppWCInstall(){"],
  ["    observer.observe(section,{childList:true,subtree:true});",
   "    observer.observe(section,{childList:true,subtree:true});\n    const refreshLocale=()=>{section.querySelector('[data-pp-weekly-calendar]')?.__ppRefreshLocale?.()};\n    document.addEventListener('change',event=>{if(event.target?.id==='ppLanguageSelect')queueMicrotask(refreshLocale)});\n    new MutationObserver(refreshLocale).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});"]
 ];
 for(const [old] of edits)if(source.split(old).length!==2)return html;
 for(const [old,next] of edits)source=source.replace(old,()=>next);
 return html.slice(0,a)+source+html.slice(b);
}
export const marker="PP_WEEKLY_CALENDAR_LANGUAGE_V2";
export function patchSource(auth){
 assert(!auth.includes("function ppCalendarLanguagePage("),"CALENDAR_LANGUAGE_ALREADY_INSTALLED");
 const before="const assistantHtml=ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded)))))));";
 const after="const assistantHtml=ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded))))))));";
 assert.equal(auth.split(before).length,2,"CALENDAR_LANGUAGE_AUTH_ANCHOR_DRIFT");
 const append="\n// "+marker+"\nfunction ppCalendarLanguagePage(html){return ("+transformCalendarLanguage.toString()+")(html);}\n";
 const result=auth.replace(before,after)+append;
 assert.equal(result.slice(0,-append.length).replace(after,before),auth);
 return result;
}
if(process.argv[1]?.endsWith("/system-language-calendar-20261127/patch.mjs")){
 const [input,output]=process.argv.slice(2);assert(input&&output);
 writeFileSync(output,patchSource(readFileSync(input,"utf8")),{mode:0o600});
 console.log("CALENDAR_LANGUAGE_EXACT_PATCH_PASS");
}
