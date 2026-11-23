import {readFileSync,writeFileSync} from "node:fs";
import assert from "node:assert/strict";
const [oldFile,newFile,unitsFile]=process.argv.slice(2);
assert(oldFile&&newFile&&unitsFile,"UNITS_AUTH_HTML_PATCH_SOURCE_ARGS");
const before=readFileSync(oldFile,"utf8");
const unit=readFileSync(unitsFile,"utf8");
const old="return new Response(enhanced,{";
const updated="return new Response(ppResourceUnitsHtml(enhanced),{";
assert.equal(before.split(old).length,2,"UNITS_AUTH_COMPAT_RESPONSE_ANCHOR_DRIFT");
assert(!before.includes(updated),"auth unit transformer already installed");
assert(before.includes('"x-liftorbit-ui":"etalon-modules-compat"'),"expected auth compatibility page");
assert(before.includes("LIFTORBIT_UI_COMPATIBILITY_FALLBACK"),"must preserve original fallback");
assert(unit.includes("function ppResourceUnitsHtml(input){") &&
       unit.includes("ppNormalizeRequirementUnits(next)") &&
       unit.includes("ppCanonicalRequirementUnit(req,sourceModel)"),
       "original tested canonical unit transform must be present");
const after=before.replace(old,updated);
assert.equal(after.replace(updated,old),before,"only one auth compatibility response changed");
writeFileSync(newFile,after);
console.log("UNITS_AUTH_COMPAT_EXACT_ONE_LINE_PATCH_PASS");
