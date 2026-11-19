const assert=require("node:assert/strict");
const {chromium}=require("playwright-core");
const {readFileSync}=require("node:fs");
const addon=readFileSync("ops/ovh/ga-terminal-100-20261119/runtime.js","utf8");
(async()=>{
 const browser=await chromium.launch({channel:"chrome",headless:true,args:["--no-sandbox"]});
 const page=await browser.newPage();
 let phase="completed",count=0;
 try{
  await page.route("https://app.liftorbit.app/",route=>route.fulfill({status:200,contentType:"text/html",
   body:'<!doctype html><html lang="en"><body><button id="opt" class="btn pp-opt-running">Optimization 30%</button></body></html>'}));
  await page.route("**/api/plan-progress*",route=>{
   count++;
   return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(
    phase==="completed"?{ok:true,phase:"completed",success:true,running:false,percent:100,
     result:{ok:true,valid:true,operations:[{order:"qa"}]}}
    :{ok:true,phase,running:false,success:false,percent:30,result:null})});
  });
  await page.goto("https://app.liftorbit.app/");
  await page.addScriptTag({content:addon});
  await page.waitForTimeout(150);
  assert.equal(count,0,"do not request progress while GA is running");
  await page.evaluate(()=>{
   const b=document.getElementById("opt");
   b.classList.remove("pp-opt-running");b.textContent="Continue optimization";
   window.__PP_GA_TERMINAL_100_V1__.refresh();
  });
  await page.waitForFunction(()=>document.getElementById("ppGaTerminal100V1")?.textContent==="Completed · 100%",null,{timeout:15000});
  assert.equal(count,1,"only one authenticated terminal request");
  assert.equal(await page.locator("#opt").innerText(),"Continue optimization","native button must remain clickable and unchanged");
  let state=await page.evaluate(()=>window.__PP_GA_TERMINAL_100_V1__.state);
  assert.equal(state.confirmed,1);
  console.log("GA_TERMINAL_100_AUTHENTICATED_COMPLETION_SHOWN");

  await page.evaluate(()=>{
   const b=document.getElementById("opt");b.classList.add("pp-opt-running");b.textContent="Optimization 0%";
   window.__PP_GA_TERMINAL_100_V1__.refresh();
  });
  await page.waitForFunction(()=>!document.getElementById("ppGaTerminal100V1"),null,{timeout:3000});
  await page.waitForTimeout(100);
  assert.equal(count,1,"no new network request on start");
  phase="cancelled";
  await page.evaluate(()=>{
   const b=document.getElementById("opt");
   b.classList.remove("pp-opt-running");b.textContent="Start optimization";
   window.__PP_GA_TERMINAL_100_V1__.refresh();
  });
  await page.waitForTimeout(350);
  assert.equal(count,2);
  assert.equal(await page.locator("#ppGaTerminal100V1").count(),0,"never show 100 on cancellation");
  console.log("GA_TERMINAL_100_STOP_AND_NEXT_RUN_GUARDS_PASSED");
  console.log("GA_TERMINAL_100_CHROME_ALL_PASS");
 }finally{await browser.close()}
})().catch(e=>{console.error("GA_TERMINAL_100_CHROME_FAIL",String(e.stack||e).slice(0,1400));process.exitCode=1});
