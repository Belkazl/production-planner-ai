// Production Chromium acceptance: a disposable account only; all GA error and
// reset responses are mocked in this isolated tab. No optimizer job is created.
import {chromium} from "playwright";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
const BASE="https://app.liftorbit.app";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const context=await browser.newContext({viewport:{width:1650,height:930}});
const page=await context.newPage();
const apiPosts=[],errors=[];
page.on("pageerror",e=>errors.push(String(e).slice(0,150)));
page.on("request",r=>{
 if(new URL(r.url()).pathname==="/api/plan"&&r.method()==="POST")apiPosts.push("unexpected GA start");
});
let mockedState="unavailable",resetCalls=0,progressCalls=0;
try{
 const guest=await page.goto(BASE,{waitUntil:"domcontentloaded",timeout:60000});
 assert.equal(guest.status(),200);
 const email="reconnect-ui-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid";
 const password=randomBytes(36).toString("base64url");
 const account=await page.evaluate(async({email,password})=>{
  const r=await fetch("/api/auth/register",{
   method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},
   body:JSON.stringify({email,password,company:"Disposable GA unlock acceptance"})});
  return r.status;
 },{email,password});
 assert.equal(account,200,"Disposable account creation");
 await page.goto(BASE,{waitUntil:"domcontentloaded",timeout:60000});
 await page.waitForFunction(()=>!!window.__PP_STOP_DEBUG__&&
  !!document.getElementById("ppOptimizerStartOver"),null,{timeout:30000});
 // Reproduce the actual bug: the account progress API is unavailable
 // after reloading a previously saved optimization.
 await page.route(/\/api\/plan-progress(?:\?|$)/,async route=>{
  progressCalls++;
  if(mockedState==="unavailable"){
   await route.fulfill({status:503,contentType:"application/json",
    body:JSON.stringify({ok:false,error:"ga_progress_unavailable"})});
  }else{
   const running=mockedState==="running";
   await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
    ok:true,running,phase:running?"running":"idle",percent:running?37:0,
    best_preview:null,candidate_preview:null
   })});
  }
 });
 await page.route(/\/api\/optimizer-reset(?:\?|$)/,async route=>{
  resetCalls++;
  await route.fulfill({status:409,contentType:"application/json",
   body:JSON.stringify({ok:false,error:"optimization_running_stop_first"})});
 });
 await page.reload({waitUntil:"domcontentloaded",timeout:60000});
 await page.waitForFunction(()=>window.__PP_STOP_DEBUG__?.().reconnecting===false &&
  window.__PP_STOP_DEBUG__?.().remotePhase==="unavailable",null,{timeout:30000});
 const unlocked=await page.evaluate(()=>({
  reconnect:window.__PP_STOP_DEBUG__(),
  restartDisabled:document.getElementById("ppOptimizerStartOver")?.disabled,
  primaryDisabled:document.getElementById("opt")?.disabled,
  primary:document.getElementById("opt")?.textContent,
  status:document.getElementById("valid")?.textContent
 }));
 console.log("GA_UNLOCK_LIVE_STATUS_UNAVAILABLE",JSON.stringify(unlocked));
 assert.equal(unlocked.reconnect.remoteFailureCount,3);
 assert.equal(unlocked.restartDisabled,false,"Start optimization again must unlock after status failure");
 assert.equal(unlocked.reconnect.running,false);
 assert.equal(apiPosts.length,0);
 await page.screenshot({path:"ga-start-again-unlocked-20261117.png",fullPage:false});
 // Now a user clicks "Start again" but the server says the existing GA is
 // still active. No reset/POST happens; only the owner job is reattached.
 mockedState="running";
 await page.locator("#ppOptimizerStartOver").click({timeout:10000});
 await page.waitForFunction(()=>window.__PP_STOP_DEBUG__?.().running===true &&
  window.__PP_STOP_DEBUG__?.().reconnecting===false,null,{timeout:10000});
 const attached=await page.evaluate(()=>({
  debug:window.__PP_STOP_DEBUG__(),
  restartDisabled:document.getElementById("ppOptimizerStartOver")?.disabled,
  primaryDisabled:document.getElementById("opt")?.disabled,
  stopVisible:document.getElementById("ppStopOptimizer")?.classList.contains("pp-on"),
  stopDisabled:document.getElementById("ppStopOptimizer")?.disabled,
  badge:document.getElementById("valid")?.textContent
 }));
 console.log("GA_UNLOCK_LIVE_RESET_409_REATTACHED",JSON.stringify(attached));
 assert.equal(resetCalls,1);
 assert.equal(attached.restartDisabled,true);
 assert.equal(attached.primaryDisabled,true);
 assert.equal(attached.stopVisible,true);
 assert.equal(attached.stopDisabled,false);
 assert.equal(apiPosts.length,0,"No duplicate GA can be launched");
 // A clean idle response after the next page refresh should unlock Start again
 // without waiting for a failed-progress fallback.
 mockedState="idle";
 await page.reload({waitUntil:"domcontentloaded",timeout:60000});
 await page.waitForFunction(()=>window.__PP_STOP_DEBUG__?.().reconnecting===false,null,{timeout:15000});
 const final=await page.evaluate(()=>({
  debug:window.__PP_STOP_DEBUG__(),
  restartDisabled:document.getElementById("ppOptimizerStartOver")?.disabled
 }));
 assert.equal(final.debug.running,false);
 assert.equal(final.restartDisabled,false);
 assert.equal(apiPosts.length,0);
 assert.deepEqual(errors,[],"No uncaught JS errors during start/reattach/reload");
 console.log("GA_UNLOCK_PRODUCTION_CHROMIUM_PASS",JSON.stringify({
  afterUnavailableUnblocked:true,server409Respected:true,reattachedStop:true,
  idleRestartAvailable:true,secondGAStarted:false,progressChecks:progressCalls
 }));
}catch(err){
 console.log("GA_UNLOCK_LIVE_FAILURE",String(err?.stack||err).slice(0,1500));
 console.log("GA_UNLOCK_LIVE_DIAGNOSTICS",JSON.stringify({mockedState,resetCalls,progressCalls,errors:errors.slice(-4)}));
 process.exitCode=1;
}finally{await browser.close()}
