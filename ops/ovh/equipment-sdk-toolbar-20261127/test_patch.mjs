import {test} from "node:test";
import assert from "node:assert/strict";
import {css} from "./build.mjs";
import {patchPreview,patchAuth} from "./patch.mjs";
test("SDK CSS preserves the official control sizes and variant tokens",()=>{
 assert.match(css,/--control-size-xl:2\.5rem/);
 assert.match(css,/--button-size: var\(--control-size-xl\)/);
 assert.match(css,/--button-background-color: var\(--color-background-primary-solid\)/);
 assert.match(css,/--color-background-primary-solid:light-dark/);
 assert.match(css,/--button-border-color: var\(--color-border-primary-outline\)/);
 assert.match(css,/--font-text-md-size:1rem/);
});
test("only a qualifying page gets the isolated toolbar patch",()=>{
 const html='<html><head></head><body><!-- PP_EQUIPMENT_SDK_XL_REGULAR_V1 --><section id="sectionView"><button data-pp-add>+ Add</button><button data-pp-save>Save changes</button></section></body></html>';
 const out=patchPreview(html);assert.notEqual(out,html);assert.equal(patchPreview(out),out);assert.ok(out.includes('<button data-pp-add>+ Add</button><button data-pp-save>Save changes</button>'));
 assert.equal(patchPreview('<html><head></head><body></body></html>'),'<html><head></head><body></body></html>');
 const source="const assistantHtml=ppPlanDefaultNavPage(ppPlanningStartPage(branded));";
 assert.ok(patchAuth(source).includes("const assistantHtml=ppEquipmentSdkToolbarPage(ppPlanDefaultNavPage(ppPlanningStartPage(branded)));"));
});
