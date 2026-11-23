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
const newHtml=oldHtml+"\n\n"+unit.trim()+"\n";
const from="new Response(ppStartOverHtml(ppGaPollHtml).replace('</body>'";
const to="new Response(ppResourceUnitsHtml(ppStartOverHtml(ppGaPollHtml)).replace('</body>'";
assert.equal(oldBuild.split(from).length,2,"one single old HTML build transform call");
assert(!oldBuild.includes(to),"new call not already installed");
const newBuild=oldBuild.replace(from,to);
assert.equal(newBuild.replace(to,from),oldBuild,"only one source build change");
assert.equal(newHtml.slice(0,oldHtml.length),oldHtml,"old working HTML transformer unchanged");
for(const mark of ["ppStartOverHtml","ppFreshPlanResult(req,state,out)","ppResetOptimizer(req)","PP_START_OVER_INLINE"]){
 assert(oldBuild.includes(mark)&&newBuild.includes(mark),mark+" must remain");
}
writeFileSync(newHtmlPath,newHtml);
writeFileSync(newBuildPath,newBuild);
console.log("RESOURCE_UNITS_GUARDED_TWO_FILE_PATCH_PASS",JSON.stringify({oldHtmlChars:oldHtml.length,newHtmlChars:newHtml.length,buildChars:newBuild.length}));
