import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
export function ppPerfNumber(v){
 if(v===null||v===undefined||typeof v==="boolean"||String(v).trim()==="")return null;
 const n=Number(String(v).trim().replace(",","."));
 return Number.isFinite(n)?n:null;
}
export function ppRateUnit(raw){
 const key=String(raw??"").trim().toLowerCase().replace(/\/h$/,"").replace(/\/ч$/,"");
 const map={"m2":"m²/h","м2":"m²/h","m²":"m²/h","м²":"m²/h","kg":"kg/h","кг":"kg/h","pcs":"pcs/h","pc":"pcs/h","piece":"pcs/h","pieces":"pcs/h","шт":"pcs/h","шт.":"pcs/h","l":"l/h","л":"l/h","liter":"l/h","litre":"l/h"};
 return map[key]||null;
}
export function ppPerfSpec(a,m){
 const p=a?.timing_profile&&typeof a.timing_profile==="object"&&!Array.isArray(a.timing_profile)?a.timing_profile:{};
 const mode=String(p.timing_mode??p.mode??"fixed").toLowerCase();
 const factor=Math.max(0.000001,ppPerfNumber(a?.process_multiplier??a?.multiplier)??1);
 const duration=ppPerfNumber(p.duration_min),rate=ppPerfNumber(p.throughput_per_hour),residence=ppPerfNumber(p.residence_min);
 const expected=ppRateUnit(m?.quantity_unit||a?.capacity_unit);
 const raw=String(a?.capacity_unit||m?.quantity_unit||"unit").trim();
 const unit=ppRateUnit(p.performance_unit)||ppRateUnit(raw)||raw+"/h";
 if(mode==="fixed"&&duration!==null&&duration>=0)return {mode:"fixed",value:duration*factor,residence:null,unit:"min/cycle",factor,expected};
 if(mode!=="fixed"&&rate!==null&&rate>0)return {mode:mode==="flow"?"flow":"throughput",value:rate/factor,residence:mode==="flow"?Math.max(0,residence??0)*factor:null,unit,factor,expected};
 return {mode:"inherited",value:null,residence:null,unit:expected||unit,factor,expected};
}
export function ppPerfDisplay(v){
 if(v===null)return "";
 // Only the presentation is rounded. Saving an unchanged field preserves
 // the full original number, profile, and coefficient byte-for-byte.
 if(v!==0&&Math.abs(v)<1e-6)return String(v);
 return String(Number(v.toPrecision(12)));
}
export function ppPerformanceCell(a,m,escape){
 const s=ppPerfSpec(a,m),units=["m²/h","kg/h","pcs/h","l/h","min/cycle"];
 const input=(field,v)=>'<input class="pp-edit-input" data-pp-perf="'+field+'" data-pp-original="'+escape(ppPerfDisplay(v))+'" inputmode="decimal" value="'+escape(ppPerfDisplay(v))+'" '+(s.mode==="inherited"?'placeholder="Не задано"':'')+' style="min-width:0;flex:1 1 0">';
 // Preserve uncommon legacy units without silently changing their numerical meaning.
 const options=(units.includes(s.unit)?"":'<option value="'+escape(s.unit)+'" selected hidden disabled>'+escape(s.unit)+'</option>')+units.map(u=>'<option value="'+u+'"'+(u===s.unit?' selected':'')+'>'+u+'</option>').join("");
 const select='<select class="pp-edit-select" data-pp-perf-unit data-pp-original="'+escape(s.unit)+'" aria-label="Performance unit" style="width:110px;min-width:110px;flex:0 0 110px">'+options+'</select>';
 const first='<div style="display:flex;align-items:center;gap:8px">'+input("value",s.value)+select+'</div>';
 const flow=s.mode==="flow"?'<div data-pp-flow-residence style="display:flex;align-items:center;gap:8px;margin-top:5px"><span class="pp-edit-muted">Время прохождения</span>'+input("residence",s.residence)+'<span class="pp-edit-muted">мин</span></div>':"";
 const fallback=s.mode==="inherited"?'<div class="pp-edit-muted" style="margin-top:4px"><span>По времени операции</span>'+(s.factor!==1?' <span>× '+escape(ppPerfDisplay(s.factor))+'</span>':'')+'</div>':"";
 return '<td data-pp-performance-mode="'+s.mode+'" data-pp-expected-unit="'+escape(s.expected||"")+'">'+first+flow+fallback+'</td>';
}
export function ppPerfChanged(input){
 return input&&String(input.value).trim()!==String(input.dataset.ppOriginal??"");
}
export function ppValidateEquipmentPerformance(root){
 const ru=document.getElementById("ppLanguageSelect")?.value==="ru";
 const reject=(field,en,rus)=>{field.setCustomValidity(ru?rus:en);field.reportValidity();field.focus();return false};
 for(const cell of root.querySelectorAll("[data-pp-performance-mode]")){
  const input=cell.querySelector('[data-pp-perf="value"]'),sel=cell.querySelector("[data-pp-perf-unit]"),res=cell.querySelector('[data-pp-perf="residence"]');
  for(const e of [input,sel,res])e?.setCustomValidity("");
  const changed=ppPerfChanged(input)||ppPerfChanged(sel);
  if(changed){
   const unit=sel.value,v=ppPerfNumber(input.value);
   if(!(cell.dataset.ppPerformanceMode==="inherited"&&!ppPerfChanged(sel)&&String(input.value).trim()==="")&&(v===null||(unit==="min/cycle"?v<0:v<=0)))return reject(input,"Enter a valid number.","Введите допустимое число.");
   // The scheduler consumes product quantities in the project's quantity unit.
   // Do not pretend that different physical dimensions are interchangeable.
   if(unit!=="min/cycle"&&cell.dataset.ppExpectedUnit&&unit!==cell.dataset.ppExpectedUnit)return reject(sel,"Performance unit must match the production quantity unit ("+cell.dataset.ppExpectedUnit+").","Единица производительности должна соответствовать единице объёма производства ("+cell.dataset.ppExpectedUnit+").");
  }
  if(sel.value!=="min/cycle"&&ppPerfChanged(res)){
   const v=ppPerfNumber(res.value);if(v===null||v<0)return reject(res,"Enter a valid number.","Введите допустимое число.");
  }
 }
 return true;
}
export function ppApplyEquipmentPerformance(base,row){
 const input=row.querySelector('[data-pp-perf="value"]'),res=row.querySelector('[data-pp-perf="residence"]'),sel=row.querySelector("[data-pp-perf-unit]");
 if(!input)return base;
 const mode=input.closest("[data-pp-performance-mode]")?.dataset.ppPerformanceMode;
 const unit=sel?.value??(mode==="fixed"?"min/cycle":ppPerfSpec(base,{}).unit);
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
   p.timing_mode=newMode;if(Object.hasOwn(p,"mode"))p.mode=newMode;p.throughput_per_hour=v*factor;
  }
  if(changedUnit||Object.hasOwn(p,"performance_unit"))p.performance_unit=unit;
 }
 if(changedResidence&&mode==="flow")p.residence_min=ppPerfNumber(res.value)/factor;
 base.timing_profile=p;
 if(base.process_multiplier==null&&base.multiplier==null)base.process_multiplier=1;
 return base;
}
export function transformEquipmentPerformance(html,helpers,translations){
 if(typeof html!=="string"||html.includes("PP_EQUIPMENT_PERFORMANCE_UNITS_V1")||!html.includes("PP_EQUIPMENT_KIND_GROUPS_V1"))return html;
 const matches=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter(m=>/\bid=["']ppEditableTablesJs["']/.test(m[1]));
 if(matches.length!==1)return html;
 const match=matches[0],source=match[2];
 const oldCell=`'<td><input class="pp-edit-input" data-f="process_multiplier" inputmode="decimal" value="'+esc(a.process_multiplier??1)+'"></td>'`;
 const edits=[
 ["function equipmentRow(a,idx){","/* PP_EQUIPMENT_PERFORMANCE_UNITS_V1 */\n"+helpers+"\nfunction equipmentRow(a,idx){"],
 [oldCell,"ppPerformanceCell(a,model,esc)"],
 ["<th>Коэф. процесса</th>","<th>Производительность</th>"],
 ["function collectAndSave(name){","function collectAndSave(name){\n    if(name==='Оборудование'&&!ppValidateEquipmentPerformance(q('sectionView')))return;"],
 [`base.process_multiplier=num(r.querySelector('[data-f="process_multiplier"]').value,1)||1;`,"ppApplyEquipmentPerformance(base,r);"]
 ];
 if(edits.some(([old])=>source.split(old).length!==2))return html;
 let next=source;
 for(const [old,replacement] of edits)next=next.replace(old,()=>replacement);
 const offset=match.index+match[0].indexOf(">")+1;
 let result=html.slice(0,offset)+next+html.slice(offset+source.length);
 const anchor="const trMap=new Map(Object.entries(texts));";
 if(result.split(anchor).length!==2)return html;
 return result.replace(anchor,()=>anchor+"\nfor(const [ru,en] of Object.entries("+JSON.stringify(translations)+"))trMap.set(ru,en);").replace("</head>",'<style>td[data-pp-performance-mode]:has(select[data-pp-perf-unit] option[value="min/cycle"]:checked) [data-pp-flow-residence]{display:none!important}</style></head>');
}
export const helpers=[ppPerfNumber,ppRateUnit,ppPerfSpec,ppPerfDisplay,ppPerformanceCell,ppPerfChanged,ppValidateEquipmentPerformance,ppApplyEquipmentPerformance].map(f=>f.toString()).join("\n");
export const translations={"Производительность":"Performance","мин/цикл":"min/cycle","Время прохождения":"Residence time","По времени операции":"Uses operation duration","Не задано":"Not set"};
export function patchSource(auth){
 assert(!auth.includes("function ppEquipmentPerformanceUnitsPage("),"EQUIPMENT_PERFORMANCE_UNITS_ALREADY_INSTALLED");
 const before="const assistantHtml=ppEquipmentGroupsPage(ppProjectCardsLanguagePage(ppHideLaunchSettingsPage(ppLaunchAnalyticsPage(ppBottleneckLanguagePage(ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded)))))))))))))))));",after="const assistantHtml=ppEquipmentPerformanceUnitsPage(ppEquipmentGroupsPage(ppProjectCardsLanguagePage(ppHideLaunchSettingsPage(ppLaunchAnalyticsPage(ppBottleneckLanguagePage(ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded))))))))))))))))));";
 assert.equal(auth.split(before).length,2,"EQUIPMENT_PERFORMANCE_UNITS_AUTH_ANCHOR_DRIFT");
 const append="\n// PP_EQUIPMENT_PERFORMANCE_UNITS_V1\nfunction ppEquipmentPerformanceUnitsPage(html){return ("+transformEquipmentPerformance.toString()+")(html,"+JSON.stringify(helpers)+","+JSON.stringify(translations)+");}\n";
 const result=auth.replace(before,after)+append;
 assert.equal(result.slice(0,-append.length).replace(after,before),auth);return result;
}
if(process.argv[1]?.endsWith("/equipment-performance-units-20261127/patch.mjs")){
 const [input,output]=process.argv.slice(2);assert(input&&output);writeFileSync(output,patchSource(readFileSync(input,"utf8")),{mode:0o600});console.log("EQUIPMENT_PERFORMANCE_UNITS_EXACT_PATCH_PASS");
}
