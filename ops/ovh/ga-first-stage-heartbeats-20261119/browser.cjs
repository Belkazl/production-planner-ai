const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {chromium}=require("playwright-core");
(async()=>{
 const {patchTransitionV5}=await import("../ga-native-transition-v5-20261119/transform.mjs");
 const {patchInitialStageUiV6}=await import("./ui-transform.mjs");
 const v4=readFileSync("ops/ovh/ga-progress-v4-20261119/runtime.js","utf8");
 const js=patchInitialStageUiV6(patchTransitionV5(v4));
 const browser=await chromium.launch({channel:"chrome",headless:true,args:["--no-sandbox"]});
 const page=await browser.newPage({viewport:{width:1400,height:900}});
 const errors=[];
 page.on("pageerror",e=>errors.push(String(e)));
 let serverStage="building_first_plan",serverPercent=1,requests=0;
 try{
  await page.route("https://app.liftorbit.app/",route=>route.fulfill({
   status:200,contentType:"text/html",body:'<!doctype html><html lang="en"><head></head><body><button id="opt" class="btn pp-opt-running" style="width:238px;height:40px;background:#2869e8;color:white">Optimization 1%<span class="pp-opt-progress-line"></span></button></body></html>'
  }));
  await page.route("**/api/plan-progress*",route=>{
   requests++;
   return route.fulfill({status:200,headers:{"x-liftorbit-ga-stage":serverStage,"cache-control":"no-store"},
     contentType:"application/json",body:JSON.stringify({ok:true,phase:"running",running:true,
     percent:serverPercent,done:serverPercent,total:100,best_preview:null,candidate_preview:null,result:null})});
  });
  await page.goto("https://app.liftorbit.app/");
  await page.addScriptTag({content:js});
  await page.evaluate(()=>fetch("/api/plan-progress",{cache:"no-store"}));
  await page.waitForTimeout(1100);
  let stage=await page.evaluate(()=>({
   v:window.__PP_GA_PROGRESS_V4__.state,
   attr:document.getElementById("opt").getAttribute("data-pp-ga-v4-label"),
   css:getComputedStyle(document.getElementById("opt"),"::after").content,
   cls:document.getElementById("opt").className,
   percent:document.getElementById("opt").textContent
  }));
  assert.equal(stage.v.firstStage,"building_first_plan");
  assert(stage.attr?.includes("Building the first plan"),stage.attr);
  assert(stage.css.includes("Building the first plan"));
  assert(stage.cls.includes("pp-ga-v4-busy"));
  assert.equal(stage.v.confirmed,1,"no fake numerical progress during first candidate");
  assert.equal(stage.percent.includes("1%"),true);
  const firstClock=stage.attr.match(/(\d\d):(\d\d)/);
  assert(firstClock,stage.attr);
  await page.waitForTimeout(1250);
  stage=await page.evaluate(()=>({
   state:window.__PP_GA_PROGRESS_V4__.state,
   label:document.getElementById("opt").getAttribute("data-pp-ga-v4-label")
  }));
  const secondClock=stage.label.match(/(\d\d):(\d\d)/);
  assert(secondClock);
  const toSeconds=parts=>Number(parts[1])*60+Number(parts[2]);
  assert(toSeconds(secondClock)>toSeconds(firstClock),"preparation elapsed time must keep advancing");
  assert.equal(stage.state.confirmed,1);
  console.log("GA_FIRST_STAGE_VISIBLE_LIVE_CLOCK_WITH_TRUE_PERCENT_1_PASS");

  serverStage="optimizing";
  await page.evaluate(()=>fetch("/api/plan-progress"));
  assert.equal((await page.evaluate(()=>window.__PP_GA_PROGRESS_V4__.state)).firstStage,"optimizing");
  const searching=await page.locator("#opt").getAttribute("data-pp-ga-v4-label");
  assert(searching?.includes("Optimizing candidate plans"));
  serverPercent=25;
  await page.evaluate(()=>{
   const b=document.getElementById("opt");
   b.firstChild.nodeValue="Optimization 25%";
   window.__PP_GA_PROGRESS_V4__.refresh();
  });
  await page.waitForTimeout(400);
  const real=await page.evaluate(()=>window.__PP_GA_PROGRESS_V4__.state);
  assert.equal(real.confirmed,25);
  assert.equal(real.firstStage,"");
  assert(real.shown<25&&real.shown>1,"verified GA percentage must ramp 1,2,3...");
  assert.equal(await page.locator("#opt").getAttribute("data-pp-ga-v4-label"),null);
  console.log("GA_FIRST_STAGE_SWITCH_TO_VERIFIED_GA_PERCENT_PASS");

  await page.evaluate(()=>{
   const b=document.getElementById("opt");b.classList.remove("pp-opt-running");
   b.textContent="Start optimization";window.__PP_GA_PROGRESS_V4__.refresh();
  });
  const stopped=await page.evaluate(()=>window.__PP_GA_PROGRESS_V4__.state);
  assert.equal(stopped.firstStage,"");
  assert(!stopped.finalDone&&!stopped.has100);
  assert.equal(await page.locator("#opt").getAttribute("data-pp-ga-v4-label"),null);
  assert.deepEqual(errors,[]);
  assert(requests>=2);
  console.log("GA_FIRST_STAGE_STOP_SAFE_NO_FICTION_PASS");
  console.log("GA_FIRST_STAGE_CHROME_ALL_PASS");
 }finally{await browser.close();}
})().catch(e=>{console.error("GA_FIRST_STAGE_CHROME_FAILED",String(e.stack||e));process.exitCode=1});
