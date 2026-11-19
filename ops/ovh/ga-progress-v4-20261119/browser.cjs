const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {chromium}=require("playwright-core");
const code=readFileSync("ops/ovh/ga-progress-v4-20261119/runtime.js","utf8");
(async()=>{
 const browser=await chromium.launch({channel:"chrome",headless:true,args:["--no-sandbox"]});
 const page=await browser.newPage();
 let phase="completed",httpCalls=0;
 try{
  await page.route("https://app.liftorbit.app/",route=>route.fulfill({
   status:200,contentType:"text/html",body:'<!doctype html><html lang="en"><head></head><body><button id="opt" class="btn pp-opt-running" style="width:205px;height:38px;background:#2463e7;color:white">Optimization 0%<span class="pp-opt-progress-line" style="width:0%"></span></button></body></html>'
  }));
  await page.route("**/api/plan-progress*",route=>{
   httpCalls++;
   const ok=phase==="completed";
   return route.fulfill({status:200,contentType:"application/json",
    body:JSON.stringify(ok?{ok:true,phase:"completed",running:false,success:true,percent:100,
      result:{valid:true,operations:[{order:"qa"}]}}
     :{ok:true,phase,running:false,success:false,percent:55,result:null})});
  });
  await page.goto("https://app.liftorbit.app/");
  await page.evaluate(()=>{
   window.__retired={v3:0,v2:0,legacy:0};
   window.__PP_INLINE_GA_PROGRESS_V3__={dispose(){window.__retired.v3++}};
   window.__PP_UNIFIED_OPTIMIZER_PROGRESS_V2__={dispose(){window.__retired.v2++}};
   window.__PP_GA_TERMINAL_100_V1__={dispose(){}};
   window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__={dispose(){}};
   window.__PP_TRUTHFUL_SMOOTH_GA_PERCENT_V1__={stop(){window.__retired.legacy++}};
   window.__clicks=0;
   document.getElementById("opt").onclick=()=>{window.__clicks++};
  });
  await page.addScriptTag({content:code});
  assert.deepEqual(await page.evaluate(()=>window.__retired),{v3:1,v2:1,legacy:1});
  assert.equal(httpCalls,0);
  assert.equal((await page.evaluate(()=>window.__PP_GA_PROGRESS_V4__.state)).running,true);
  await page.evaluate(()=>{
    const b=document.getElementById("opt");
    b.firstChild.nodeValue="Optimization 55%";
    window.__PP_GA_PROGRESS_V4__.refresh();
  });
  const a=await page.evaluate(()=>window.__PP_GA_PROGRESS_V4__.state);
  assert.equal(a.confirmed,55);
  assert(a.shown<55);
  await page.waitForTimeout(1100);
  const b=await page.evaluate(()=>window.__PP_GA_PROGRESS_V4__.state);
  assert(b.shown>0&&b.shown<55,"no 55% jump");
  assert.equal(httpCalls,0);
  console.log("GA_PROGRESS_V4_SMOOTH_VERIFIED_INCREMENT_PASS");

  await page.waitForFunction(()=>window.__PP_GA_PROGRESS_V4__.state.visible?.includes("%")&&
   document.getElementById("opt")?.classList.contains("pp-ga-v4-busy"),null,{timeout:6500});
  const activity=await page.evaluate(()=>({
   text:document.getElementById("opt")?.getAttribute("data-pp-ga-v4-label"),
   content:getComputedStyle(document.getElementById("opt"),"::after").content,
   state:window.__PP_GA_PROGRESS_V4__.state
  }));
  assert(activity.text.includes("%"));
  assert(activity.content.includes("%"),"CSS pseudo-label must show active percent");
  assert.equal(await page.locator("#ppGaProgressBusyV2,#ppGaProgressFinalV2,#ppGaTerminal100V1").count(),0);
  console.log("GA_PROGRESS_V4_NO_SIDEBAR_STALLED_LABEL_PASS");

  await page.evaluate(()=>{
    const btn=document.getElementById("opt");
    btn.classList.remove("pp-opt-running");
    btn.textContent="Continue optimization";
    window.__PP_GA_PROGRESS_V4__.refresh();
  });
  await page.waitForFunction(()=>window.__PP_GA_PROGRESS_V4__.state.finishing,null,{timeout:7500});
  await page.waitForFunction(()=>window.__PP_GA_PROGRESS_V4__.state.has100,null,{timeout:13000});
  const ending=await page.evaluate(()=>({
    native:document.getElementById("opt").textContent,
    visible:document.getElementById("opt").getAttribute("data-pp-ga-v4-label"),
    disabled:document.getElementById("opt").disabled,
    state:window.__PP_GA_PROGRESS_V4__.state,
    after:getComputedStyle(document.getElementById("opt"),"::after").content
  }));
  assert.equal(ending.native,"Continue optimization");
  assert.equal(ending.visible,"Continue optimization · 100%");
  assert.equal(ending.disabled,false);
  assert.equal(ending.state.finalDone,true);
  assert.equal(ending.state.finalCount,1);
  assert.equal(httpCalls,1);
  console.log("GA_PROGRESS_V4_100_IN_EXISTING_BUTTON_PASS");

  // Regression from V3: 100 disappeared automatically after 850ms. V4 must
  // persist after 100 for as long as the user leaves the completed job.
  await page.waitForTimeout(3600);
  assert.equal(await page.locator("#opt").getAttribute("data-pp-ga-v4-label"),
   "Continue optimization · 100%","persistent, not temporary");
  assert.equal(httpCalls,1,"no needless background status polling");
  assert.equal((await page.evaluate(()=>window.__PP_GA_PROGRESS_V4__.state)).has100,true);
  await page.locator("#opt").click();
  assert.equal(await page.evaluate(()=>window.__clicks),1,"native Continue must still work");
  assert.equal(await page.locator("#opt").getAttribute("data-pp-ga-v4-label"),null);
  console.log("GA_PROGRESS_V4_100_PERSISTS_AND_CONTINUE_CLICKABLE_PASS");

  // A new run that is cancelled may never show 100.
  phase="cancelled";
  await page.evaluate(()=>{
   const b=document.getElementById("opt");
   b.classList.add("pp-opt-running");b.textContent="Optimization 0%";
   window.__PP_GA_PROGRESS_V4__.refresh();
  });
  await page.waitForFunction(()=>window.__PP_GA_PROGRESS_V4__.state.running,null,{timeout:3000});
  await page.evaluate(()=>{
   const b=document.getElementById("opt");
   b.classList.remove("pp-opt-running");b.textContent="Start optimization";
   window.__PP_GA_PROGRESS_V4__.refresh();
  });
  await page.waitForTimeout(500);
  assert.equal(await page.locator("#opt").getAttribute("data-pp-ga-v4-label"),null);
  assert.equal((await page.evaluate(()=>window.__PP_GA_PROGRESS_V4__.state)).has100,false);
  console.log("GA_PROGRESS_V4_STOP_NO_FAKE_TERMINAL_PASS");

  // Reconnect: a durable completed job must still show 100 permanently.
  phase="completed";
  await page.reload({waitUntil:"domcontentloaded"});
  await page.evaluate(()=>{
    const btn=document.getElementById("opt");
    btn.classList.remove("pp-opt-running");
    btn.textContent="Continue optimization";
  });
  await page.addScriptTag({content:code});
  await page.waitForFunction(()=>window.__PP_GA_PROGRESS_V4__?.state.finalDone===true,null,{timeout:4500});
  assert.equal(await page.locator("#opt").getAttribute("data-pp-ga-v4-label"),"Continue optimization · 100%");
  console.log("GA_PROGRESS_V4_RECONNECT_DURABLE_100_PASS");
  console.log("GA_PROGRESS_V4_CHROME_ALL_PASS");
 }finally{await browser.close()}
})().catch(e=>{console.log("GA_PROGRESS_V4_CHROME_FAIL",String(e?.stack||e).slice(0,1800));process.exitCode=1});
