const fs=require("node:fs"),assert=require("node:assert/strict");
const {chromium}=require("playwright-core");
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||"/usr/bin/google-chrome",
   args:["--no-sandbox","--disable-dev-shm-usage"]});
 const page=await browser.newPage();
 await page.setContent(`<!doctype html><html lang="en"><head></head><body>
 <button id="opt" class="pp-opt-running" style="background:#2869e8;color:white;width:280px;height:46px">
 Optimization 1%<span class="pp-opt-progress-line" style="width:1%"></span></button>
 <div id="ppGanttToolV2"><div class="pg2-row"><div class="pg2-lane" style="width:800px">
 <button class="pg2-bar" style="width:30px" type="button">Pressing</button>
 </div></div></div></body></html>`);
 await page.evaluate(()=>{
  window.__PP_UNIFIED_GANTT_V2__={activeMode:0};
  window.__PP_FOUR_SECOND_PREVIEW__={state:{lastRenderedAt:Date.now()}};
  window.__popupCount=0;
  document.querySelector(".pg2-bar").addEventListener("click",()=>window.__popupCount++);
  window.__result={ok:true,running:false,success:true,phase:"completed",percent:100,
    result:{valid:true,operations:[{order:"A",start_min:0,end_min:4}]}};
  window.fetch=async()=>new Response(JSON.stringify(window.__result),{
    status:200,headers:{"content-type":"application/json"}
  });
 });
 await page.addScriptTag({content:fs.readFileSync(
  "ops/ovh/single-progress-v5-20261120/runtime.js","utf8")});
 await page.evaluate(()=>{
  window.dispatchEvent(new Event("pp:optimizer-started"));
  window.dispatchEvent(new CustomEvent("pp:ga-light-progress",{
   detail:{running:true,percent:30,job_id:"synthetic-1",stage:"optimizing",snapshot_age_ms:0}
  }));
 });
 await page.waitForTimeout(1400);
 let started=await page.evaluate(()=>({
  state:window.__PP_GA_PROGRESS_V5__.state,
  line:!!document.querySelector("#opt .pp-ga-v5-fill"),
  old:!!document.getElementById("ppNativeOneOwnerProgressV4Css")
 }));
 assert.ok(started.state.shown>0&&started.state.shown<30, "must increment smoothly without 0-to-30 jump");
 assert.equal(started.line,true,"line exists at intermediate percentage");
 assert.equal(started.old,false,"legacy decorators are absent");
 await page.evaluate(()=>{
  const bar=document.querySelector(".pg2-bar");
  bar.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true}));
 });
 await page.waitForTimeout(400);
 assert.equal(await page.evaluate(()=>window.__popupCount),0,"dialog suppressed in interim preview");
 // The native app reconstructs the button while server calculation continues.
 await page.evaluate(()=>document.getElementById("opt").textContent="Optimization 70%");
 await page.waitForTimeout(300);
 assert.equal(await page.evaluate(()=>window.__PP_GA_PROGRESS_V5__.state.lineVisible),
  true,"line must restore after native DOM reconstruction");
 const afterNative=await page.evaluate(()=>window.__PP_GA_PROGRESS_V5__.state);
 assert.ok(afterNative.shown<=30,"ignore native unconfirmed 70% jump");
 // Simulate a 30-second server reporting delay without inventing percentages.
 await page.evaluate(()=>{
  window.dispatchEvent(new CustomEvent("pp:ga-light-progress",{
   detail:{running:true,percent:30,job_id:"synthetic-1",stage:"optimizing",snapshot_age_ms:30000}
  }));
 });
 await page.waitForTimeout(1700);
 const stale=await page.evaluate(()=>window.__PP_GA_PROGRESS_V5__.state);
 assert.equal(stale.lineVisible,true,"line never disappears when server is stale");
 assert.equal(stale.stale,true,"stale server status must be visible as animation");
 assert.equal(stale.shown,30,"percent must stop at confirmed value");
 // A new confirmed burst gets smoothed, not a jump.
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent("pp:ga-light-progress",{
  detail:{running:true,percent:70,job_id:"synthetic-1",stage:"optimizing",snapshot_age_ms:0}
 })));
 await page.waitForTimeout(450);
 const burst=await page.evaluate(()=>window.__PP_GA_PROGRESS_V5__.state);
 assert.ok(burst.shown>=30&&burst.shown<40,"must not jump from 30 to 70");
 // Test terminal confirmation before 100, and restore operation details.
 await page.evaluate(()=>{
  const b=document.getElementById("opt");
  b.classList.remove("pp-opt-running");b.textContent="Continue optimization";
  window.dispatchEvent(new CustomEvent("pp:ga-light-status",{
   detail:{phase:"completed",running:false,success:true,percent:100,job_id:"synthetic-1"}
  }));
 });
 await page.waitForFunction(()=>window.__PP_GA_PROGRESS_V5__?.state?.finalDone===true,
   null,{timeout:15000,polling:150});
 const done=await page.evaluate(()=>window.__PP_GA_PROGRESS_V5__.state);
 assert.equal(done.shown,100,"verified terminal 100");
 assert.equal(done.lineVisible,true,"completed 100 visually remains");
 await page.evaluate(()=>document.querySelector(".pg2-bar").dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true})));
 await page.waitForTimeout(400);
 assert.equal(await page.evaluate(()=>window.__popupCount),1,"full final operation details restored");
 await page.evaluate(()=>window.dispatchEvent(new Event("pp:optimizer-stopped")));
 const stopped=await page.evaluate(()=>window.__PP_GA_PROGRESS_V5__.state);
 assert.equal(stopped.lineVisible,false,"line removed when user explicitly stops");
 console.log("PP_V5_SYNTHETIC_STALE_30S_NATIVE_REBUILD_SMOOTH_30_70_NO_INTERIM_DIALOG_FULL_FINAL_PASS",
 JSON.stringify({started:started.state.shown,held:stale.shown,burst:burst.shown,done:done.shown,
  dialogsFinal:1}));
 await browser.close();
})().catch(e=>{console.error("V5_BROWSER_TEST_FAILED",String(e),e.stack||"");process.exit(1)});
