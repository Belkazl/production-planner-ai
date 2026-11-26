import assert from "node:assert/strict";
import vm from "node:vm";
import {source as oldSource,serverTransformSource as oldTransform} from "../groq-universal-parameters-20261126/actions-ui.mjs";
import {source,patchAuth,serverTransform} from "./patch.mjs";
const scope={assistantText:(en,ru)=>en};
vm.createContext(scope);vm.runInContext(source,scope);
const ceramic={kind:"add_order",record:"2613",after:600,unit:"m²",process:"Ceramic tile",templateRecord:"2601",parameters:{width_mm:600,length_mm:600,thickness_mm:9,mass_kg_m2:18,product_code:"TILE-2601",product_family:"porcelain_stoneware",finish:"matt",design_family:"White",firing_recipe:"PS-01",coated:true}};
const icecream={kind:"add_order",record:"ICE-2",after:120,unit:"kg",parameters:{flavor:"vanilla",fat_pct:12,freeze_temperature_c:-18,packaging:"cup",portion_g:100}};
for(const c of [ceramic,icecream]){
 const text=scope.ppGroqActionDescription(c),lines=text.split("\n");
 assert(lines.includes(c.after+" "+c.unit));
 for(const [key,val] of Object.entries(c.parameters))assert(lines.includes(key+": "+String(val)),key+" has incorrect unit");
 assert.equal(lines.filter(x=>x.endsWith(" "+c.unit)).length,1);
}
const change=scope.ppGroqActionDescription({kind:"update_order",record:"1",before:300,after:600,unit:"m²"});
assert(change.includes("300 m² → 600 m²"));
const rate=scope.ppGroqActionDescription({kind:"update_equipment_rate",record:"Machine",before:30,after:60,unit:"pcs/h"});
assert(rate.includes("30 pcs/h → 60 pcs/h"));
const parameters=scope.ppGroqActionDescription({kind:"set_order_parameters",record:"1",unit:"m²",differences:[{order:"1",parameter:"color",before:"white",after:"black"},{order:"1",parameter:"width_mm",before:null,after:900}]});
assert(parameters.includes("color: white → black"));assert(parameters.includes("width_mm: — → 900"));assert(!parameters.includes("m²"));
const repaired=scope.ppGroqActionDescription({kind:"complete_order_parameters",record:"1",before:600,after:600,unit:"m²",parameters:{width_mm:600,color:"white"}});
assert(repaired.includes("600 m² → 600 m²"));assert(repaired.includes("width_mm: 600\ncolor: white"));
const before="/* preserved lifecycle and validator */"+oldTransform(),after=patchAuth(before);
assert.equal(after,"/* preserved lifecycle and validator */"+serverTransform());
assert.throws(()=>patchAuth(after));new vm.Script(after);
assert.notEqual(source,oldSource);
console.log("PARAMETER_UNITS_FORMAT_TEST_PASS");
