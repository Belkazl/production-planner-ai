import { chromium } from "playwright-core";
import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1440,height:950}});
 const errors=[];page.on("pageerror",e=>errors.push(String(e).slice(0,280)));
 let response=await page.goto("https://app.liftorbit.app",{waitUntil:"domcontentloaded",timeout:45000});
 assert.equal(response.status(),200);
 const email="ga-end-freeze-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid";
 const password=randomBytes(28).toString("base64url");
 const reg=await page.evaluate(async ({email,password})=>{
  const r=await fetch("/api/auth/register",{method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({email,password,company:"Disposable GA end probe"})});return r.status;
 },{email,password});
 assert.equal(reg,200);
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>Boolean(window.__PP_SSE_PROGRESS_V1__?.installed && document.getElementById("opt")),null,{timeout:25000});
 const before=await page.evaluate(()=>({sse:window.__PP_SSE_PROGRESS_V1__?.state,
  button:document.getElementById("opt").outerHTML.slice(0,320),
  title:document.title}));
 console.log("SSE_FINAL_TEST_INIT",JSON.stringify(before));
 await page.route("**/api/plan-progress?ppNoCache=1",route=>route.fulfill({
  status:200,contentType:"application/json",
  body:JSON.stringify({ok:true,success:true,running:false,phase:"completed",percent:100,
   job_id:"ga-end-freeze-qa-1",result:{valid:true,partial:false,duration_minutes:980,
    operations:[{order:"GAF-1",operation_id:"gaf-1",equipment_ids:["EQ-1"],start_min:0,end_min:60}]}})
 }));
 await page.evaluate(()=>{
  const old=DOMTokenList.prototype.toggle;
  window.__gaFinishToggles=0;window.__gaFinishGuardTriggered=false;
  DOMTokenList.prototype.toggle=function(token,force){
   if(token==="pp-sse-done"){
    window.__gaFinishToggles++;
    if(window.__gaFinishToggles>150){window.__gaFinishGuardTriggered=true;return true;}
   }
   return old.apply(this,arguments);
  };
  const orig=window.setTimeout;
  window.setTimeout=function(fn,ms,...rest){
   if(fn?.name==="animatePercent")return orig(fn,1,...rest);
   return orig(fn,ms,...rest);
  };
  class FakeEventSource {
   constructor(url){this.url=url;this.readyState=1;this.callbacks={};window.__gaFakeStream=this;}
   addEventListener(name,fn){(this.callbacks[name]||=[]).push(fn)}
   emit(name,data){for(const fn of this.callbacks[name]||[])fn({data:JSON.stringify(data)})}
   close(){this.readyState=2}
  }
  window.EventSource=FakeEventSource;
  window.__PP_SSE_PROGRESS_V1__.start();
  window.__gaFakeStream.emit("progress",{job_id:"ga-end-freeze-qa-1",percent:99,phase:"finalizing"});
  window.__gaFakeStream.emit("complete",{job_id:"ga-end-freeze-qa-1"});
 });
 await page.waitForTimeout(2100);
 const result=await page.evaluate(()=>({toggles:window.__gaFinishToggles,
  guard:window.__gaFinishGuardTriggered,
  state:window.__PP_SSE_PROGRESS_V1__.state,
  button:document.getElementById("opt").outerHTML.slice(0,400),
  tasks:performance.getEntriesByType("longtask").length
 }));
 console.log("SSE_FINAL_TEST_RESULT",JSON.stringify(result).slice(0,3500));
 console.log("SSE_FINAL_TEST_PAGE_ERRORS",JSON.stringify(errors.slice(0,8)));
 assert(result.state.completed===true,"must reach actual verified terminal state");
 if(result.guard)console.log("SSE_FINAL_INFINITE_TOGGLE_REPRODUCED");
 else console.log("SSE_FINAL_NO_TOGGLE_INFINITE_LOOP");
}finally{await browser.close()}
