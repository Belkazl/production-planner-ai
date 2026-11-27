import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {transformConsumption,patchSource} from "./patch.mjs";
const fixture='<script id="ppTechProcessJs">/* PP_PRODUCTION_HIDE_UNITS_V1 */\nfunction ppNormalizeRequirementUnits(req){let fixes=0;const unit=req.unit;if(unit&&req.unit!==unit){req.unit=unit;fixes++;}return fixes}\nfunction rr(r){return \'<select><option value="per_operation">Per operation</option><option value="per_m2"\'+(r.consumption_rule==="per_m2"?\' selected\':\'\')+\'>Per m²</option><option value="per_unit"\'+(r.consumption_rule==="per_unit"?\' selected\':\'\')+\'>Per unit</option><option value="during_operation">During operation</option></select>\'}<\/script>';
test("legacy selections become per_unit, redundant option is absent, original input unchanged",()=>{
 const out=transformConsumption(fixture);assert.notEqual(out,fixture);assert.equal(transformConsumption(out),out);
 const s=out.match(/<script id="ppTechProcessJs">([\s\S]*?)<\/script>/)[1];const c=vm.createContext({});vm.runInContext(s,c);
 const req={resource_type:"material",consumption_rule:"per_m2",quantity:18.5,unit:"kg"};
 const html=c.rr(req);assert(!html.includes('value="per_m2"'));assert(html.includes('value="per_unit" selected'));assert.equal(req.consumption_rule,"per_m2");
 c.ppNormalizeRequirementUnits(req);assert.equal(req.consumption_rule,"per_unit");assert.equal(req.quantity,18.5);assert.equal(req.unit,"kg");
 for(const rule of ["per_unit","per_operation","during_operation"]){const r={...req,consumption_rule:rule};c.ppNormalizeRequirementUnits(r);assert.equal(r.consumption_rule,rule)}
 assert.equal(transformConsumption("unrelated"),"unrelated");
});
test("authentication wrapper is preserved and valid JS",()=>{const s="function f(branded){"+"const assistantHtml=ppProductionUnitsPage(ppPrimaryNavPage(ppCalendarLanguagePage(ppCalendarUtilizationPage(ppSolarNavHtml(ppGroqActionsHtml(ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded))))))))));"+"return assistantHtml;}";new vm.Script(patchSource(s));assert.throws(()=>patchSource("unrelated"))});
