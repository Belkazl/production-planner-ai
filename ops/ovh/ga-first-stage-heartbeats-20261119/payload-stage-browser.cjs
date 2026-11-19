const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {chromium}=require("playwright-core");
(async()=>{
 const file=process.argv[2];if(!file)throw Error("STAGED_UI_REQUIRED");
 const src=readFileSync(file,"utf8");
 const start=src.indexOf("(function ppNativeOneOwnerProgressV4(){");
 if(start<0)throw Error("SINGLE_PROGRESS_OWNER_NOT_FOUND");
 const runtime=src.slice(start);
 if(!runtime.includes("pp:ga-server-stage"))throw Error("STAGE_EVENT_RELAY_NOT_INSTALLED");
 const browser=await chromium.launch({channel:"chrome",headless:true,args:["--no-sandbox"]});
 const page=await browser.newPage();
 const errors=[];
 page.on("pageerror",e=>errors.push(String(e)));
 try{
  await page.route("https://app.liftorbit.app/",r=>r.fulfill({status:200,contentType:"text/html",
   body:'<!doctype html><html lang="en"><body><button id="opt" class="pp-opt-running">Optimization 1%<span class="pp-opt-progress-line"></span></button></body></html>'}));
  await page.route("**/api/plan-progress*",r=>r.fulfill({
   status:200,contentType:"application/json",headers:{"cache-control":"no-store"},
   body:JSON.stringify({ok:true,phase:"running",running:true,percent:1,stage:"validating_model",
    done:1,total:100,best_preview:null,candidate_preview:null,result:null})
  }));
  await page.goto("https://app.liftorbit.app/");
  await page.addScriptTag({content:runtime});
  await page.evaluate(async()=>{const r=await fetch("/api/plan-progress",{cache:"no-store"});if(!r.ok)throw Error("FETCH_FAIL")});
  await page.waitForFunction(()=>window.__PP_GA_PROGRESS_V4__?.state.serverStageEvents>=1,null,{timeout:2500});
  const state=await page.evaluate(()=>window.__PP_GA_PROGRESS_V4__.state);
  assert.equal(state.firstStage,"validating_model");
  assert(state.visible.includes("Validating model"));
  assert.equal(state.confirmed,1);
  assert.deepEqual(errors,[]);
  console.log("GA_FIRST_STAGE_BACKEND_JSON_EVENT_NO_HEADER_PASS",JSON.stringify(state));
 }finally{await browser.close()}
})().catch(e=>{console.error("GA_FIRST_STAGE_PAYLOAD_RELAY_FAIL",e?.stack||e);process.exitCode=1});
