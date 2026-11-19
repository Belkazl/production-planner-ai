const assert=require("node:assert/strict");
const {chromium}=require("playwright-core");
const {readFileSync}=require("node:fs");
const source=readFileSync("ops/ovh/ga-unified-progress-v2-20261119/runtime.js","utf8");
(async()=>{
 const browser=await chromium.launch({channel:"chrome",headless:true,args:["--no-sandbox"]});
 const page=await browser.newPage();
 let phase="completed",requests=0,backendPct=100;
 try{
  await page.route("https://app.liftorbit.app/",route=>route.fulfill({status:200,
   contentType:"text/html",body:'<!doctype html><html lang="en"><head></head><body><button id="opt" class="btn pp-opt-running">Optimization 0%<span class="pp-opt-progress-line" style="width:0%"></span></button></body></html>'}));
  await page.route("**/api/plan-progress*",route=>{
   requests++;
   const complete=phase==="completed";
   const body=complete?{ok:true,phase:"completed",success:true,running:false,percent:backendPct,
    result:{valid:true,operations:[{order:"qa"}]}}:{ok:true,phase,
     success:false,running:false,percent:backendPct,result:null};
   return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
  });
  await page.goto("https://app.liftorbit.app/");
  await page.evaluate(()=>{
   window.__legacyStops={truth:0,smooth:0,terminal:0};
   window.__PP_TRUTHFUL_SMOOTH_GA_PERCENT_V1__={stop(){window.__legacyStops.truth++}};
   window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__={dispose(){window.__legacyStops.smooth++}};
   window.__PP_GA_TERMINAL_100_V1__={dispose(){window.__legacyStops.terminal++}};
  });
  await page.addScriptTag({content:source});
  const counts=await page.evaluate(()=>window.__legacyStops);
  assert.deepEqual(counts,{truth:1,smooth:1,terminal:1});
  let state=await page.evaluate(()=>window.__PP_UNIFIED_OPTIMIZER_PROGRESS_V2__.state);
  assert.equal(state.displayed,0);
  assert.equal(state.confirmed,0);
  assert.equal(requests,0);

  await page.evaluate(()=>{
   const btn=document.getElementById("opt");
   btn.firstChild.nodeValue="Optimization 65%";
   window.__PP_UNIFIED_OPTIMIZER_PROGRESS_V2__.refresh();
  });
  state=await page.evaluate(()=>window.__PP_UNIFIED_OPTIMIZER_PROGRESS_V2__.state);
  assert.equal(state.confirmed,65);
  assert(state.displayed<65,"must not jump to server target");
  await page.waitForTimeout(1550);
  state=await page.evaluate(()=>window.__PP_UNIFIED_OPTIMIZER_PROGRESS_V2__.state);
  assert(state.displayed>0&&state.displayed<65,"must advance smoothly while backend reports 65%");
  assert.equal(requests,0,"live progress renderer must never poll extra network while active");
  assert.equal(await page.locator("#opt").getAttribute("aria-busy"),"true");

  // The renderer reaches the authenticated 65% then keeps a real working
  // animation and explanation on screen. It NEVER invents 66-99.
  await page.waitForFunction(()=>window.__PP_UNIFIED_OPTIMIZER_PROGRESS_V2__.state.displayed===65,null,{timeout:16000});
  await page.waitForFunction(()=>window.__PP_UNIFIED_OPTIMIZER_PROGRESS_V2__.state.busy,null,{timeout:8500});
  assert.match(await page.locator("#ppGaProgressBusyV2").innerText(),/Still calculating/);
  state=await page.evaluate(()=>window.__PP_UNIFIED_OPTIMIZER_PROGRESS_V2__.state);
  assert.equal(state.displayed,65);
  assert.equal(state.confirmed,65);
  console.log("GA_UNIFIED_PROGRESS_NO_FALSE_ADVANCE_AND_BUSY_ACTIVITY_PASS");

  // Server completes, button is no longer running; only NOW request terminal
  // status and animate the remaining verified percent values.
  await page.evaluate(()=>{
   const btn=document.getElementById("opt");
   btn.classList.remove("pp-opt-running");
   btn.firstChild.nodeValue="Continue optimization";
   window.__PP_UNIFIED_OPTIMIZER_PROGRESS_V2__.refresh();
  });
  await page.waitForFunction(()=>window.__PP_UNIFIED_OPTIMIZER_PROGRESS_V2__.state.final?.includes("Finishing"),null,{timeout:7000});
  const before=await page.locator("#ppGaProgressFinalV2").innerText();
  assert.match(before,/Finishing · \d+%/);
  await page.waitForFunction(()=>window.__PP_UNIFIED_OPTIMIZER_PROGRESS_V2__.state.final==="Completed · 100%",null,{timeout:7000});
  assert.equal(requests,1);
  assert.equal(await page.locator("#opt").innerText(),"Continue optimization");
  console.log("GA_UNIFIED_PROGRESS_SEQUENTIAL_CONFIRMED_TERMINAL_100_PASS");

  // Start again resets everything; cancellation never yields completed 100%.
  phase="cancelled";backendPct=46;
  await page.evaluate(()=>{
   const btn=document.getElementById("opt");
   btn.classList.add("pp-opt-running");
   btn.textContent="Optimization 0%";
   window.__PP_UNIFIED_OPTIMIZER_PROGRESS_V2__.refresh();
  });
  await page.waitForFunction(()=>window.__PP_UNIFIED_OPTIMIZER_PROGRESS_V2__.state.running
    &&!window.__PP_UNIFIED_OPTIMIZER_PROGRESS_V2__.state.final,null,{timeout:5000});
  await page.evaluate(()=>{
   const btn=document.getElementById("opt");
   btn.classList.remove("pp-opt-running");btn.textContent="Start optimization";
   window.__PP_UNIFIED_OPTIMIZER_PROGRESS_V2__.refresh();
  });
  await page.waitForTimeout(900);
  assert.equal(requests,2,"cancel must be checked once");
  assert.equal(await page.locator("#ppGaProgressFinalV2").count(),0);
  console.log("GA_UNIFIED_PROGRESS_NEW_RUN_STOP_NO_FALSE_100_PASS");
  console.log("GA_UNIFIED_PROGRESS_ALL_PASS");
 }finally{await browser.close()}
})().catch(e=>{console.log("GA_UNIFIED_PROGRESS_TEST_FAIL",String(e?.stack||e).slice(0,2300));process.exitCode=1});
