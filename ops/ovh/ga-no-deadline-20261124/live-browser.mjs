import {chromium} from "playwright-core";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1500,height:930}});
 const errors=[];page.on("pageerror",err=>errors.push(String(err).slice(0,230)));
 let response=await page.goto("https://app.liftorbit.app",{waitUntil:"domcontentloaded",timeout:45000});
 assert.equal(response.status(),200);
 const email="ga-no-deadline-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid";
 const password=randomBytes(30).toString("base64url");
 const reg=await page.evaluate(async({email,password})=>{
  const r=await fetch("/api/auth/register",{method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({email,password,company:"GA No Deadline Isolated QA"})});return r.status;
 },{email,password});
 assert.equal(reg,200,"disposable QA account register");
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>window.__PP_ASYNC_PLAN_TRANSPORT__===true&&document.getElementById("validator"),null,{timeout:35000});
 const state=await page.evaluate(()=>{
  const html=[...document.scripts].map(x=>x.textContent||"").join("\n");
  return {
   asyncTransport:window.__PP_ASYNC_PLAN_TRANSPORT__===true,
   no15MinuteDeadline:!html.includes("Date.now()+15*60*1000"),
   noClientTimeout:!html.includes('error:"ga_client_wait_timeout"'),
   retryUnbounded:html.includes("for(;;)")&&html.includes("reconnecting_to_worker"),
   requestTimeout:html.includes("AbortSignal.timeout(14000)"),
   validatorRouter:html.includes("ppRouteGaDiagnosticsOutsideValidator"),
   constraintsText:document.getElementById("validator")?.textContent?.trim().slice(0,140),
   htmlChars:html.length
  }
 });
 console.log("GA_NO_DEADLINE_LIVE_SOURCE_FLAGS",JSON.stringify(state));
 assert(state.asyncTransport&&state.no15MinuteDeadline&&state.noClientTimeout&&state.retryUnbounded&&state.requestTimeout&&state.validatorRouter,
  "public authenticated app MUST actually contain the patch");
 const moved=await page.evaluate(async()=>{
   const v=document.getElementById("validator");
   const s=document.getElementById("valid");
   if(!v||!s)return {missing:true};
   v.textContent="ga_worker_unavailable";
   await new Promise(r=>setTimeout(r,100));
   const errorMoved={validator:v.textContent.trim(),status:s.textContent.trim()};
   v.textContent="✓ No constraint violations";
   await new Promise(r=>setTimeout(r,80));
   return {errorMoved,preserved:v.textContent.trim()};
 });
 assert(!moved.missing,"both native Validator and optimization status must exist");
 assert.equal(moved.errorMoved.validator,"—","technical code must never remain in Validator");
 assert(/Optimization status could not be confirmed|Не удалось подтвердить состояние/i.test(moved.errorMoved.status));
 assert(moved.preserved.includes("No constraint violations"),"actual constraint verdict must remain unchanged");
 assert.equal(errors.length,0,"native editor must be free of page JS errors: "+JSON.stringify(errors.slice(0,3)));
 console.log("GA_NO_DEADLINE_LIVE_VALIDATOR_AND_CONSTRAINTS_PASS",JSON.stringify(moved));
 console.log("GA_NO_DEADLINE_LIVE_BROWSER_PASS");
}finally{await browser.close()}
