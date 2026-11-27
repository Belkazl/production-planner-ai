import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {analyticsData,analyticsHtml,transformAnalytics,css,script,patchSource} from "./patch.mjs";
import {ppCalendarResourceMetrics as calc,ppCalendarUtilizationHtml as util} from "../resource-utilization-calendars-20261126/metrics.mjs";
const fixture=()=>({id:"P",revision:2,model:{start:"2026-11-25T00:00:00",equipment:[{id:"E",name:"Equipment 1",kind:"press"}],employees:[{id:"W",name:"Worker",shift:"day"}],shifts:{day:[["08:00","16:00"]]},materials:[{id:"M",name:"Powder",unit:"kg"}],orders:[{id:"A",technical_process_id:"P"}],technical_processes:[{id:"P",operations:[{id:"O",resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"E",quantity:1},{resource_type:"employee",match_mode:"specific",resource_ref:"W",quantity:1}]}]}]},lastPlan:{valid:true,_revision:2,duration_minutes:1440,batch_count:1,operator_wait_minutes:60,machine_idle_minutes:200,generic_operations:[{operation_id:"O",start_min:480,end_min:840,equipment_ids:["E"],employee_ids:["W"],materials:[{id:"M",quantity:180}]}]}});
test("real calendar math, recorded materials, separate resource groups, no input mutation",()=>{
 const p=fixture(),snapshot=structuredClone(p),d=analyticsData(p,calc);
 assert.equal(d.equipmentLoad,75);assert.equal(d.staffLoad,75);assert.equal(d.ranked.length,2);assert.equal(d.materials[0].quantity,180);assert.equal(d.equipmentFree,120);
 const out=analyticsHtml(p,d,"en",util);assert(out.includes('data-util-group="equipment"'));assert(out.includes('data-util-group="employees"'));assert(out.includes("180 kg"));assert(!out.includes("Autoclaves"));assert.deepEqual(p,snapshot);
 assert(analyticsHtml(p,d,"ru",util).includes("Аналитика"));
 p.lastPlan.generic_operations[0].materials=[];assert.equal(analyticsData(p,calc).materials,null);
});
test("no current/partial/invalid or mismatched-revision plan is not treated as current",()=>{
 for(const mutation of [p=>p.lastPlan=null,p=>p.lastPlan.partial=true,p=>p.lastPlan.valid=false,p=>p.lastPlan._revision=1]){const p=fixture();mutation(p);assert.equal(analyticsData(p,calc),null)}
 assert(analyticsHtml(null,null,"en",util).includes("No current calculated plan"));
});
test("exact page injection, preserving existing auth wrapper",()=>{
 const input='<html><head></head><body><!-- PP_BOTTLENECK_SYSTEM_LANGUAGE_V1 PP_CALENDAR_UTILIZATION_V1 --><script>function f(parent){if(parent.closest("script,style,noscript,textarea,svg,code,pre,[contenteditable],.pp-i18n-route-label"))return;}</script></body></html>';
 const out=transformAnalytics(input,css,script);assert.notEqual(out,input);assert.equal(transformAnalytics(out,css,script),out);new vm.Script(script.slice(script.indexOf(">")+1,script.lastIndexOf("</script>")));
 const old="function f(branded){"+"const assistantHtml=ppBottleneckLanguagePage(ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded)))))))))))));"+"return assistantHtml;}";new vm.Script(patchSource(old));assert.throws(()=>patchSource("unrelated"));
});
