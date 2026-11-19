const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {chromium}=require("playwright-core");
const code=readFileSync("ops/ovh/ga-inline-progress-v3-20261119/runtime.js","utf8");
(async()=>{
 const browser=await chromium.launch({channel:"chrome",headless:true,args:["--no-sandbox"]});
 const page=await browser.newPage();
 let responsePhase="completed",calls=0;
 try{
  await page.route("https://app.liftorbit.app/",route=>route.fulfill({
   status:200,contentType:"text/html",
   body:'<!doctype html><html lang="en"><head></head><body><button id="opt" class="btn pp-opt-running">Optimization 0%<span class="pp-opt-progress-line"></span></button><span id="ppGaProgressBusyV2">Still calculating…</span><span id="ppGaProgressFinalV2">Completed · 100%</span><span id="ppGaTerminal100V1">Completed · 100%</span></body></html>'
  }));
  await page.route("**/api/plan-progress*",route=>{
   calls++;
   const good=responsePhase==="completed";
   return route.fulfill({status:200,contentType:"application/json",
    body:JSON.stringify(good?{phase:"completed",running:false,success:true,percent:100,result:{valid:true,operations:[{order:"qa"}]}}
    :{phase:responsePhase,running:false,success:false,percent:32,result:null})});
  });
  await page.goto("https://app.liftorbit.app/");
  await page.evaluate(()=>{
   window.__v2Disposed=0;
   window.__PP_UNIFIED_OPTIMIZER_PROGRESS_V2__={dispose(){window.__v2Disposed++}};
   window.__PP_GA_TERMINAL_100_V1__={dispose(){}};
  });
  await page.addScriptTag({content:code});
  assert.equal(await page.evaluate(()=>window.__v2Disposed),1);
  assert.equal(await page.locator("#ppGaProgressBusyV2,#ppGaProgressFinalV2,#ppGaTerminal100V1").count(),0);
  assert.equal(calls,0,"no status verification during running");
  const initial=await page.evaluate(()=>window.__PP_INLINE_GA_PROGRESS_V3__.state);
  assert.equal(initial.active,true);
  assert.equal(initial.shown,0);

  await page.evaluate(()=>{
   const b=document.getElementById("opt");
   b.firstChild.nodeValue="Optimization 65%";
   window.__PP_INLINE_GA_PROGRESS_V3__.refresh();
  });
  const incoming=await page.evaluate(()=>window.__PP_INLINE_GA_PROGRESS_V3__.state);
  assert.equal(incoming.confirmed,65);
  assert(incoming.shown<65);
  await page.waitForTimeout(1100);
  const mid=await page.evaluate(()=>window.__PP_INLINE_GA_PROGRESS_V3__.state);
  assert(mid.shown>0&&mid.shown<65,"smooth in-button increments");
  assert.equal(calls,0);
  assert.equal(await page.locator("#ppGaProgressBusyV2,#ppGaProgressFinalV2").count(),0);
  assert.equal(await page.locator("#opt").getAttribute("aria-busy"),"true");
  console.log("GA_V3_SMOOTH_RUNNING_AND_NO_ADJACENT_LABELS_PASS");

  // The native app completes and changes the button immediately. Keep the
  // native click handler, but overlay real completed 66..100 INSIDE the button.
  await page.evaluate(()=>{
   const b=document.getElementById("opt");
   b.classList.remove("pp-opt-running");
   b.textContent="Continue optimization";
   window.__PP_INLINE_GA_PROGRESS_V3__.refresh();
  });
  await page.waitForFunction(()=>document.getElementById("opt")?.classList.contains("pp-ga-v3-final"),null,{timeout:6000});
  const firstFinish=await page.locator("#opt").getAttribute("data-pp-ga-v3-text");
  assert.match(firstFinish,/Optimization \d+%/);
  assert.equal(await page.locator("#opt").isDisabled(),true);
  await page.waitForFunction(()=>window.__PP_INLINE_GA_PROGRESS_V3__.state.last100Shown,null,{timeout:7500});
  const endText=await page.locator("#opt").getAttribute("data-pp-ga-v3-text");
  assert.equal(endText,"Optimization 100%");
  assert.equal(await page.locator("#ppGaProgressFinalV2,#ppGaProgressBusyV2,#ppGaTerminal100V1").count(),0);
  await page.waitForFunction(()=>!document.getElementById("opt")?.classList.contains("pp-ga-v3-final"),null,{timeout:5000});
  assert.equal(await page.locator("#opt").innerText(),"Continue optimization");
  assert.equal(await page.locator("#opt").isDisabled(),false);
  assert.equal(calls,1);
  assert.equal((await page.evaluate(()=>window.__PP_INLINE_GA_PROGRESS_V3__.state)).finishedCount,1);
  console.log("GA_V3_COMPLETED_100_VISIBLE_INSIDE_EXISTING_BUTTON_PASS");

  // Explicit stop/cancellation must NEVER draw 100.
  responsePhase="cancelled";
  await page.evaluate(()=>{
   const b=document.getElementById("opt");
   b.classList.add("pp-opt-running");
   b.textContent="Optimization 0%";
   window.__PP_INLINE_GA_PROGRESS_V3__.refresh();
  });
  await page.waitForFunction(()=>window.__PP_INLINE_GA_PROGRESS_V3__.state.active,null,{timeout:4000});
  await page.evaluate(()=>{
   const b=document.getElementById("opt");
   b.classList.remove("pp-opt-running");
   b.textContent="Start optimization";
   window.__PP_INLINE_GA_PROGRESS_V3__.refresh();
  });
  await page.waitForTimeout(900);
  assert.equal(calls,2);
  assert.equal(await page.locator("#opt").getAttribute("data-pp-ga-v3-text"),null);
  assert.equal(await page.locator("#opt").innerText(),"Start optimization");
  console.log("GA_V3_STOP_NO_FALSE_100_PASS");
  console.log("GA_INLINE_PROGRESS_V3_CHROME_ALL_PASS");
 }finally{await browser.close()}
})().catch(error=>{console.log("GA_INLINE_PROGRESS_V3_FAIL",String(error?.stack||error).slice(0,1600));process.exitCode=1});
