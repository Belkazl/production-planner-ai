import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {ppPerfSpec,ppPerfDisplay,ppApplyEquipmentPerformance,ppPerformanceCell,ppRateUnit,patchSource} from "./patch.mjs";
const row=(mode,value,old,residence,oldResidence,unit,oldUnit)=>{
 const field=(value,original)=>({value:String(value),dataset:{ppOriginal:String(original)},closest:()=>({dataset:{ppPerformanceMode:mode}})});
 return {querySelector:s=>s==="[data-pp-perf-unit]"?(unit?field(unit,oldUnit):null):s.includes('"value"')?field(value,old):residence==null?null:field(residence,oldResidence)};
};
test("actual effective speed includes the already deployed multiplier once",()=>{
 const a={id:"P",capacity_unit:"m2",process_multiplier:.8,timing_profile:{timing_mode:"throughput",throughput_per_hour:900}};
 assert.equal(ppPerfSpec(a,{}).value,1125);assert.equal(ppPerfSpec(a,{}).unit,"m²/h");
 const copy=structuredClone(a);ppApplyEquipmentPerformance(a,row("throughput",1125,1125));assert.deepEqual(a,copy);
 ppApplyEquipmentPerformance(a,row("throughput",1000,1125));assert.equal(a.timing_profile.throughput_per_hour,800);assert.equal(ppPerfSpec(a,{}).value,1000);assert.equal(a.process_multiplier,.8);
});
test("fixed and flow timings retain the same effective calculation",()=>{
 const fixed={multiplier:1.2,timing_profile:{timing_mode:"fixed",duration_min:10,extra:"preserve"}};
 assert.equal(ppPerfSpec(fixed,{}).value,12);ppApplyEquipmentPerformance(fixed,row("fixed",15,12));
 assert.equal(ppPerfSpec(fixed,{}).value,15);assert.equal(fixed.timing_profile.extra,"preserve");
 const flow={process_multiplier:.8,timing_profile:{mode:"flow",throughput_per_hour:600,residence_min:5},timing_profiles:[{throughput_per_hour:500}]};
 assert.equal(ppPerfSpec(flow,{}).value,750);assert.equal(ppPerfSpec(flow,{}).residence,4);
 ppApplyEquipmentPerformance(flow,row("flow",800,750,6,4));assert.equal(ppPerfSpec(flow,{}).value,800);assert.equal(ppPerfSpec(flow,{}).residence,6);assert.equal(flow.timing_profiles[0].throughput_per_hour,500);
});
test("no invented legacy speed, define explicit new speed only if entered",()=>{
 const a={process_multiplier:1.3};assert.equal(ppPerfSpec(a,{quantity_unit:"kg"}).value,null);
 const original=structuredClone(a);ppApplyEquipmentPerformance(a,row("inherited","",""));assert.deepEqual(a,original);
 ppApplyEquipmentPerformance(a,row("inherited",100,""));assert.equal(ppPerfSpec(a,{quantity_unit:"kg"}).value,100);assert.equal(a.timing_profile.timing_mode,"throughput");
 assert.equal(ppPerfDisplay(1/3),"0.333333333333");
 assert(ppPerformanceCell(a,{quantity_unit:"kg"},String).includes("kg/h"));
});
test("valid wrapper preserves every existing patch",()=>{
 const s="function f(branded){"+"const assistantHtml=ppEquipmentGroupsPage(ppProjectCardsLanguagePage(ppHideLaunchSettingsPage(ppLaunchAnalyticsPage(ppBottleneckLanguagePage(ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded)))))))))))))))));"+"return assistantHtml;}";new vm.Script(patchSource(s));assert.throws(()=>patchSource("unrelated"));
});

test("exact five selectable units, cycle/rate switches and unchanged legacy math",()=>{
 const a={capacity_unit:"m2",process_multiplier:.8,timing_profile:{timing_mode:"throughput",throughput_per_hour:900}};
 const markup=ppPerformanceCell(a,{quantity_unit:"m2"},String);
 assert.deepEqual([...markup.matchAll(/<option value="([^"]+)"/g)].map(m=>m[1]),["m²/h","kg/h","pcs/h","l/h","min/cycle"]);
 ppApplyEquipmentPerformance(a,row("throughput",75,1125,null,null,"min/cycle","m²/h"));
 assert.equal(a.timing_profile.timing_mode,"fixed");assert.equal(a.timing_profile.duration_min,93.75);assert.equal(ppPerfSpec(a,{}).unit,"min/cycle");
 ppApplyEquipmentPerformance(a,row("fixed",1000,75,null,null,"m²/h","min/cycle"));
 assert.equal(a.timing_profile.timing_mode,"throughput");assert.equal(ppPerfSpec(a,{}).value,1000);assert.equal(a.timing_profile.performance_unit,"m²/h");
 for(const [raw,unit] of [["kg","kg/h"],["pcs","pcs/h"],["l","l/h"],["m2","m²/h"]]){
  assert.equal(ppRateUnit(raw),unit);
  const eq={capacity_unit:raw};ppApplyEquipmentPerformance(eq,row("inherited",100,"",null,null,unit,unit));
  assert.equal(ppPerfSpec(eq,{quantity_unit:raw}).unit,unit);assert.equal(ppPerfSpec(eq,{}).value,100)
 }
});
