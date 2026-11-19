const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {chromium}=require("playwright-core");
(async()=>{
 const {patchTransitionV5}=await import("./transform.mjs");
 const base=readFileSync("ops/ovh/ga-progress-v4-20261119/runtime.js","utf8");
 const js=patchTransitionV5(base);
 const browser=await chromium.launch({channel:"chrome",headless:true,args:["--no-sandbox"]});
 const page=await browser.newPage();
 const pageErrors=[];
 page.on("pageerror",e=>pageErrors.push(String(e)));
 let phase="running",requests=0,nativeLabel="Optimization 0%",isRunning=true;
 const html=()=>`<!DOCTYPE html><html lang="en"><head></head><body>
 <button id="opt" class="btn ${isRunning?"pp-opt-running":""}" style="width:210px;height:40px;color:white;background:#2869e8">${nativeLabel}<span class="pp-opt-progress-line"></span></button></body></html>`;
 try{
  await page.route("https://app.liftorbit.app/",route=>route.fulfill({
   status:200,contentType:"text/html",body:html()
  }));
  await page.route("**/api/plan-progress*",route=>{
   requests++;
   const result=phase==="completed"?{
    ok:true,phase:"completed",running:false,success:true,percent:100,
    result:{valid:true,operations:[{order:"qa",start:"2026-11-19T08:00:00"}]}
   }:phase==="running"?{ok:true,phase:"running",running:true,success:false,percent:80,result:null}
      :{ok:true,phase,running:false,success:false,percent:80,result:null};
   return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(result)});
  });
  await page.goto("https://app.liftorbit.app/");
  await page.evaluate(()=>{
   document.getElementById("opt").addEventListener("click",()=>{window.__originalClicks=(window.__originalClicks||0)+1});
  });
  await page.addScriptTag({content:js});
  assert.equal((await page.evaluate(()=>window.__PP_GA_PROGRESS_V4__.state)).running,true);
  await page.evaluate(()=>{
   const b=document.getElementById("opt");
   b.firstChild.nodeValue="Optimization 55%";
   window.__PP_GA_PROGRESS_V4__.refresh();
  });
  await page.waitForTimeout(500);
  const smooth=await page.evaluate(()=>window.__PP_GA_PROGRESS_V4__.state);
  assert(smooth.shown>0&&smooth.shown<55,"must show intermediate one-percent increments, no 0-to-55 jump");
  await page.evaluate(()=>{
   const b=document.getElementById("opt");
   b.firstChild.nodeValue="Optimization 80%";
   window.__PP_GA_PROGRESS_V4__.refresh();
  });
  await page.waitForTimeout(350);
  const beforeEnd=await page.evaluate(()=>window.__PP_GA_PROGRESS_V4__.state);
  assert(beforeEnd.confirmed===80&&beforeEnd.shown<80);
  console.log("GA_V5_SMOOTH_CONFIRMED_PERCENT_PASS");

  await page.evaluate(()=>{
   const b=document.getElementById("opt");
   b.classList.remove("pp-opt-running");
   b.textContent="Continue optimization";
   window.__PP_GA_PROGRESS_V4__.refresh();
  });
  const pending=await page.evaluate(()=>({
   state:window.__PP_GA_PROGRESS_V4__.state,
   native:document.getElementById("opt").textContent,
   disabled:document.getElementById("opt").disabled,
   cls:document.getElementById("opt").className,
   css:getComputedStyle(document.getElementById("opt"),"::after").content
  }));
  assert.equal(pending.state.finishing,true,"transition must enter pending immediately");
  assert.equal(pending.state.finalDone,false);
  assert.equal(pending.disabled,true,"native Continue must be disabled until 100");
  assert(pending.cls.includes("pp-ga-v4-busy"),"pending overlay must cover early Continue");
  assert(pending.state.visible?.includes("%")&&!/continue/i.test(pending.state.visible));
  assert(/Optimization/.test(pending.css),"CSS paint must hide native Continue immediately");
  assert.equal(requests,1,"exactly one terminal verification request at transition");
  await page.waitForTimeout(3100);
  const still=await page.evaluate(()=>({
   state:window.__PP_GA_PROGRESS_V4__.state,
   disabled:document.getElementById("opt").disabled
  }));
  assert(still.state.finishing&&!still.state.finalDone&&still.disabled);
  assert(still.state.visible&&!/continue/i.test(still.state.visible));
  console.log("GA_V5_EARLY_CONTINUE_GATED_DURING_SLOW_SERVER_PASS");

  phase="completed";
  await page.waitForFunction(()=>window.__PP_GA_PROGRESS_V4__?.state?.finishing&&
    document.getElementById("opt").classList.contains("pp-ga-v4-final"),null,{timeout:8500});
  const during=await page.evaluate(()=>({
   state:window.__PP_GA_PROGRESS_V4__.state,
   disabled:document.getElementById("opt").disabled
  }));
  if(!during.state.finalDone){
   assert(during.disabled&&during.state.visible.includes("%")&&!/continue/i.test(during.state.visible),
    "animation must hide and block Continue until genuine displayed 100");
  }
  await page.waitForFunction(()=>window.__PP_GA_PROGRESS_V4__?.state?.finalDone,null,{timeout:13000});
  const done=await page.evaluate(()=>({
   state:window.__PP_GA_PROGRESS_V4__.state,
   disabled:document.getElementById("opt").disabled,
   native:document.getElementById("opt").textContent,
   label:document.getElementById("opt").getAttribute("data-pp-ga-v4-label")
  }));
  assert.equal(done.label,"Continue optimization · 100%");
  assert.equal(done.disabled,false);
  assert.equal(done.state.finalCount,1);
  assert.equal(done.state.verifiedCount,1);
  assert.equal(done.state.has100,true);
  await page.waitForTimeout(6400);
  assert.equal(await page.locator("#opt").getAttribute("data-pp-ga-v4-label"),
   "Continue optimization · 100%","100 must remain visible long enough to be seen");
  await page.locator("#opt").click();
  assert.equal(await page.evaluate(()=>window.__originalClicks),1,"original Continue click must work");
  assert.equal(await page.locator("#opt").getAttribute("data-pp-ga-v4-label"),null);
  console.log("GA_V5_REAL_TERMINAL_100_PERSISTENT_AND_CLICKABLE_PASS");

  // The Stop path must not fake completion or freeze the button.
  await page.evaluate(()=>{
   const b=document.getElementById("opt");
   b.classList.add("pp-opt-running");
   b.innerHTML='Optimization 0%<span class="pp-opt-progress-line"></span>';
   window.__PP_GA_PROGRESS_V4__.refresh();
  });
  await page.waitForFunction(()=>window.__PP_GA_PROGRESS_V4__?.state.running,null,{timeout:2000});
  const callsBeforeStop=requests;
  await page.evaluate(()=>{
   const b=document.getElementById("opt");
   b.classList.remove("pp-opt-running");
   b.textContent="Start optimization";
   window.__PP_GA_PROGRESS_V4__.refresh();
  });
  await page.waitForTimeout(250);
  const stopped=await page.evaluate(()=>({
   state:window.__PP_GA_PROGRESS_V4__.state,
   disabled:document.getElementById("opt").disabled,
   label:document.getElementById("opt").getAttribute("data-pp-ga-v4-label")
  }));
  assert(!stopped.state.has100&&!stopped.state.finalDone&&!stopped.state.finishing&&!stopped.label&&!stopped.disabled);
  assert.equal(requests,callsBeforeStop,"Stop must not trigger stale final verification");
  console.log("GA_V5_STOP_WITHOUT_FALSE_100_PASS");

  // A newly opened authenticated completed session must also show 100, not fake running.
  isRunning=false;nativeLabel="Continue optimization";phase="completed";
  await page.reload({waitUntil:"domcontentloaded"});
  await page.addScriptTag({content:js});
  await page.waitForFunction(()=>window.__PP_GA_PROGRESS_V4__?.state?.finalDone,null,{timeout:6500});
  assert.equal(await page.locator("#opt").getAttribute("data-pp-ga-v4-label"),"Continue optimization · 100%");
  assert.equal(await page.locator("#opt").isDisabled(),false);
  assert.deepEqual(pageErrors,[],"browser runtime JS errors");
  console.log("GA_V5_RECONNECT_COMPLETED_100_PASS");
  console.log("GA_V5_CHROME_ALL_PASS");
 }finally{await browser.close();}
})().catch(e=>{console.error("GA_V5_CHROME_FAILED",String(e?.stack||e));process.exitCode=1});
