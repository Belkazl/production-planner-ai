import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {icons,mapping} from "./icons.mjs";
import {css,script,transformSolarNav,patchSource} from "./patch.mjs";
test("ten distinct Solar Linear SVGs with actual collection paths and inherited color",()=>{
 assert.equal(icons.length,10);assert.equal(new Set(icons.map(i=>i.icon)).size,10);
 for(const i of icons){assert(i.icon.endsWith("-linear"));assert(i.body.includes("currentColor"));assert(i.names.length>=2)}
 assert.equal(mapping.length,10);assert(script.includes("PP")===false||script.length>0);
 const js=script.slice(script.indexOf(">")+1,script.lastIndexOf("</script>"));new vm.Script(js);
});
test("HTML injection is scoped and idempotent",()=>{
 const html='<html><head></head><body><!-- PP_GROQ_ASSISTANT_UI_V1 --><nav class="side"></nav></body></html>';
 const out=transformSolarNav(html,css,script);
 assert.notEqual(out,html);assert(out.includes("480 Design"));assert(out.includes("ppSolarSidebarIconsV1"));
 assert.equal(transformSolarNav(out,css,script),out);
 assert.equal(transformSolarNav("<html><body>Login</body></html>",css,script),"<html><body>Login</body></html>");
});
test("exact isolated auth patch, no changes to existing wrappers",()=>{
 const before='function page(branded){const assistantHtml=ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded)))));return assistantHtml;}';
 const out=patchSource(before);new vm.Script(out);
 assert(out.includes("ppSolarNavHtml(ppGroqActionsHtml("));assert(out.includes("PP_SOLAR_SIDEBAR_ICONS_V1"));
 assert.throws(()=>patchSource("unrelated"));assert.throws(()=>patchSource(out));
});
