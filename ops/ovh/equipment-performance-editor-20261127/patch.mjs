import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
export function ppPerfNumber(v){
 if(v===null||v===undefined||typeof v==="boolean"||String(v).trim()==="")return null;
 const n=Number(String(v).trim().replace(",","."));
 return Number.isFinite(n)?n:null;
}
export function ppPerfSpec(a,m){
 const p=a?.timing_profile&&typeof a.timing_profile==="object"&&!Array.isArray(a.timing_profile)?a.timing_profile:{};
 const mode=String(p.timing_mode??p.mode??"fixed").toLowerCase();
 const factor=Math.max(0.000001,ppPerfNumber(a?.process_multiplier??a?.multiplier)??1);
 const duration=ppPerfNumber(p.duration_min),rate=ppPerfNumber(p.throughput_per_hour),residence=ppPerfNumber(p.residence_min);
 const raw=String(a?.capacity_unit||m?.quantity_unit||"unit").trim();
 const units={"m2":"m²","м2":"m²","м²":"m²","m3":"m³","м3":"m³","м³":"m³","шт":"pcs","шт.":"pcs","кг":"kg","л":"l"};
 const unit=Object.hasOwn(units,raw)?units[raw]:raw;
 if(mode==="fixed"&&duration!==null&&duration>=0)return {mode:"fixed",value:duration*factor,residence:null,unit:"min",factor};
 if(mode!=="fixed"&&rate!==null&&rate>0)return {mode:mode==="flow"?"flow":"throughput",value:rate/factor,residence:mode==="flow"?Math.max(0,residence??0)*factor:null,unit:unit+"/h",factor};
 return {mode:"inherited",value:null,residence:null,unit:unit+"/h",factor};
}
export function ppPerfDisplay(v){
 if(v===null)return "";
 // Only the presentation is rounded. Saving an unchanged field preserves
 // the full original number, profile, and coefficient byte-for-byte.
 if(v!==0&&Math.abs(v)<1e-6)return String(v);
 return String(Number(v.toPrecision(12)));
}
export function ppPerformanceCell(a,m,escape){
 const s=ppPerfSpec(a,m);
 const input=(field,v)=>'<input class="pp-edit-input" data-pp-perf="'+field+'" data-pp-original="'+escape(ppPerfDisplay(v))+'" inputmode="decimal" value="'+escape(ppPerfDisplay(v))+'" '+(s.mode==="inherited"?'placeholder="Не задано"':'')+' style="min-width:0;flex:1 1 0">';
 const label=s.mode==="fixed"?"мин/цикл":s.unit;
 const first='<div style="display:flex;align-items:center;gap:8px">'+input("value",s.value)+'<span class="pp-edit-muted" style="white-space:nowrap">'+escape(label)+'</span></div>';
 const flow=s.mode==="flow"?'<div style="display:flex;align-items:center;gap:8px;margin-top:5px"><span class="pp-edit-muted">Время прохождения</span>'+input("residence",s.residence)+'<span class="pp-edit-muted">мин</span></div>':"";
 const fallback=s.mode==="inherited"?'<div class="pp-edit-muted" style="margin-top:4px"><span>По времени операции</span>'+(s.factor!==1?' <span>× '+escape(ppPerfDisplay(s.factor))+'</span>':'')+'</div>':"";
 return '<td data-pp-performance-mode="'+s.mode+'">'+first+flow+fallback+'</td>';
}
export function ppPerfChanged(input){
 return input&&String(input.value).trim()!==String(input.dataset.ppOriginal??"");
}
export function ppValidateEquipmentPerformance(root){
 for(const input of root.querySelectorAll("[data-pp-perf]")){
  input.setCustomValidity("");
  if(!ppPerfChanged(input))continue;
  const mode=input.closest("[data-pp-performance-mode]")?.dataset.ppPerformanceMode;
  const value=ppPerfNumber(input.value);
  const optional=mode==="inherited"&&String(input.value).trim()==="";
  const nonnegative=mode==="fixed"||input.dataset.ppPerf==="residence";
  if(!optional&&(value===null||(nonnegative?value<0:value<=0))){
   const ru=document.getElementById("ppLanguageSelect")?.value==="ru";
   input.setCustomValidity(ru?"Введите допустимое число.":"Enter a valid number.");
   input.reportValidity();input.focus();return false;
  }
 }
 return true;
}
export function ppApplyEquipmentPerformance(base,row){
 const input=row.querySelector('[data-pp-perf="value"]'),res=row.querySelector('[data-pp-perf="residence"]');
 if(!input)return base;
 const mode=input.closest("[data-pp-performance-mode]")?.dataset.ppPerformanceMode;
 const factor=Math.max(0.000001,ppPerfNumber(base.process_multiplier??base.multiplier)??1);
 const changed=ppPerfChanged(input),changedResidence=ppPerfChanged(res);
 if(!changed&&!changedResidence){
  if(base.process_multiplier==null&&base.multiplier==null)base.process_multiplier=1;
  return base;
 }
 const p=base.timing_profile&&typeof base.timing_profile==="object"&&!Array.isArray(base.timing_profile)?{...base.timing_profile}:{};
 // Keep existing factor and any alternative profiles/conditions intact.
 // Store the nominal value inverse to the factor, so the number the user
 // entered is EXACTLY the effective value the native scheduler will use.
 if(changed){
  const v=ppPerfNumber(input.value);
  if(v===null&&mode==="inherited")return base;
  if(mode==="fixed")p.duration_min=v/factor;
  else{
   if(mode==="inherited"){
    p.timing_mode="throughput";
    if(Object.hasOwn(p,"mode"))p.mode="throughput";
   }
   p.throughput_per_hour=v*factor;
  }
 }
 if(changedResidence&&mode==="flow")p.residence_min=ppPerfNumber(res.value)/factor;
 base.timing_profile=p;
 if(base.process_multiplier==null&&base.multiplier==null)base.process_multiplier=1;
 return base;
}
export function transformEquipmentPerformance(html,helpers,translations){
 if(typeof html!=="string"||html.includes("PP_EQUIPMENT_PERFORMANCE_V1")||!html.includes("PP_EQUIPMENT_KIND_GROUPS_V1"))return html;
 const matches=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter(m=>/\bid=["']ppEditableTablesJs["']/.test(m[1]));
 if(matches.length!==1)return html;
 const match=matches[0],source=match[2];
 const oldCell=`'<td><input class="pp-edit-input" data-f="process_multiplier" inputmode="decimal" value="'+esc(a.process_multiplier??1)+'"></td>'`;
 const edits=[
 ["function equipmentRow(a,idx){","/* PP_EQUIPMENT_PERFORMANCE_V1 */\n"+helpers+"\nfunction equipmentRow(a,idx){"],
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
 return result.replace(anchor,()=>anchor+"\nfor(const [ru,en] of Object.entries("+JSON.stringify(translations)+"))trMap.set(ru,en);");
}
export const helpers="function ppPerfNumber(v){\n if(v===null||v===undefined||typeof v===\"boolean\"||String(v).trim()===\"\")return null;\n const n=Number(String(v).trim().replace(\",\",\".\"));\n return Number.isFinite(n)?n:null;\n}\nfunction ppPerfSpec(a,m){\n const p=a?.timing_profile&&typeof a.timing_profile===\"object\"&&!Array.isArray(a.timing_profile)?a.timing_profile:{};\n const mode=String(p.timing_mode??p.mode??\"fixed\").toLowerCase();\n const factor=Math.max(0.000001,ppPerfNumber(a?.process_multiplier??a?.multiplier)??1);\n const duration=ppPerfNumber(p.duration_min),rate=ppPerfNumber(p.throughput_per_hour),residence=ppPerfNumber(p.residence_min);\n const raw=String(a?.capacity_unit||m?.quantity_unit||\"unit\").trim();\n const units={\"m2\":\"m²\",\"м2\":\"m²\",\"м²\":\"m²\",\"m3\":\"m³\",\"м3\":\"m³\",\"м³\":\"m³\",\"шт\":\"pcs\",\"шт.\":\"pcs\",\"кг\":\"kg\",\"л\":\"l\"};\n const unit=Object.hasOwn(units,raw)?units[raw]:raw;\n if(mode===\"fixed\"&&duration!==null&&duration>=0)return {mode:\"fixed\",value:duration*factor,residence:null,unit:\"min\",factor};\n if(mode!==\"fixed\"&&rate!==null&&rate>0)return {mode:mode===\"flow\"?\"flow\":\"throughput\",value:rate/factor,residence:mode===\"flow\"?Math.max(0,residence??0)*factor:null,unit:unit+\"/h\",factor};\n return {mode:\"inherited\",value:null,residence:null,unit:unit+\"/h\",factor};\n}\nfunction ppPerfDisplay(v){\n if(v===null)return \"\";\n // Only the presentation is rounded. Saving an unchanged field preserves\n // the full original number, profile, and coefficient byte-for-byte.\n if(v!==0&&Math.abs(v)<1e-6)return String(v);\n return String(Number(v.toPrecision(12)));\n}\nfunction ppPerformanceCell(a,m,escape){\n const s=ppPerfSpec(a,m);\n const input=(field,v)=>'<input class=\"pp-edit-input\" data-pp-perf=\"'+field+'\" data-pp-original=\"'+escape(ppPerfDisplay(v))+'\" inputmode=\"decimal\" value=\"'+escape(ppPerfDisplay(v))+'\" '+(s.mode===\"inherited\"?'placeholder=\"Не задано\"':'')+' style=\"min-width:0;flex:1 1 0\">';\n const label=s.mode===\"fixed\"?\"мин/цикл\":s.unit;\n const first='<div style=\"display:flex;align-items:center;gap:8px\">'+input(\"value\",s.value)+'<span class=\"pp-edit-muted\" style=\"white-space:nowrap\">'+escape(label)+'</span></div>';\n const flow=s.mode===\"flow\"?'<div style=\"display:flex;align-items:center;gap:8px;margin-top:5px\"><span class=\"pp-edit-muted\">Время прохождения</span>'+input(\"residence\",s.residence)+'<span class=\"pp-edit-muted\">мин</span></div>':\"\";\n const fallback=s.mode===\"inherited\"?'<div class=\"pp-edit-muted\" style=\"margin-top:4px\"><span>По времени операции</span>'+(s.factor!==1?' <span>× '+escape(ppPerfDisplay(s.factor))+'</span>':'')+'</div>':\"\";\n return '<td data-pp-performance-mode=\"'+s.mode+'\">'+first+flow+fallback+'</td>';\n}\nfunction ppPerfChanged(input){\n return input&&String(input.value).trim()!==String(input.dataset.ppOriginal??\"\");\n}\nfunction ppValidateEquipmentPerformance(root){\n for(const input of root.querySelectorAll(\"[data-pp-perf]\")){\n  input.setCustomValidity(\"\");\n  if(!ppPerfChanged(input))continue;\n  const mode=input.closest(\"[data-pp-performance-mode]\")?.dataset.ppPerformanceMode;\n  const value=ppPerfNumber(input.value);\n  const optional=mode===\"inherited\"&&String(input.value).trim()===\"\";\n  const nonnegative=mode===\"fixed\"||input.dataset.ppPerf===\"residence\";\n  if(!optional&&(value===null||(nonnegative?value<0:value<=0))){\n   const ru=document.getElementById(\"ppLanguageSelect\")?.value===\"ru\";\n   input.setCustomValidity(ru?\"Введите допустимое число.\":\"Enter a valid number.\");\n   input.reportValidity();input.focus();return false;\n  }\n }\n return true;\n}\nfunction ppApplyEquipmentPerformance(base,row){\n const input=row.querySelector('[data-pp-perf=\"value\"]'),res=row.querySelector('[data-pp-perf=\"residence\"]');\n if(!input)return base;\n const mode=input.closest(\"[data-pp-performance-mode]\")?.dataset.ppPerformanceMode;\n const factor=Math.max(0.000001,ppPerfNumber(base.process_multiplier??base.multiplier)??1);\n const changed=ppPerfChanged(input),changedResidence=ppPerfChanged(res);\n if(!changed&&!changedResidence){\n  if(base.process_multiplier==null&&base.multiplier==null)base.process_multiplier=1;\n  return base;\n }\n const p=base.timing_profile&&typeof base.timing_profile===\"object\"&&!Array.isArray(base.timing_profile)?{...base.timing_profile}:{};\n // Keep existing factor and any alternative profiles/conditions intact.\n // Store the nominal value inverse to the factor, so the number the user\n // entered is EXACTLY the effective value the native scheduler will use.\n if(changed){\n  const v=ppPerfNumber(input.value);\n  if(v===null&&mode===\"inherited\")return base;\n  if(mode===\"fixed\")p.duration_min=v/factor;\n  else{\n   if(mode===\"inherited\"){\n    p.timing_mode=\"throughput\";\n    if(Object.hasOwn(p,\"mode\"))p.mode=\"throughput\";\n   }\n   p.throughput_per_hour=v*factor;\n  }\n }\n if(changedResidence&&mode===\"flow\")p.residence_min=ppPerfNumber(res.value)/factor;\n base.timing_profile=p;\n if(base.process_multiplier==null&&base.multiplier==null)base.process_multiplier=1;\n return base;\n}";
export const translations={"Производительность":"Performance","мин/цикл":"min/cycle","Время прохождения":"Residence time","По времени операции":"Uses operation duration","Не задано":"Not set"};
export function patchSource(auth){
 assert(!auth.includes("function ppEquipmentPerformancePage("),"EQUIPMENT_PERFORMANCE_ALREADY_INSTALLED");
 const before="const assistantHtml=ppEquipmentGroupsPage(ppProjectCardsLanguagePage(ppHideLaunchSettingsPage(ppLaunchAnalyticsPage(ppBottleneckLanguagePage(ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded)))))))))))))))));",after="const assistantHtml=ppEquipmentPerformancePage(ppEquipmentGroupsPage(ppProjectCardsLanguagePage(ppHideLaunchSettingsPage(ppLaunchAnalyticsPage(ppBottleneckLanguagePage(ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded))))))))))))))))));";
 assert.equal(auth.split(before).length,2,"EQUIPMENT_PERFORMANCE_AUTH_ANCHOR_DRIFT");
 const append="\n// PP_EQUIPMENT_PERFORMANCE_V1\nfunction ppEquipmentPerformancePage(html){return ("+transformEquipmentPerformance.toString()+")(html,"+JSON.stringify(helpers)+","+JSON.stringify(translations)+");}\n";
 const result=auth.replace(before,after)+append;
 assert.equal(result.slice(0,-append.length).replace(after,before),auth);return result;
}
if(process.argv[1]?.endsWith("/equipment-performance-editor-20261127/patch.mjs")){
 const [input,output]=process.argv.slice(2);assert(input&&output);writeFileSync(output,patchSource(readFileSync(input,"utf8")),{mode:0o600});console.log("EQUIPMENT_PERFORMANCE_EXACT_PATCH_PASS");
}
