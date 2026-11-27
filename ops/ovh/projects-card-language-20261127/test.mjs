import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {helper,transformProjectsLanguage,patchSource} from "./patch.mjs";
test("exact scoped localizer transform, idempotence, valid JavaScript",()=>{
 const input='<html><body><!-- PP_HIDE_LAUNCH_SETTINGS_V1 --><script id="ppLanguageUiJs">function transformText(node){const parent=node.parentElement;\n const current=node.nodeValue||"",stored=nodeStore.get(node);\n}</script></body></html>';
 const out=transformProjectsLanguage(input,helper);assert.notEqual(out,input);assert.equal(transformProjectsLanguage(out,helper),out);
 assert.equal(transformProjectsLanguage("<html>Login</html>",helper),"<html>Login</html>");
 new vm.Script(out.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]);
 const old="function f(branded){"+"const assistantHtml=ppHideLaunchSettingsPage(ppLaunchAnalyticsPage(ppBottleneckLanguagePage(ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded)))))))))))))));"+"return assistantHtml;}";new vm.Script(patchSource(old));assert.throws(()=>patchSource("unrelated"));
});
