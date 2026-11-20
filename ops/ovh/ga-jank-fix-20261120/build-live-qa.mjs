import {readFileSync,writeFileSync} from "node:fs";
let s=readFileSync("ops/ovh/ga-start-recover-20261119/live-regression.mjs","utf8");
const once=(a,b,n)=>{
 if(s.split(a).length!==2)throw Error("JANK_QA_SOURCE_DRIFT_"+n);
 s=s.replace(a,b);
};
once(" let lastProgress=null;\n for(let i=0;i<48;i++){",
 " let lastProgress=null;\n const lightTimeline=[];\n for(let i=0;i<48;i++){","timeline");
once("  lastProgress=progressState;\n  if(pageState?.v4?.confirmed<=1",
 "  lastProgress=progressState;\n  const client=await page.evaluate(()=>window.__PP_FOUR_SECOND_PREVIEW__?.state||null);\n  lightTimeline.push({at:Date.now()-epochs,client,shown:pageState?.v4?.shown,\n   confirmed:pageState?.v4?.confirmed,bars:pageState?.bars,\n   mainThreadLag:pageState?.probe?.maxLag||0});\n  if(i%3===0)console.log('JANK_LIGHT_SNAPSHOT_SAMPLE',JSON.stringify(lightTimeline.at(-1)));\n  if(pageState?.v4?.confirmed<=1","samples");
const oldGuard=' if(!shed||shed.maxOps<350||shed.lightweight<2||shed.realCalls<2)\n  throw Error("GA_SHED_DID_NOT_REDUCE_FULL_PLANS_"+JSON.stringify(shed));';
const newGuard=[
' const snapshotDiag=await page.evaluate(()=>window.__PP_FOUR_SECOND_PREVIEW__?.state||null);',
' const stillActive=lightTimeline.filter(x=>x.client?.active);',
' const withBars=stillActive.filter(x=>x.bars>0);',
' const badBars=withBars.filter(x=>x.bars>140);',
' const responseTimings=await page.evaluate(()=>performance.getEntriesByType("resource")',
'  .filter(x=>x.name.includes("/api/ga-candidate-snapshot"))',
'  .map(x=>Math.round(x.duration)).sort((a,b)=>a-b));',
' const p90=responseTimings[Math.min(responseTimings.length-1,Math.floor(responseTimings.length*.9))]||0;',
' console.log("JANK_LIVE_4S_QA",JSON.stringify({snapshotDiag,',
'  samples:lightTimeline.slice(0,18),p90,requests:responseTimings.length,',
'  maxBars:Math.max(0,...withBars.map(x=>x.bars)),',
'  maxLag:Math.max(0,...lightTimeline.map(x=>x.mainThreadLag))}));',
' if(!snapshotDiag||snapshotDiag.version!==2||snapshotDiag.activity<4||',
'  snapshotDiag.light<8||!withBars.length||badBars.length||',
'  snapshotDiag.maxPaintMs>850||',
'  Math.max(0,...lightTimeline.map(x=>x.mainThreadLag))>1600)',
'   throw Error("JANK_LIVE_4S_OR_UI_BLOCKED_"+JSON.stringify(snapshotDiag));',
' console.log("JANK_UI_AND_4S_NONBLOCKING_CANDIDATE_PASS");'
].join("\n");
once(oldGuard,newGuard,"guard");
writeFileSync("ops/ovh/ga-jank-fix-20261120/_live-qa.mjs",s);
console.log("JANK_QA_V2_READY",s.length);
