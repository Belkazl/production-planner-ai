import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {helpers} from "../equipment-performance-units-20261127/patch.mjs";
import {ppPerfSpec,ppPerformanceCell,ppApplyEquipmentPerformance,transformPage,patchSource} from "./patch.mjs";
const row=(mode,unit,value,oldUnit,oldValue,residence,oldResidence)=>{
 const field=(value,original)=>({value:String(value),dataset:{ppOriginal:String(original)},closest:()=>({dataset:{ppPerformanceMode:mode}})});
 return {querySelector:s=>s==="[data-pp-perf-unit]"?field(unit,oldUnit):s.includes('"value"')?field(value,oldValue):residence==null?null:field(residence,oldResidence)};
};
test("generic choices, preserve existing rates and fixed cycles regardless of product units",()=>{
 for(const unit of ["m2","kg","pcs","l","ton","custom"]){
  const a={capacity_unit:unit,process_multiplier:.8,timing_profile:{timing_mode:"throughput",throughput_per_hour:900,performance_unit:"m²/h"}};
  const snapshot=structuredClone(a);assert.equal(ppPerfSpec(a,{quantity_unit:unit}).value,1125);
  const markup=ppPerformanceCell(a,{quantity_unit:unit},String);
  assert.deepEqual([...markup.matchAll(/<option value="([^"]+)"/g)].map(x=>x[1]),["unit/hour","min/unit","min/cycle"]);
  assert.equal((markup.match(/<td\b/g)||[]).length,2);
  ppApplyEquipmentPerformance(a,row("throughput","unit/hour",1125,"unit/hour",1125));assert.deepEqual(a,snapshot);
 }
});
test("minutes per unit maps to native rate, preserving factor and effective duration",()=>{
 const a={process_multiplier:.8,timing_profile:{timing_mode:"throughput",throughput_per_hour:900}};
 ppApplyEquipmentPerformance(a,row("throughput","min/unit",.05,"unit/hour",1125));
 assert.equal(a.timing_profile.throughput_per_hour,960);assert.equal(a.timing_profile.performance_unit,"min/unit");
 assert.equal(ppPerfSpec(a,{}).value,.05);assert.equal(ppPerfSpec(a,{}).unit,"min/unit");
 const q=200;assert.equal(q/a.timing_profile.throughput_per_hour*60*a.process_multiplier,10);
 ppApplyEquipmentPerformance(a,row("throughput","min/cycle",16,"min/unit",.05));
 assert.equal(a.timing_profile.duration_min,20);assert.equal(ppPerfSpec(a,{}).value,16);
 ppApplyEquipmentPerformance(a,row("fixed","unit/hour",1000,"min/cycle",16));
 assert.equal(a.timing_profile.throughput_per_hour,800);assert.equal(ppPerfSpec(a,{}).value,1000);
});
test("flow residence time unchanged when switching rate representation",()=>{
 const a={process_multiplier:.8,timing_profile:{timing_mode:"flow",throughput_per_hour:600,residence_min:5},timing_profiles:[{custom:true}]};
 ppApplyEquipmentPerformance(a,row("flow","min/unit",.08,"unit/hour",750,4,4));
 assert.equal(a.timing_profile.throughput_per_hour,600);assert.equal(a.timing_profile.timing_mode,"flow");
 assert.equal(a.timing_profile.residence_min,5);assert.equal(ppPerfSpec(a,{}).residence,4);assert.equal(ppPerfSpec(a,{}).value,.08);
 assert.deepEqual(a.timing_profiles,[{custom:true}]);
});
test("exact transform on units-only and columns page; no previous wrappers removed",()=>{
 const html='<html><head></head><body><script>const trMap=new Map(Object.entries(texts));</script><script id="ppEditableTablesJs">/* PP_EQUIPMENT_PERFORMANCE_UNITS_V1 */\n'+helpers+'\nfunction header(){return "<th>Производительность</th>"}'+'</script></body></html>';
 const out=transformPage(html);assert.notEqual(out,html);assert.equal(transformPage(out),out);assert(out.includes('Calculation mode'));assert(out.includes('PP_EQUIPMENT_PERFORMANCE_COLUMNS_V1'));
 new vm.Script(out.match(/<script id="ppEditableTablesJs">([\s\S]*?)<\/script>/)[1]);
 for(const anchor of ["const assistantHtml=ppEquipmentPerformanceUnitsPage(ppEquipmentGroupsPage(ppProjectCardsLanguagePage(ppHideLaunchSettingsPage(ppLaunchAnalyticsPage(ppBottleneckLanguagePage(ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded))))))))))))))))));","const assistantHtml=ppPerformanceColumnsPage(ppEquipmentPerformanceUnitsPage(ppEquipmentGroupsPage(ppProjectCardsLanguagePage(ppHideLaunchSettingsPage(ppLaunchAnalyticsPage(ppBottleneckLanguagePage(ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded)))))))))))))))))));"]){const original="function f(branded){"+anchor+"return assistantHtml;}";new vm.Script(patchSource(original))}
 assert.throws(()=>patchSource("unrelated"));
});
