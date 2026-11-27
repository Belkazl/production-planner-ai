import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {transformSettings,patchSource} from "./patch.mjs";
import {script} from "../launch-analytics-hide-scenarios-20261127/patch.mjs";
test("extend only existing deferred navigation, leaving analytics unchanged",()=>{
 const page="<html><body>"+script+"</body></html>",result=transformSettings(page);
 assert.notEqual(result,page);assert.equal(transformSettings(result),result);
 assert.equal(transformSettings("<html>Login</html>"),"<html>Login</html>");
 assert(result.includes('for(const key of ["scenarios","settings"])'));
 assert(result.includes('settings:["settings","настройки"]'));
 const src=result.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];new vm.Script(src);
 const old=script.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
 // The entire analytics and event-handling implementation after the route guard is byte-identical.
 const anchor='  if(!item("analytics")?.classList.contains("active")){';
 assert.equal(src.slice(src.indexOf(anchor)),old.slice(old.indexOf(anchor)));
});
test("preserve existing authenticated page wrappers",()=>{
 const s="function f(branded){"+"const assistantHtml=ppLaunchAnalyticsPage(ppBottleneckLanguagePage(ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded))))))))))))));"+"return assistantHtml;}";
 new vm.Script(patchSource(s));assert.throws(()=>patchSource("unrelated"));
});
