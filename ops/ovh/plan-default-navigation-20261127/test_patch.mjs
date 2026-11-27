import {test} from "node:test";
import assert from "node:assert/strict";
import {patchPreview,patchAuth,installSidebar} from "./patch.mjs";
const anchor="const chat=[...document.querySelectorAll('.side .item')].find(x=>x.textContent.trim()==='Чат');if(chat){document.querySelectorAll('.side .item').forEach(x=>x.classList.remove('active'));chat.classList.add('active')}";
const html='<html><head></head><body><div class="side"><div class="item">Чат</div><div class="item">План</div></div><textarea id="chatInput"></textarea><div id="messages">history</div><script id="ppPlanningStartJs"></script><script id="projectManagerJsV2">function openProject(){'+anchor+'}</script></body></html>';
test("patch changes the native default, keeps chat data and index, and is idempotent",()=>{
 const out=patchPreview(html);
 assert.notEqual(out,html);assert.equal(patchPreview(out),out);assert(!out.includes(anchor));assert(out.includes("planTab.classList.add('active')"));assert(out.includes('<textarea id="chatInput"></textarea><div id="messages">history</div>'));assert(out.includes('<div class="item">Чат</div><div class="item">План</div>'));assert(out.includes("chat.inert=true"));assert(out.includes("display:none!important"));
 assert.throws(()=>patchPreview(html.replace(anchor,"")),/EXACT_ANCHOR/);
});
test("auth chain preserves earlier features",()=>{
 const s="const assistantHtml=ppPlanningStartPage(ppShipByPage(branded));\nreturn assistantHtml;";
 const out=patchAuth(s);assert(out.includes("const assistantHtml=ppPlanDefaultNavPage(ppPlanningStartPage(ppShipByPage(branded)));"));assert.throws(()=>patchAuth(out));assert.throws(()=>patchAuth("const assistantHtml=branded;"));
});
