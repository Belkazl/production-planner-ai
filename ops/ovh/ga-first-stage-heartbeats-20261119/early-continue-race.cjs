const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {chromium}=require("playwright-core");
(async()=>{
 const {patchTransitionV5}=await import("../ga-native-transition-v5-20261119/transform.mjs");
 const {patchInitialStageUiV6}=await import("./ui-transform.mjs");
 const original=readFileSync("ops/ovh/ga-progress-v4-20261119/runtime.js","utf8");
 const runtime=patchInitialStageUiV6(patchTransitionV5(original));
 const browser=await chromium.launch({channel:"chrome",headless:true,args:["--no-sandbox"]});
 const page=await browser.newPage();
 let completed=false,requests=0;
 try{
  await page.route("https://app.liftorbit.app/",route=>route.fulfill({
   status:200,contentType:"text/html",
   body:'<!doctype html><html lang="en"><body><button id="opt" class="btn pp-opt-running" style="width:240px;height:38px">Optimization 1%<span class="pp-opt-progress-line"></span></button></body></html>'
  }));
  await page.route("**/api/plan-progress*",route=>{
   requests++;
   const p=completed?{ok:true,phase:"completed",running:false,success:true,percent:100,
    result:{valid:true,operations:[{order:"test"}]}}
   :{ok:true,phase:"running",running:true,success:false,percent:1,result:null};
   return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(p)});
  });
  await page.goto("https://app.liftorbit.app/");
  await page.addScriptTag({content:runtime});
  await page.evaluate(()=>{
   const b=document.getElementById("opt");
   // Native app changes the visible label before removing the running class.
   b.textContent="Continue optimization";
   window.__PP_GA_PROGRESS_V4__.refresh();
  });
  const pending=await page.evaluate(()=>({
   cls:document.getElementById("opt").className,
   disabled:document.getElementById("opt").disabled,
   label:document.getElementById("opt").getAttribute("data-pp-ga-v4-label"),
   v4:window.__PP_GA_PROGRESS_V4__.state
  }));
  assert(pending.cls.includes("pp-opt-running"),"reproduction must retain stale running class");
  assert(pending.v4.finishing&&!pending.v4.running&&!pending.v4.finalDone);
  assert(pending.disabled,"early Continue must not be clickable");
  assert(/1%/.test(pending.label)&&!/continue/i.test(pending.label),"early Continue must be hidden");
  console.log("GA_FIRST_STAGE_EARLY_CONTINUE_STALE_CLASS_HIDDEN_PASS");
  await page.waitForTimeout(2100);
  assert(!(await page.evaluate(()=>window.__PP_GA_PROGRESS_V4__.state)).finalDone);
  completed=true;
  await page.waitForFunction(()=>window.__PP_GA_PROGRESS_V4__?.state.finalDone,null,{timeout:16000});
  const done=await page.evaluate(()=>({
   label:document.getElementById("opt").getAttribute("data-pp-ga-v4-label"),
   disabled:document.getElementById("opt").disabled,
   state:window.__PP_GA_PROGRESS_V4__.state
  }));
  assert.equal(done.label,"Continue optimization · 100%");
  assert.equal(done.disabled,false);
  assert(done.state.finalDone&&done.state.has100);
  assert(requests>=2);
  console.log("GA_FIRST_STAGE_STALE_CLASS_VERIFIED_100_PASS");
 }finally{await browser.close()}
})().catch(e=>{console.error("GA_FIRST_STAGE_STALE_CLASS_CHROME_FAIL",String(e?.stack||e));process.exitCode=1});
