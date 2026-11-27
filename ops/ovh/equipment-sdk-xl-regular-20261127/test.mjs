import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {css,sourceTokens} from "../equipment-sdk-style-20261127/build.mjs";
import {installEquipmentSDK,transformPage as previousPage,patchSource as previousSource} from "../equipment-sdk-style-20261127/patch.mjs";
import {newCss,newScript,transformPage,patchSource} from "./patch.mjs";
test("official XL input, regular selected values/options, no change to model behavior",()=>{
 assert.equal(sourceTokens["--control-size-xl"],"2.5rem");assert.equal(sourceTokens["--font-weight-normal"],"400");
 assert.equal(newScript.replace('wrap.setAttribute("data-size","xl")','wrap.setAttribute("data-size","md")'),installEquipmentSDK.toString());
 assert(newCss.startsWith(css));assert(newCss.includes("--select-control-font-weight:var(--font-weight-normal)"));assert(newCss.includes(".pp-sdk-MenuList .pp-sdk-Option{font-weight:var(--font-weight-normal)}"));
 const original=previousPage('<html><head><style id="ppPerformanceColumnsStyle">.old{}</style></head><body><!-- PP_EQUIPMENT_CALCULATION_MODES_V1 --><script>const unchanged="model";</script></body></html>');
 const out=transformPage(original);assert.notEqual(out,original);assert.equal(transformPage(out),out);assert(out.includes('const unchanged="model"'));
 assert.equal(out.replace(newCss,css).replace(newScript,installEquipmentSDK.toString()),original);
 new vm.Script("("+newScript+")()");
 const a="function f(){return ["+JSON.stringify(css)+","+JSON.stringify(installEquipmentSDK.toString())+"]}";
 const patched=patchSource(a);new vm.Script(patched);
 assert.equal(patched.replace(JSON.stringify(newCss),JSON.stringify(css)).replace(JSON.stringify(newScript),JSON.stringify(installEquipmentSDK.toString())),a);
 assert.throws(()=>patchSource("unrelated"));assert.throws(()=>patchSource(patched));
});
