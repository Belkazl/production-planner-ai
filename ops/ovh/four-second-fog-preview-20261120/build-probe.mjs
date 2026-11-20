import {readFileSync,writeFileSync} from "node:fs";
const source=readFileSync("ops/ovh/ga-start-recover-20261119/live-regression.mjs","utf8");
const target=" const epochs=Date.now();";
if(source.split(target).length!==2)throw Error("FOG_PROBE_ANCHOR_DRIFT");
const added=String.raw`
 await page.waitForTimeout(29000);
 const direct=await ctx.request.get(base+"/api/plan-progress?ppPreview=1&ppNoCache=1",{timeout:20000});
 const dp=await direct.json().catch(()=>({}));
 console.log("FOG_PREVIEW_DIRECT_CONTRACT",JSON.stringify({status:direct.status(),keys:Object.keys(dp).sort(),
  previewOps:dp.candidate_preview?.operations?.length||0,
  bestOps:dp.best_preview?.operations?.length||0,
  serial:dp.candidate_serial||0,probe:dp.preview_probe||null}));
 const probe=await page.evaluate(()=>window.__PP_FOUR_SECOND_PREVIEW__?.state||null);
 console.log("FOG_CANDIDATE_SCHEDULER_PROBE",JSON.stringify(probe));
 throw Error("FOG_CANDIDATE_SCHEDULER_PROBE_COMPLETE");
`;
writeFileSync("ops/ovh/four-second-fog-preview-20261120/_probe.mjs",source.replace(target,added+target));
console.log("FOG_PROBE_READY");
