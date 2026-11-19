import {readFileSync,writeFileSync} from "node:fs";
const file="ops/ovh/account-plan-mismatch-20261118/ceramic-complex-bounded.mjs";
let s=readFileSync(file,"utf8");
const start=' const safeAudit=plan=>{if(!plan)return null;';
if(s.split(start).length!==2)throw Error("GA_V3_INSTRUMENT_START_ANCHOR_CHANGED");
s=s.replace(start,
 ' const g3=await page.evaluate(()=>window.__PP_INLINE_GA_PROGRESS_V3__?.state);\n'+
 ' if(!g3)throw Error("INLINE_GA_V3_MISSING_ON_PUBLIC_APP");\n'+
 ' console.log("GA_INLINE_V3_LIVE_START",JSON.stringify(g3));\n'+start);
const old=' console.log("LIVE_CERAMIC_COMPLEX_GA_FINISHED");';
if(s.split(old).length!==2)throw Error("GA_V3_INSTRUMENT_FINISH_ANCHOR_CHANGED");
s=s.replace(old,
 ' if(process.env.FREEZE_TEST_EXPECT_INLINE_V3==="1"){\n'+
 '  await page.waitForFunction(()=>window.__PP_INLINE_GA_PROGRESS_V3__?.state.finishedCount>=1&&\n'+
 '    window.__PP_INLINE_GA_PROGRESS_V3__.state.last100Shown===true,\n'+
 '    null,{timeout:25000});\n'+
 '  const x=await page.evaluate(()=>({\n'+
 '    v3:window.__PP_INLINE_GA_PROGRESS_V3__?.state,\n'+
 '    oldLabelCount:document.querySelectorAll("#ppGaProgressBusyV2,#ppGaProgressFinalV2,#ppGaTerminal100V1").length,\n'+
 '    nativeText:document.getElementById("opt")?.textContent?.slice(0,80),\n'+
 '    stillRunning:document.getElementById("opt")?.classList.contains("pp-opt-running"),\n'+
 '    nativeDisabled:document.getElementById("opt")?.disabled\n'+
 '  }));\n'+
 '  if(!x.v3?.last100Shown||x.v3.finishedCount<1||x.oldLabelCount!==0||x.stillRunning)\n'+
 '   throw Error("LIVE_GA_V3_100_NOT_IN_BUTTON_"+JSON.stringify(x));\n'+
 '  console.log("LIVE_GA_V3_IN_BUTTON_100_VERIFIED",JSON.stringify(x));\n'+
 ' }\n'+old);
writeFileSync(file,s);
console.log("GA_INLINE_V3_E2E_INSTRUMENTED");
