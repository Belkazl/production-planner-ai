import {readFileSync,writeFileSync} from "node:fs";
const base="ops/ovh/ga-start-recover-20261119/live-regression.mjs";
const original=readFileSync(base,"utf8");
function replaceOnce(old,next,label){
 if(output.split(old).length!==2)throw Error("FOG_LIVE_QA_ANCHOR_DRIFT_"+label);
 output=output.replace(old,next);
}
let output=original;
replaceOnce(" let lastProgress=null;\n for(let i=0;i<48;i++){",
 " let lastProgress=null;\n const fogTimeline=[];\n for(let i=0;i<48;i++){","fog_samples");
replaceOnce("  lastProgress=progressState;\n  if(pageState?.v4?.confirmed<=1",
 '  lastProgress=progressState;\n  const fogStatus=await page.evaluate(()=>window.__PP_FOUR_SECOND_PREVIEW__?.state||null);\n  fogTimeline.push({at:Date.now()-epochs,active:fogStatus?.active,\n   previews:fogStatus?.previews||0,activity:fogStatus?.activity||0,\n   lastSerial:fogStatus?.lastSerial||0,fogRows:fogStatus?.fogRows||0,\n   light:fogStatus?.light||0,errors:fogStatus?.errors||0,\n   bars:pageState?.bars||0});\n  if(i%3===0)console.log("FOG_PREVIEW_LIVE_SAMPLE",JSON.stringify(fogTimeline.at(-1)));\n  if(pageState?.v4?.confirmed<=1',"fog_timeline");
const guard=' if(!shed||shed.maxOps<350||shed.lightweight<2||shed.realCalls<2)\n  throw Error("GA_SHED_DID_NOT_REDUCE_FULL_PLANS_"+JSON.stringify(shed));';
replaceOnce(guard,
 ' const fogSummary=await page.evaluate(()=>window.__PP_FOUR_SECOND_PREVIEW__?.state||null);\n const fogActive=fogTimeline.filter(x=>x.active&&x.fogRows>0);\n const fogOps=fogTimeline.filter(x=>x.active&&x.bars>0);\n console.log("FOG_PREVIEW_LIVE_SUMMARY",JSON.stringify({fogSummary,fogActive:fogActive.length,\n  fogOps:fogOps.length,maxBars:Math.max(0,...fogOps.map(x=>x.bars)),\n  timeline:fogTimeline.slice(0,16)}));\n if(!fogSummary||fogSummary.previews<2||fogSummary.activity<3||\n  fogSummary.light<2||fogActive.length<1||fogOps.length<1||\n  Math.max(0,...fogOps.map(x=>x.bars))>140)\n  throw Error("GA_FOG_140_4SECOND_REAL_CANDIDATE_NOT_PROVEN_"+JSON.stringify(fogSummary));');
writeFileSync("ops/ovh/four-second-fog-preview-20261120/_live-qa.mjs",output);
console.log("FOG_LIVE_QA_READY",output.length);
