import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
export const oldCell="function ppPerformanceCell(a,m,escape){\n const s=ppPerfSpec(a,m),units=[\"m²/h\",\"kg/h\",\"pcs/h\",\"l/h\",\"min/cycle\"];\n const input=(field,v)=>'<input class=\"pp-edit-input\" data-pp-perf=\"'+field+'\" data-pp-original=\"'+escape(ppPerfDisplay(v))+'\" inputmode=\"decimal\" value=\"'+escape(ppPerfDisplay(v))+'\" '+(s.mode===\"inherited\"?'placeholder=\"Не задано\"':'')+' style=\"min-width:0;flex:1 1 0\">';\n // Preserve uncommon legacy units without silently changing their numerical meaning.\n const options=(units.includes(s.unit)?\"\":'<option value=\"'+escape(s.unit)+'\" selected hidden disabled>'+escape(s.unit)+'</option>')+units.map(u=>'<option value=\"'+u+'\"'+(u===s.unit?' selected':'')+'>'+u+'</option>').join(\"\");\n const select='<select class=\"pp-edit-select\" data-pp-perf-unit data-pp-original=\"'+escape(s.unit)+'\" aria-label=\"Performance unit\" style=\"width:110px;min-width:110px;flex:0 0 110px\">'+options+'</select>';\n const first='<div style=\"display:flex;align-items:center;gap:8px\">'+input(\"value\",s.value)+select+'</div>';\n const flow=s.mode===\"flow\"?'<div data-pp-flow-residence style=\"display:flex;align-items:center;gap:8px;margin-top:5px\"><span class=\"pp-edit-muted\">Время прохождения</span>'+input(\"residence\",s.residence)+'<span class=\"pp-edit-muted\">мин</span></div>':\"\";\n const fallback=s.mode===\"inherited\"?'<div class=\"pp-edit-muted\" style=\"margin-top:4px\"><span>По времени операции</span>'+(s.factor!==1?' <span>× '+escape(ppPerfDisplay(s.factor))+'</span>':'')+'</div>':\"\";\n return '<td data-pp-performance-mode=\"'+s.mode+'\" data-pp-expected-unit=\"'+escape(s.expected||\"\")+'\">'+first+flow+fallback+'</td>';\n}";
export function ppPerformanceCell(a,m,escape){
 const s=ppPerfSpec(a,m),units=["m²/h","kg/h","pcs/h","l/h","min/cycle"];
 const input=(field,v)=>'<input class="pp-edit-input" data-pp-perf="'+field+'" data-pp-original="'+escape(ppPerfDisplay(v))+'" inputmode="decimal" value="'+escape(ppPerfDisplay(v))+'" '+(s.mode==="inherited"?'placeholder="Не задано"':'')+'>';
 const options=(units.includes(s.unit)?"":'<option value="'+escape(s.unit)+'" selected hidden disabled>'+escape(s.unit)+'</option>')+units.map(u=>'<option value="'+u+'"'+(u===s.unit?' selected':'')+'>'+u+'</option>').join("");
 const select='<select class="pp-edit-select" data-pp-perf-unit data-pp-original="'+escape(s.unit)+'" aria-label="Performance unit">'+options+'</select>';
 const flow=s.mode==="flow"?'<div data-pp-flow-residence><span class="pp-edit-muted">Время прохождения</span>'+input("residence",s.residence)+'<span class="pp-edit-muted">мин</span></div>':"";
 const fallback=s.mode==="inherited"?'<div class="pp-edit-muted" style="margin-top:4px"><span>По времени операции</span>'+(s.factor!==1?' <span>× '+escape(ppPerfDisplay(s.factor))+'</span>':'')+'</div>':"";
 return '<td class="pp-perf-value-cell" data-pp-performance-mode="'+s.mode+'" data-pp-expected-unit="'+escape(s.expected||"")+'">'+input("value",s.value)+flow+fallback+'</td><td class="pp-perf-unit-cell">'+select+'</td>';
}
export const newCell=ppPerformanceCell.toString();
export const css="<style id=\"ppPerformanceColumnsStyle\">\n#sectionView th.pp-perf-value-heading,#sectionView td.pp-perf-value-cell{width:116px;min-width:116px;vertical-align:middle}\n#sectionView th.pp-perf-unit-heading,#sectionView td.pp-perf-unit-cell{width:156px;min-width:156px;vertical-align:middle}\n#sectionView th.pp-perf-value-heading,#sectionView th.pp-perf-unit-heading{white-space:nowrap}\n#sectionView td.pp-perf-value-cell>input[data-pp-perf=\"value\"]{box-sizing:border-box;width:100px!important;min-width:0!important;max-width:100px!important;height:34px;border-radius:999px!important;padding:0 12px!important}\n#sectionView td.pp-perf-unit-cell>select[data-pp-perf-unit]{box-sizing:border-box;width:140px!important;min-width:0!important;max-width:140px!important;height:34px;border-radius:999px!important;padding:0 12px!important}\n#sectionView td.pp-perf-value-cell [data-pp-flow-residence]{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:4px;margin-top:5px}\n#sectionView td.pp-perf-value-cell [data-pp-flow-residence]>span:first-child{grid-column:1/-1}\n#sectionView td.pp-perf-value-cell [data-pp-flow-residence]>input{width:100%;min-width:0;box-sizing:border-box;border-radius:999px!important}\n#sectionView tr:has(td.pp-perf-unit-cell select option[value=\"min/cycle\"]:checked) [data-pp-flow-residence]{display:none!important}\n</style>";
export function transformPerformanceColumns(html,oldCell,newCell,css){
 if(typeof html!=="string"||html.includes("PP_EQUIPMENT_PERFORMANCE_COLUMNS_V1")||!html.includes("PP_EQUIPMENT_PERFORMANCE_UNITS_V1"))return html;
 const matches=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter(m=>/\bid=["']ppEditableTablesJs["']/.test(m[1]));
 if(matches.length!==1)return html;
 const match=matches[0],source=match[2],edits=[
  [oldCell,"/* PP_EQUIPMENT_PERFORMANCE_COLUMNS_V1 */\n"+newCell],
  ['sel=cell.querySelector("[data-pp-perf-unit]")','sel=cell.closest("tr").querySelector("[data-pp-perf-unit]")'],
  ["<th>Производительность</th>",'<th class="pp-perf-value-heading">Производительность</th><th class="pp-perf-unit-heading">Единица расчёта</th>']
 ];
 if(edits.some(([old])=>source.split(old).length!==2))return html;
 let next=source;for(const [old,value] of edits)next=next.replace(old,()=>value);
 const offset=match.index+match[0].indexOf(">")+1;
 let result=html.slice(0,offset)+next+html.slice(offset+source.length);
 const anchor="const trMap=new Map(Object.entries(texts));";
 if(result.split(anchor).length!==2||result.split("</head>").length!==2)return html;
 return result.replace(anchor,()=>anchor+'\ntrMap.set("Единица расчёта","Calculation unit");').replace("</head>",()=>css+"</head>");
}
export function patchSource(auth){
 assert(!auth.includes("function ppPerformanceColumnsPage("),"PERFORMANCE_COLUMNS_ALREADY_INSTALLED");
 const before="const assistantHtml=ppEquipmentPerformanceUnitsPage(ppEquipmentGroupsPage(ppProjectCardsLanguagePage(ppHideLaunchSettingsPage(ppLaunchAnalyticsPage(ppBottleneckLanguagePage(ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded))))))))))))))))));",after="const assistantHtml=ppPerformanceColumnsPage(ppEquipmentPerformanceUnitsPage(ppEquipmentGroupsPage(ppProjectCardsLanguagePage(ppHideLaunchSettingsPage(ppLaunchAnalyticsPage(ppBottleneckLanguagePage(ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded)))))))))))))))))));";
 assert.equal(auth.split(before).length,2,"PERFORMANCE_COLUMNS_AUTH_ANCHOR_DRIFT");
 const append="\n// PP_EQUIPMENT_PERFORMANCE_COLUMNS_V1\nfunction ppPerformanceColumnsPage(html){return ("+transformPerformanceColumns.toString()+")(html,"+JSON.stringify(oldCell)+","+JSON.stringify(newCell)+","+JSON.stringify(css)+");}\n";
 const result=auth.replace(before,after)+append;
 assert.equal(result.slice(0,-append.length).replace(after,before),auth);return result;
}
if(process.argv[1]?.endsWith("/equipment-performance-columns-20261127/patch.mjs")){
 const [input,output]=process.argv.slice(2);assert(input&&output);writeFileSync(output,patchSource(readFileSync(input,"utf8")),{mode:0o600});console.log("PERFORMANCE_COLUMNS_EXACT_PATCH_PASS");
}
