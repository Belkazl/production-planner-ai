import {readFileSync,writeFileSync} from "node:fs";
const f="ops/ovh/account-plan-mismatch-20261118/ceramic-complex-bounded.mjs";
const s=readFileSync(f,"utf8");
const anchor=' console.log("LIVE_CERAMIC_COMPLEX_GA_FINISHED");';
if(s.split(anchor).length!==2)throw Error("LIVE_100_QA_ANCHOR_CHANGED");
const extra=`
 if(process.env.FREEZE_TEST_EXPECT_FINAL_100==="1"){
  await page.waitForFunction(()=>window.__PP_GA_TERMINAL_100_V1__?.state.confirmed>0
     &&document.getElementById("ppGaTerminal100V1")?.textContent?.includes("100%"),
    null,{timeout:25000});
  const finished=await page.evaluate(()=>({
   text:document.getElementById("ppGaTerminal100V1")?.textContent,
   button:document.getElementById("opt")?.textContent?.slice(0,80),
   state:window.__PP_GA_TERMINAL_100_V1__?.state
  }));
  if(!finished?.text?.includes("100%")||!finished.state.confirmed)throw Error("COMPLETED_BUT_UI_DID_NOT_SHOW_100");
  console.log("LIVE_GA_TERMINAL_100_VISIBLE",JSON.stringify(finished));
 }
`;
writeFileSync(f,s.replace(anchor,extra+anchor));
console.log("LIVE_GA_TERMINAL_100_EXTRA_REGRESSION_READY");
