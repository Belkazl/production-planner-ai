import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {css,script,transformScroll,patchSource} from "./patch.mjs";
test("exact authenticated HTML only and idempotent injection",()=>{
 const source='<html><head></head><body><!-- PP_UNIVERSAL_CONSUMPTION_V1 --></body></html>';
 const result=transformScroll(source,css,script);assert.notEqual(result,source);assert.equal(transformScroll(result,css,script),result);
 assert.equal(transformScroll('<html><head></head><body>Login</body></html>',css,script),'<html><head></head><body>Login</body></html>');
 new vm.Script(script.slice(script.indexOf(">")+1,script.lastIndexOf("</script>")));
});
test("preserves all earlier auth wrappers",()=>{
 const s="function f(branded){"+"const assistantHtml=ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded)))))))))));"+"return assistantHtml;}";
 new vm.Script(patchSource(s));assert.throws(()=>patchSource("unrelated"));
});
