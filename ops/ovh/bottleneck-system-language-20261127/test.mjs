import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {labels,transformBottleneckLanguage,patchSource} from "./patch.mjs";
test("only authenticated localizer patched, exact captions and idempotence",()=>{
 const source='<html><head></head><body><!-- PP_INDEPENDENT_PLANNER_SCROLL_V1 --><script id="ppLanguageUiJs">function transformText(node){const ru=node.nodeValue,parent=node.parentElement;const tr=translate(ru);return tr}function transformAttrs(){}</script></body></html>';
 const out=transformBottleneckLanguage(source,labels);
 assert.notEqual(out,source);assert.equal(transformBottleneckLanguage(out,labels),out);
 assert.equal(transformBottleneckLanguage("<html>Guest</html>",labels),"<html>Guest</html>");
 const src=out.match(/<script id="ppLanguageUiJs">([\s\S]*?)<\/script>/)[1];
 const tab={classList:{contains:s=>s==="a"}};
 const ctx={document:{querySelectorAll:()=>[null,null,null,null,null,tab]},translate:s=>s};
 vm.createContext(ctx);vm.runInContext(src,ctx);
 for(const [ru,en] of Object.entries(labels)){
  assert.equal(ctx.transformText({nodeValue:ru,parentElement:{closest:()=>true,nextElementSibling:{}}}),en);
  assert.equal(ctx.transformText({nodeValue:ru,parentElement:{closest:()=>false,nextElementSibling:{}}}),ru);
  assert.equal(ctx.transformText({nodeValue:ru,parentElement:{closest:()=>true,nextElementSibling:null}}),ru);
 }
});
test("preserves auth wrappers",()=>{const s="function f(branded){"+"const assistantHtml=ppIndependentScrollPage(ppUniversalConsumptionPage(ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded))))))))))));"+"return assistantHtml;}";new vm.Script(patchSource(s));assert.throws(()=>patchSource("unrelated"))});
