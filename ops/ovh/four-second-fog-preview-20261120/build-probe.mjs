import {readFileSync,writeFileSync} from "node:fs";
const source=readFileSync("ops/ovh/ga-start-recover-20261119/live-regression.mjs","utf8");
const target=" const epochs=Date.now();";
if(source.split(target).length!==2)throw Error("FOG_PROBE_ANCHOR_DRIFT");
const added=' await page.waitForTimeout(29000);\n const probe=await page.evaluate(()=>window.__PP_FOUR_SECOND_PREVIEW__?.state||null);\n console.log("FOG_CANDIDATE_SCHEDULER_PROBE",JSON.stringify(probe));\n throw Error("FOG_CANDIDATE_SCHEDULER_PROBE_COMPLETE");\n ';
writeFileSync("ops/ovh/four-second-fog-preview-20261120/_probe.mjs",source.replace(target,added+target));
console.log("FOG_PROBE_READY");
