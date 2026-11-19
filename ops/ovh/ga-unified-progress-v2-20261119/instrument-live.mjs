import {readFileSync,writeFileSync} from "node:fs";
const path="ops/ovh/account-plan-mismatch-20261118/ceramic-complex-bounded.mjs";
let source=readFileSync(path,"utf8");
const a='nativeSmoothTarget:window.__PP_TRUTHFUL_SMOOTH_GA_PERCENT_V1__?.confirmedTarget';
if(source.split(a).length!==2)throw Error("UNIFIED_QA_PREVIEW_STATE_ANCHOR_CHANGED");
source=source.replace(a,a+",unified:window.__PP_UNIFIED_OPTIMIZER_PROGRESS_V2__?.state");
const b=' const safeAudit=plan=>{if(!plan)return null;';
if(source.split(b).length!==2)throw Error("UNIFIED_QA_AUDIT_ANCHOR_CHANGED");
source=source.replace(b,
 ' const v2=await page.evaluate(()=>window.__PP_UNIFIED_OPTIMIZER_PROGRESS_V2__?.state);\n'+
 ' if(!v2)throw Error("UNIFIED_PROGRESS_NOT_INSTALLED_IN_REAL_LIVE_UI");\n'+
 ' console.log("UNIFIED_PROGRESS_ACTIVE_AFTER_START",JSON.stringify(v2));\n'+b);
const c=' console.log("LIVE_CERAMIC_COMPLEX_GA_FINISHED");';
if(source.split(c).length!==2)throw Error("UNIFIED_QA_FINISH_ANCHOR_CHANGED");
source=source.replace(c,
 ' if(process.env.FREEZE_TEST_EXPECT_UNIFIED_V2==="1"){\n'+
 '  await page.waitForFunction(()=>{\n'+
 '    const s=window.__PP_UNIFIED_OPTIMIZER_PROGRESS_V2__?.state;\n'+
 '    return s?.successfulFinishes>=1&&s?.final?.includes("100%");\n'+
 '   },null,{timeout:30000});\n'+
 '  const finish=await page.evaluate(()=>({\n'+
 '    text:document.getElementById("ppGaProgressFinalV2")?.textContent,\n'+
 '    nativeText:document.getElementById("opt")?.textContent?.slice(0,85),\n'+
 '    oldTerminal:window.__PP_GA_TERMINAL_100_V1__?.state,\n'+
 '    nativeSmooth:window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__?.state,\n'+
 '    unified:window.__PP_UNIFIED_OPTIMIZER_PROGRESS_V2__?.state\n'+
 '   }));\n'+
 '  if(!finish.text?.includes("100%")||finish.unified.successfulFinishes<1||\n'+
 '     finish.oldTerminal?.shown===true||finish.nativeSmooth?.active===true)\n'+
 '   throw Error("GA_UNIFIED_PROGRESS_WRONG_TERMINAL_"+JSON.stringify(finish));\n'+
 '  console.log("GA_UNIFIED_REAL_900_OPS_100_VERIFIED",JSON.stringify(finish));\n'+
 ' }\n'+c);
writeFileSync(path,source);
console.log("GA_UNIFIED_E2E_INSTRUMENTED");
