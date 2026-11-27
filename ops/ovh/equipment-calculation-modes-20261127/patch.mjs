import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {transformPerformanceColumns,oldCell,newCell,css} from "../equipment-performance-columns-20261127/patch.mjs";
import {ppPerfNumber,ppPerfDisplay,ppPerfChanged} from "../equipment-performance-units-20261127/patch.mjs";
export function ppPerfSpec(a,m){
 const p=a?.timing_profile&&typeof a.timing_profile==="object"&&!Array.isArray(a.timing_profile)?a.timing_profile:{};
 const mode=String(p.timing_mode??p.mode??"fixed").toLowerCase();
 const factor=Math.max(0.000001,ppPerfNumber(a?.process_multiplier??a?.multiplier)??1);
 const duration=ppPerfNumber(p.duration_min),rate=ppPerfNumber(p.throughput_per_hour),residence=ppPerfNumber(p.residence_min);
 if(mode==="fixed"&&duration!==null&&duration>=0)return {mode:"fixed",value:duration*factor,residence:null,unit:"min/cycle",factor};
 if(mode!=="fixed"&&rate!==null&&rate>0){
  const unit=p.performance_unit==="min/unit"?"min/unit":"unit/hour";
  return {mode:mode==="flow"?"flow":"throughput",value:unit==="min/unit"?60*factor/rate:rate/factor,residence:mode==="flow"?Math.max(0,residence??0)*factor:null,unit,factor};
 }
 return {mode:"inherited",value:null,residence:null,unit:"unit/hour",factor};
}
export function ppPerformanceCell(a,m,escape){
 const s=ppPerfSpec(a,m),modes=[["unit/hour","Ед./час"],["min/unit","Мин/ед."],["min/cycle","Мин/цикл"]];
 const input=(field,v)=>'<input class="pp-edit-input" data-pp-perf="'+field+'" data-pp-original="'+escape(ppPerfDisplay(v))+'" inputmode="decimal" value="'+escape(ppPerfDisplay(v))+'" '+(s.mode==="inherited"?'placeholder="Не задано"':'')+'>';
 const options=modes.map(([key,label])=>'<option value="'+key+'"'+(key===s.unit?' selected':'')+'>'+label+'</option>').join("");
 const select='<select class="pp-edit-select" data-pp-perf-unit data-pp-original="'+s.unit+'" aria-label="Calculation mode">'+options+'</select>';
 const flow=s.mode==="flow"?'<div data-pp-flow-residence><span class="pp-edit-muted">Время прохождения</span>'+input("residence",s.residence)+'<span class="pp-edit-muted">мин</span></div>':"";
 const fallback=s.mode==="inherited"?'<div class="pp-edit-muted" style="margin-top:4px"><span>По времени операции</span>'+(s.factor!==1?' <span>× '+escape(ppPerfDisplay(s.factor))+'</span>':'')+'</div>':"";
 return '<td class="pp-perf-value-cell" data-pp-performance-mode="'+s.mode+'" data-pp-factor="'+s.factor+'">'+input("value",s.value)+flow+fallback+'</td><td class="pp-perf-unit-cell">'+select+'</td>';
}
export function ppValidateEquipmentPerformance(root){
 const ru=document.getElementById("ppLanguageSelect")?.value==="ru";
 const reject=(field,en,rus)=>{field.setCustomValidity(ru?rus:en);field.reportValidity();field.focus();return false};
 for(const cell of root.querySelectorAll("[data-pp-performance-mode]")){
  const input=cell.querySelector('[data-pp-perf="value"]'),sel=cell.closest("tr").querySelector("[data-pp-perf-unit]"),res=cell.querySelector('[data-pp-perf="residence"]');
  for(const e of [input,sel,res])e?.setCustomValidity("");
  if(ppPerfChanged(input)||ppPerfChanged(sel)){
   const unit=sel.value,v=ppPerfNumber(input.value),factor=Number(cell.dataset.ppFactor)||1;
   const optional=cell.dataset.ppPerformanceMode==="inherited"&&!ppPerfChanged(sel)&&String(input.value).trim()==="";
   const converted=unit==="min/cycle"?v/factor:unit==="min/unit"?60*factor/v:v*factor;
   if(!optional&&(v===null||!["unit/hour","min/unit","min/cycle"].includes(unit)||(unit==="min/cycle"?v<0:v<=0)||!Number.isFinite(converted)||(unit!=="min/cycle"&&converted<=0)))return reject(input,"Enter a valid number.","Введите допустимое число.");
  }
  if(sel.value!=="min/cycle"&&ppPerfChanged(res)){
   const v=ppPerfNumber(res.value);
   if(v===null||v<0||!Number.isFinite(v/(Number(cell.dataset.ppFactor)||1)))return reject(res,"Enter a valid number.","Введите допустимое число.");
  }
 }
 return true;
}
export function ppApplyEquipmentPerformance(base,row){
 const input=row.querySelector('[data-pp-perf="value"]'),res=row.querySelector('[data-pp-perf="residence"]'),sel=row.querySelector("[data-pp-perf-unit]");
 if(!input)return base;
 const mode=input.closest("[data-pp-performance-mode]")?.dataset.ppPerformanceMode;
 const unit=sel?.value??ppPerfSpec(base,{}).unit;
 const factor=Math.max(0.000001,ppPerfNumber(base.process_multiplier??base.multiplier)??1);
 const changedUnit=ppPerfChanged(sel),changed=ppPerfChanged(input)||changedUnit,changedResidence=unit!=="min/cycle"&&ppPerfChanged(res);
 if(!changed&&!changedResidence){if(base.process_multiplier==null&&base.multiplier==null)base.process_multiplier=1;return base}
 const p=base.timing_profile&&typeof base.timing_profile==="object"&&!Array.isArray(base.timing_profile)?{...base.timing_profile}:{};
 if(changed){
  const v=ppPerfNumber(input.value);
  if(v===null&&mode==="inherited"&&!changedUnit)return base;
  if(unit==="min/cycle"){
   p.timing_mode="fixed";if(Object.hasOwn(p,"mode"))p.mode="fixed";p.duration_min=v/factor;
  }else{
   const newMode=mode==="flow"?"flow":"throughput";
   p.timing_mode=newMode;if(Object.hasOwn(p,"mode"))p.mode=newMode;
   // Both variable modes share the same native rate representation.
   p.throughput_per_hour=unit==="min/unit"?60*factor/v:v*factor;
  }
  p.performance_unit=unit;
 }
 if(changedResidence&&mode==="flow")p.residence_min=ppPerfNumber(res.value)/factor;
 base.timing_profile=p;
 if(base.process_multiplier==null&&base.multiplier==null)base.process_multiplier=1;
 return base;
}
export function transformModes(html,prior,priorArgs,replacements,translations){
 if(typeof html!=="string"||html.includes("PP_EQUIPMENT_CALCULATION_MODES_V1")||!html.includes("PP_EQUIPMENT_PERFORMANCE_UNITS_V1"))return html;
 const original=html;
 if(!html.includes("PP_EQUIPMENT_PERFORMANCE_COLUMNS_V1"))html=prior(html,...priorArgs);
 if(!html.includes("PP_EQUIPMENT_PERFORMANCE_COLUMNS_V1"))return original;
 const matches=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter(m=>/\bid=["']ppEditableTablesJs["']/.test(m[1]));
 if(matches.length!==1)return original;
 const match=matches[0],source=match[2];
 if(replacements.some(([a])=>source.split(a).length!==2))return original;
 let next=source;
 for(const [a,b] of replacements)next=next.replace(a,()=>b);
 const offset=match.index+match[0].indexOf(">")+1;
 let result=html.slice(0,offset)+"/* PP_EQUIPMENT_CALCULATION_MODES_V1 */\n"+next+html.slice(offset+source.length);
 const anchor='trMap.set("Единица расчёта","Calculation unit");';
 if(result.split(anchor).length!==2)return original;
 return result.replace(anchor,()=>Object.entries(translations).map(([ru,en])=>"trMap.set("+JSON.stringify(ru)+","+JSON.stringify(en)+");").join("\n"));
}
export const replacements=[["function ppPerfSpec(a,m){\n const p=a?.timing_profile&&typeof a.timing_profile===\"object\"&&!Array.isArray(a.timing_profile)?a.timing_profile:{};\n const mode=String(p.timing_mode??p.mode??\"fixed\").toLowerCase();\n const factor=Math.max(0.000001,ppPerfNumber(a?.process_multiplier??a?.multiplier)??1);\n const duration=ppPerfNumber(p.duration_min),rate=ppPerfNumber(p.throughput_per_hour),residence=ppPerfNumber(p.residence_min);\n const expected=ppRateUnit(m?.quantity_unit||a?.capacity_unit);\n const raw=String(a?.capacity_unit||m?.quantity_unit||\"unit\").trim();\n const unit=ppRateUnit(p.performance_unit)||ppRateUnit(raw)||raw+\"/h\";\n if(mode===\"fixed\"&&duration!==null&&duration>=0)return {mode:\"fixed\",value:duration*factor,residence:null,unit:\"min/cycle\",factor,expected};\n if(mode!==\"fixed\"&&rate!==null&&rate>0)return {mode:mode===\"flow\"?\"flow\":\"throughput\",value:rate/factor,residence:mode===\"flow\"?Math.max(0,residence??0)*factor:null,unit,factor,expected};\n return {mode:\"inherited\",value:null,residence:null,unit:expected||unit,factor,expected};\n}","function ppPerfSpec(a,m){\n const p=a?.timing_profile&&typeof a.timing_profile===\"object\"&&!Array.isArray(a.timing_profile)?a.timing_profile:{};\n const mode=String(p.timing_mode??p.mode??\"fixed\").toLowerCase();\n const factor=Math.max(0.000001,ppPerfNumber(a?.process_multiplier??a?.multiplier)??1);\n const duration=ppPerfNumber(p.duration_min),rate=ppPerfNumber(p.throughput_per_hour),residence=ppPerfNumber(p.residence_min);\n if(mode===\"fixed\"&&duration!==null&&duration>=0)return {mode:\"fixed\",value:duration*factor,residence:null,unit:\"min/cycle\",factor};\n if(mode!==\"fixed\"&&rate!==null&&rate>0){\n  const unit=p.performance_unit===\"min/unit\"?\"min/unit\":\"unit/hour\";\n  return {mode:mode===\"flow\"?\"flow\":\"throughput\",value:unit===\"min/unit\"?60*factor/rate:rate/factor,residence:mode===\"flow\"?Math.max(0,residence??0)*factor:null,unit,factor};\n }\n return {mode:\"inherited\",value:null,residence:null,unit:\"unit/hour\",factor};\n}"],["function ppPerformanceCell(a,m,escape){\n const s=ppPerfSpec(a,m),units=[\"m²/h\",\"kg/h\",\"pcs/h\",\"l/h\",\"min/cycle\"];\n const input=(field,v)=>'<input class=\"pp-edit-input\" data-pp-perf=\"'+field+'\" data-pp-original=\"'+escape(ppPerfDisplay(v))+'\" inputmode=\"decimal\" value=\"'+escape(ppPerfDisplay(v))+'\" '+(s.mode===\"inherited\"?'placeholder=\"Не задано\"':'')+'>';\n const options=(units.includes(s.unit)?\"\":'<option value=\"'+escape(s.unit)+'\" selected hidden disabled>'+escape(s.unit)+'</option>')+units.map(u=>'<option value=\"'+u+'\"'+(u===s.unit?' selected':'')+'>'+u+'</option>').join(\"\");\n const select='<select class=\"pp-edit-select\" data-pp-perf-unit data-pp-original=\"'+escape(s.unit)+'\" aria-label=\"Performance unit\">'+options+'</select>';\n const flow=s.mode===\"flow\"?'<div data-pp-flow-residence><span class=\"pp-edit-muted\">Время прохождения</span>'+input(\"residence\",s.residence)+'<span class=\"pp-edit-muted\">мин</span></div>':\"\";\n const fallback=s.mode===\"inherited\"?'<div class=\"pp-edit-muted\" style=\"margin-top:4px\"><span>По времени операции</span>'+(s.factor!==1?' <span>× '+escape(ppPerfDisplay(s.factor))+'</span>':'')+'</div>':\"\";\n return '<td class=\"pp-perf-value-cell\" data-pp-performance-mode=\"'+s.mode+'\" data-pp-expected-unit=\"'+escape(s.expected||\"\")+'\">'+input(\"value\",s.value)+flow+fallback+'</td><td class=\"pp-perf-unit-cell\">'+select+'</td>';\n}","function ppPerformanceCell(a,m,escape){\n const s=ppPerfSpec(a,m),modes=[[\"unit/hour\",\"Ед./час\"],[\"min/unit\",\"Мин/ед.\"],[\"min/cycle\",\"Мин/цикл\"]];\n const input=(field,v)=>'<input class=\"pp-edit-input\" data-pp-perf=\"'+field+'\" data-pp-original=\"'+escape(ppPerfDisplay(v))+'\" inputmode=\"decimal\" value=\"'+escape(ppPerfDisplay(v))+'\" '+(s.mode===\"inherited\"?'placeholder=\"Не задано\"':'')+'>';\n const options=modes.map(([key,label])=>'<option value=\"'+key+'\"'+(key===s.unit?' selected':'')+'>'+label+'</option>').join(\"\");\n const select='<select class=\"pp-edit-select\" data-pp-perf-unit data-pp-original=\"'+s.unit+'\" aria-label=\"Calculation mode\">'+options+'</select>';\n const flow=s.mode===\"flow\"?'<div data-pp-flow-residence><span class=\"pp-edit-muted\">Время прохождения</span>'+input(\"residence\",s.residence)+'<span class=\"pp-edit-muted\">мин</span></div>':\"\";\n const fallback=s.mode===\"inherited\"?'<div class=\"pp-edit-muted\" style=\"margin-top:4px\"><span>По времени операции</span>'+(s.factor!==1?' <span>× '+escape(ppPerfDisplay(s.factor))+'</span>':'')+'</div>':\"\";\n return '<td class=\"pp-perf-value-cell\" data-pp-performance-mode=\"'+s.mode+'\" data-pp-factor=\"'+s.factor+'\">'+input(\"value\",s.value)+flow+fallback+'</td><td class=\"pp-perf-unit-cell\">'+select+'</td>';\n}"],["function ppValidateEquipmentPerformance(root){\n const ru=document.getElementById(\"ppLanguageSelect\")?.value===\"ru\";\n const reject=(field,en,rus)=>{field.setCustomValidity(ru?rus:en);field.reportValidity();field.focus();return false};\n for(const cell of root.querySelectorAll(\"[data-pp-performance-mode]\")){\n  const input=cell.querySelector('[data-pp-perf=\"value\"]'),sel=cell.closest(\"tr\").querySelector(\"[data-pp-perf-unit]\"),res=cell.querySelector('[data-pp-perf=\"residence\"]');\n  for(const e of [input,sel,res])e?.setCustomValidity(\"\");\n  const changed=ppPerfChanged(input)||ppPerfChanged(sel);\n  if(changed){\n   const unit=sel.value,v=ppPerfNumber(input.value);\n   if(!(cell.dataset.ppPerformanceMode===\"inherited\"&&!ppPerfChanged(sel)&&String(input.value).trim()===\"\")&&(v===null||(unit===\"min/cycle\"?v<0:v<=0)))return reject(input,\"Enter a valid number.\",\"Введите допустимое число.\");\n   // The scheduler consumes product quantities in the project's quantity unit.\n   // Do not pretend that different physical dimensions are interchangeable.\n   if(unit!==\"min/cycle\"&&cell.dataset.ppExpectedUnit&&unit!==cell.dataset.ppExpectedUnit)return reject(sel,\"Performance unit must match the production quantity unit (\"+cell.dataset.ppExpectedUnit+\").\",\"Единица производительности должна соответствовать единице объёма производства (\"+cell.dataset.ppExpectedUnit+\").\");\n  }\n  if(sel.value!==\"min/cycle\"&&ppPerfChanged(res)){\n   const v=ppPerfNumber(res.value);if(v===null||v<0)return reject(res,\"Enter a valid number.\",\"Введите допустимое число.\");\n  }\n }\n return true;\n}","function ppValidateEquipmentPerformance(root){\n const ru=document.getElementById(\"ppLanguageSelect\")?.value===\"ru\";\n const reject=(field,en,rus)=>{field.setCustomValidity(ru?rus:en);field.reportValidity();field.focus();return false};\n for(const cell of root.querySelectorAll(\"[data-pp-performance-mode]\")){\n  const input=cell.querySelector('[data-pp-perf=\"value\"]'),sel=cell.closest(\"tr\").querySelector(\"[data-pp-perf-unit]\"),res=cell.querySelector('[data-pp-perf=\"residence\"]');\n  for(const e of [input,sel,res])e?.setCustomValidity(\"\");\n  if(ppPerfChanged(input)||ppPerfChanged(sel)){\n   const unit=sel.value,v=ppPerfNumber(input.value),factor=Number(cell.dataset.ppFactor)||1;\n   const optional=cell.dataset.ppPerformanceMode===\"inherited\"&&!ppPerfChanged(sel)&&String(input.value).trim()===\"\";\n   const converted=unit===\"min/cycle\"?v/factor:unit===\"min/unit\"?60*factor/v:v*factor;\n   if(!optional&&(v===null||![\"unit/hour\",\"min/unit\",\"min/cycle\"].includes(unit)||(unit===\"min/cycle\"?v<0:v<=0)||!Number.isFinite(converted)||(unit!==\"min/cycle\"&&converted<=0)))return reject(input,\"Enter a valid number.\",\"Введите допустимое число.\");\n  }\n  if(sel.value!==\"min/cycle\"&&ppPerfChanged(res)){\n   const v=ppPerfNumber(res.value);\n   if(v===null||v<0||!Number.isFinite(v/(Number(cell.dataset.ppFactor)||1)))return reject(res,\"Enter a valid number.\",\"Введите допустимое число.\");\n  }\n }\n return true;\n}"],["function ppApplyEquipmentPerformance(base,row){\n const input=row.querySelector('[data-pp-perf=\"value\"]'),res=row.querySelector('[data-pp-perf=\"residence\"]'),sel=row.querySelector(\"[data-pp-perf-unit]\");\n if(!input)return base;\n const mode=input.closest(\"[data-pp-performance-mode]\")?.dataset.ppPerformanceMode;\n const unit=sel?.value??(mode===\"fixed\"?\"min/cycle\":ppPerfSpec(base,{}).unit);\n const factor=Math.max(0.000001,ppPerfNumber(base.process_multiplier??base.multiplier)??1);\n const changedUnit=ppPerfChanged(sel),changed=ppPerfChanged(input)||changedUnit,changedResidence=unit!==\"min/cycle\"&&ppPerfChanged(res);\n if(!changed&&!changedResidence){if(base.process_multiplier==null&&base.multiplier==null)base.process_multiplier=1;return base}\n const p=base.timing_profile&&typeof base.timing_profile===\"object\"&&!Array.isArray(base.timing_profile)?{...base.timing_profile}:{};\n if(changed){\n  const v=ppPerfNumber(input.value);\n  if(v===null&&mode===\"inherited\"&&!changedUnit)return base;\n  if(unit===\"min/cycle\"){\n   p.timing_mode=\"fixed\";if(Object.hasOwn(p,\"mode\"))p.mode=\"fixed\";p.duration_min=v/factor;\n  }else{\n   const newMode=mode===\"flow\"?\"flow\":\"throughput\";\n   p.timing_mode=newMode;if(Object.hasOwn(p,\"mode\"))p.mode=newMode;p.throughput_per_hour=v*factor;\n  }\n  if(changedUnit||Object.hasOwn(p,\"performance_unit\"))p.performance_unit=unit;\n }\n if(changedResidence&&mode===\"flow\")p.residence_min=ppPerfNumber(res.value)/factor;\n base.timing_profile=p;\n if(base.process_multiplier==null&&base.multiplier==null)base.process_multiplier=1;\n return base;\n}","function ppApplyEquipmentPerformance(base,row){\n const input=row.querySelector('[data-pp-perf=\"value\"]'),res=row.querySelector('[data-pp-perf=\"residence\"]'),sel=row.querySelector(\"[data-pp-perf-unit]\");\n if(!input)return base;\n const mode=input.closest(\"[data-pp-performance-mode]\")?.dataset.ppPerformanceMode;\n const unit=sel?.value??ppPerfSpec(base,{}).unit;\n const factor=Math.max(0.000001,ppPerfNumber(base.process_multiplier??base.multiplier)??1);\n const changedUnit=ppPerfChanged(sel),changed=ppPerfChanged(input)||changedUnit,changedResidence=unit!==\"min/cycle\"&&ppPerfChanged(res);\n if(!changed&&!changedResidence){if(base.process_multiplier==null&&base.multiplier==null)base.process_multiplier=1;return base}\n const p=base.timing_profile&&typeof base.timing_profile===\"object\"&&!Array.isArray(base.timing_profile)?{...base.timing_profile}:{};\n if(changed){\n  const v=ppPerfNumber(input.value);\n  if(v===null&&mode===\"inherited\"&&!changedUnit)return base;\n  if(unit===\"min/cycle\"){\n   p.timing_mode=\"fixed\";if(Object.hasOwn(p,\"mode\"))p.mode=\"fixed\";p.duration_min=v/factor;\n  }else{\n   const newMode=mode===\"flow\"?\"flow\":\"throughput\";\n   p.timing_mode=newMode;if(Object.hasOwn(p,\"mode\"))p.mode=newMode;\n   // Both variable modes share the same native rate representation.\n   p.throughput_per_hour=unit===\"min/unit\"?60*factor/v:v*factor;\n  }\n  p.performance_unit=unit;\n }\n if(changedResidence&&mode===\"flow\")p.residence_min=ppPerfNumber(res.value)/factor;\n base.timing_profile=p;\n if(base.process_multiplier==null&&base.multiplier==null)base.process_multiplier=1;\n return base;\n}"]];
export const translations={"Единица расчёта":"Calculation mode","Ед./час":"Unit/hour","Мин/ед.":"Min/unit","Мин/цикл":"Min/cycle"};
export const priorArgs=[oldCell,newCell,css];
export function transformPage(html){return transformModes(html,transformPerformanceColumns,priorArgs,replacements,translations)}
export function patchSource(auth){
 assert(!auth.includes("function ppCalculationModesPage("),"CALCULATION_MODES_ALREADY_INSTALLED");
 const possible=["const assistantHtml=ppEquipmentPerformanceUnitsPage(ppEquipmentGroupsPage(ppProjectCardsLanguagePage(ppHideLaunchSettingsPage(ppLaunchAnalyticsPage(ppBottleneckLanguagePage(ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded))))))))))))))))));","const assistantHtml=ppPerformanceColumnsPage(ppEquipmentPerformanceUnitsPage(ppEquipmentGroupsPage(ppProjectCardsLanguagePage(ppHideLaunchSettingsPage(ppLaunchAnalyticsPage(ppBottleneckLanguagePage(ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded)))))))))))))))))));"];
 const matches=possible.filter(a=>auth.split(a).length===2);assert.equal(matches.length,1,"CALCULATION_MODES_AUTH_ANCHOR_DRIFT");
 const before=matches[0],after="const assistantHtml=ppCalculationModesPage("+before.slice("const assistantHtml=".length,-1)+");";
 const append="\n// PP_EQUIPMENT_CALCULATION_MODES_V1\nfunction ppCalculationModesPage(html){return ("+transformModes.toString()+")(html,("+transformPerformanceColumns.toString()+"),"+JSON.stringify(priorArgs)+","+JSON.stringify(replacements)+","+JSON.stringify(translations)+");}\n";
 const result=auth.replace(before,after)+append;
 assert.equal(result.slice(0,-append.length).replace(after,before),auth);
 return result;
}
if(process.argv[1]?.endsWith("/equipment-calculation-modes-20261127/patch.mjs")){
 const [input,output]=process.argv.slice(2);assert(input&&output);writeFileSync(output,patchSource(readFileSync(input,"utf8")),{mode:0o600});console.log("CALCULATION_MODES_EXACT_PATCH_PASS");
}
