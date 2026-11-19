const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {chromium}=require("playwright-core");
const source=readFileSync("ops/ovh/ga-progress-load-shed-20261119/runtime.js","utf8");
(async()=>{
 const browser=await chromium.launch({channel:"chrome",headless:true,args:["--no-sandbox"]});
 const page=await browser.newPage();
 let remote=0,ops=450,phase="running";
 try{
  await page.route("https://app.liftorbit.app/",route=>route.fulfill({
   status:200,contentType:"text/html",body:'<!doctype html><html><body><button id="opt" class="pp-opt-running">Optimization 10%</button><div id="preview">Old Gantt remains visible</div></body></html>'
  }));
  await page.route("**/api/plan-progress*",async route=>{
   remote++;
   await new Promise(ok=>setTimeout(ok,90));
   const done=phase==="completed";
   return route.fulfill({status:200,contentType:"application/json",
    body:JSON.stringify({ok:true,running:!done,success:done,
     phase,percent:done?100:10,done:done?100:10,total:100,
     best_preview:done?null:{operations:Array.from({length:ops},(_,i)=>({order:"test",id:i}))},
     result:done?{operations:[{order:"test"}],valid:true}:null})});
  });
  await page.goto("https://app.liftorbit.app/");
  await page.addScriptTag({content:source});
  const first=await page.evaluate(async()=>await (await fetch("/api/plan-progress")).json());
  assert.equal(first.best_preview.operations.length,450);
  assert.equal(remote,1);
  const both=await page.evaluate(async()=>{
   const result=[];
   for(let i=0;i<6;i++)result.push(await (await fetch("/api/plan-progress")).json());
   return result;
  });
  assert(both.every(x=>x.phase==="running"&&x.percent===10));
  assert(both.every(x=>x.best_preview===null),"cached updates must not repaint massive identical Gantt");
  assert.equal(remote,1);
  assert.equal(await page.locator("#preview").innerText(),"Old Gantt remains visible");
  const stat=await page.evaluate(()=>window.__PP_GA_PROGRESS_LOAD_SHED_V1__.state);
  assert.equal(stat.maxOps,450);
  assert.equal(stat.lightweight,6);
  console.log("GA_LOAD_SHED_SEVEN_SECOND_FULL_PLAN_THROTTLE_PASS");

  // Reset/reconnect always discards heavy state and forces a real GET.
  await page.evaluate(()=>window.dispatchEvent(new Event("pp:optimizer-reconnect-pending")));
  const refreshed=await page.evaluate(async()=>await (await fetch("/api/plan-progress")).json());
  assert.equal(refreshed.best_preview.operations.length,450);
  assert.equal(remote,2);
  console.log("GA_LOAD_SHED_RECONNECT_NEW_FULL_CHECKPOINT_PASS");

  // Completed/Stop bypasses the synthetic running state.
  phase="completed";
  await page.evaluate(()=>document.getElementById("opt").classList.remove("pp-opt-running"));
  const terminal=await page.evaluate(async()=>await (await fetch("/api/plan-progress")).json());
  assert.equal(terminal.phase,"completed");
  assert.equal(terminal.percent,100);
  assert.equal(terminal.result.operations.length,1);
  assert.equal(remote,3);
  console.log("GA_LOAD_SHED_TERMINAL_NOT_CACHED_PASS");

  // Smaller jobs must retain original per-poll progress and previews.
  await page.evaluate(()=>{
   document.getElementById("opt").classList.add("pp-opt-running");
   window.dispatchEvent(new Event("pp:optimizer-started"));
  });
  phase="running";ops=12;
  await page.evaluate(async()=>{
   await (await fetch("/api/plan-progress")).json();
   await (await fetch("/api/plan-progress")).json();
  });
  assert.equal(remote,5);
  assert.equal((await page.evaluate(()=>window.__PP_GA_PROGRESS_LOAD_SHED_V1__.state)).heavy,false);
  console.log("GA_LOAD_SHED_SMALL_PLAN_UNMODIFIED_PASS");
  console.log("GA_PROGRESS_LOAD_SHED_CHROME_ALL_PASS");
 }finally{await browser.close()}
})().catch(e=>{console.log("GA_PROGRESS_LOAD_SHED_CHROME_FAIL",String(e?.stack||e).slice(0,1800));process.exitCode=1});
