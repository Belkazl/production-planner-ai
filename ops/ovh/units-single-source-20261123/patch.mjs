import {readFileSync,writeFileSync} from "node:fs";
import assert from "node:assert/strict";
const [oldHtmlPath,oldBuildPath,newHtmlPath,newBuildPath]=process.argv.slice(2);
assert(oldHtmlPath&&oldBuildPath&&newHtmlPath&&newBuildPath,"resource unit patch input paths");
const oldHtml=readFileSync(oldHtmlPath,"utf8");
const oldBuild=readFileSync(oldBuildPath,"utf8");
const unit=readFileSync("ops/ovh/units-single-source-20261123/resource-units-html.js","utf8");
assert(oldHtml.includes("function ppStartOverHtml(input){"),"required previous native HTML transformer");
assert(oldHtml.includes("window.__ppFreshReferencePlan=d"),"preserve old plan reset fix");
assert(!oldHtml.includes("ppResourceUnitsHtml"),"unit transformer must not be already installed");
assert(unit.startsWith("function ppResourceUnitsHtml(input){"),"units function source");
assert(unit.includes("ppNormalizeRequirementUnits(next)"),"whole-model reconciliation");
const finalReturn="\n return html;\n}";
assert.equal(oldHtml.split(finalReturn).length,2,"unique native HTML final return");
const newHtml=oldHtml.replace(finalReturn,"\n return ppResourceUnitsHtml(html);\n}")+"\n\n"+unit.trim()+"\n";
// Keep the downstream build pipeline exact: GA execution budget anchors the
// original ppStartOverHtml(...) call. Apply units inside that existing function.
const newBuild=oldBuild;
assert.equal(newHtml.replace("return ppResourceUnitsHtml(html);","return html;").slice(0,oldHtml.length),oldHtml,"only final return changed before adding helper");
writeFileSync(newHtmlPath,newHtml);
writeFileSync(newBuildPath,newBuild);
console.log("RESOURCE_UNITS_GUARDED_TWO_FILE_PATCH_PASS",JSON.stringify({oldHtmlChars:oldHtml.length,newHtmlChars:newHtml.length,buildChars:newBuild.length}));
