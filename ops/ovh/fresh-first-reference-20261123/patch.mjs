import {readFileSync,writeFileSync} from "node:fs";
const [oldFile,newFile]=process.argv.slice(2);
if(!oldFile||!newFile)throw Error("FRESH_REFERENCE_PATHS_REQUIRED");
let text=readFileSync(oldFile,"utf8");
const old="   const incumbent=floor();";
const next=[
 "   // A completed, account-owned result from the NEW worker is the first",
 "   // comparison reference. The old project.lastPlan must never seed this.",
 "   const freshProject=current();",
 "   const firstNewResult=window.__ppFreshRestartMode===true&&freshProject&&",
 "     String(window.__ppFreshRestartProject)===String(freshProject.id)&&",
 "     !window.__ppFreshReferencePlan;",
 "   if(firstNewResult&&belong(candidate,freshProject)){",
 "      window.__ppFreshReferencePlan=candidate;",
 "      window.__ppFreshReferenceProject=freshProject.id;",
 "      return response; // no old incumbent on the first new iteration",
 "   }",
 "   const incumbent=floor();"
].join("\n");
if(text.split(old).length!==2)throw Error("FRESH_REFERENCE_ANCHOR_DRIFT");
if(!text.includes("const currentFreshPlan=window.__ppFreshReferencePlan;")||
   !text.includes("quick:Object.freeze({generations:3,population:6})")||
   !text.includes("function ppOneSseProgressAndGantt(){"))
 throw Error("FRESH_REFERENCE_PREVIOUS_FIX_MISSING");
text=text.replace(old,next);
if(text.split("window.__ppFreshReferencePlan=candidate;").length!==2||
   text.split(old).length!==2)throw Error("FRESH_REFERENCE_PATCH_INCOMPLETE");
writeFileSync(newFile,text);
console.log("FRESH_REFERENCE_FIRST_COMPLETED_RESULT_CAPTURE_PATCH_PASS");
