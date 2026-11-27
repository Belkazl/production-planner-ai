import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {ppEquipmentEditorRows,ppEquipmentKindOptions,patchSource} from "./patch.mjs";
const esc=s=>String(s).replaceAll("&","&amp;").replaceAll('"',"&quot;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const fixture=()=>({equipment:[{id:"P",kind:"pressing",process_multiplier:1.2},{id:"F",kind:"firing",process_multiplier:0.8}],autoclaves:[{id:"P",kind:"other"}],technical_processes:[{operations:[{resource_requirements:[{resource_type:"equipment",resource_ref:"kind:drying",resource_refs:["kind:packing","kind:pressing"]},{resource_type:"employee",resource_ref:"kind:irrelevant"}]}]}]});
test("canonical equipment and real kind references, no static legacy group injection",()=>{
 const m=fixture(),original=structuredClone(m),out=ppEquipmentKindOptions(m,"pressing",esc);
 for(const k of ["pressing","firing","drying","packing"])assert(out.includes('value="'+k+'"'));
 for(const k of ["large","small","other","irrelevant"])assert(!out.includes('value="'+k+'"'));
 assert(out.includes('value="pressing" selected'));
 assert.equal((out.match(/selected/g)||[]).length,1);
 assert.equal(ppEquipmentEditorRows(m),m.equipment);assert.deepEqual(m,original);
});
test("legacy-only data and new equipment preserve valid choices; escape user groups",()=>{
 assert(ppEquipmentKindOptions({autoclaves:[{kind:"large"},{kind:"small"}]},"small",esc).includes('value="small" selected'));
 const out=ppEquipmentKindOptions(fixture(),'<test>"',esc);assert(!out.includes("<test>"));assert(out.includes("&lt;test&gt;&quot;"));
 assert(ppEquipmentKindOptions({},"other",esc).includes('value="other" selected'));
});
test("valid exact wrapper preserving every previous patch",()=>{
 const s="function f(branded){"+"const assistantHtml=ppProjectCardsLanguagePage(ppHideLaunchSettingsPage(ppLaunchAnalyticsPage(ppBottleneckLanguagePage(ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded))))))))))))))));"+"return assistantHtml;}";new vm.Script(patchSource(s));assert.throws(()=>patchSource("unrelated"));
});
