import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-decimal-test/node_modules/playwright-core");
const base="https://app.liftorbit.app";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
let phase="register";
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:45000});
 const email="fractional-browser-qa-"+randomUUID()+"@liftorbit.invalid",password=randomBytes(25).toString("base64url");
 const registration=await page.evaluate(async({email,password})=>(await fetch("/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,company:"Synthetic fractional browser QA"})})).status,{email,password});
 assert.equal(registration,200);
 phase="patch_delivered_ui";
 let patches=0;
 function patch(s){
  const start=";(function ppOneSseProgressAndGantt(){";
  const i=s.indexOf(start);if(i<0)return s;
  assert.equal(s.split(start).length,2);
  const end=s.indexOf("\n})();",i)+6;
  assert(end>i);
  const original=s.slice(i,end);
  for(const name of ["setProgressTarget","receiveProgress","ensureMeter"]){
   const start=original.indexOf("function "+name+"(");
   if(start<0)continue;
   const stop=original.indexOf("\nfunction ",start+10);
   const fn=original.slice(start,stop<0?start+1800:Math.min(stop,start+1800));
   console.log("DECIMAL_BROWSER_DELIVERED_FUNCTION",name,JSON.stringify(fn));
  }
  let ui=original;
  function once(a,b){assert.equal(ui.split(a).length,2,a);ui=ui.replace(a,b)}
  const a=ui.indexOf("function animatePercent(){"),b=ui.indexOf("function hideFog(){",a);
  assert(a>=0&&b>a);
  ui=ui.slice(0,a)+"function setProgressTarget(target){if(!Number.isFinite(target))return;targetPercent=Math.max(targetPercent,Math.max(0,Math.min(verifiedTerminal?100:99.99,target)));if(verifiedTerminal){finishVisible();return}percent=targetPercent;ensureMeter();}\n"+ui.slice(b);
  const receiveStart=ui.indexOf("function receiveProgress(raw){");
  const receiveEnd=ui.indexOf("\nfunction ",receiveStart+10);
  assert(receiveStart>=0&&receiveEnd>receiveStart);
  const receive=ui.slice(receiveStart,receiveEnd);
  assert.equal(receive.split("setProgressTarget(next);").length,2);
  ui=ui.slice(0,receiveStart)+receive.replace(/const next=[^;]+;/,"const next=Math.max(0,Math.min(99.99,p.percent));window.__qaDecimalTrace.push({raw:raw,parsed:p.percent,next:next,phase:p.phase});")+ui.slice(receiveEnd);
  once('const shownText=completed?doneText:percent+"%";','const shownText=percent.toFixed(2)+"%";');
  patches++;
  return s.slice(0,i)+ui+s.slice(end);
 }
 await page.addInitScript(()=>{window.__qaDecimalTrace=[];});
 await page.route("**/*",async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(req.isNavigationRequest()&&path==="/"||req.resourceType()==="script"&&path.includes("restart-optimizer-ui")){
   const resp=await route.fetch();const original=await resp.text();let output;try{output=patch(original)}catch(e){console.log("DECIMAL_BROWSER_PATCH_ERROR",e.name,String(e.message).slice(0,200));await route.abort();return}
   return route.fulfill({response:resp,body:output});
  }
  if(path==="/api/plan-events"){
   return route.fulfill({status:200,contentType:"text/event-stream",body:'event: progress\ndata: {"job_id":"synthetic-browser-only","percent":13.27,"phase":"running"}\n\n'});
  }
  return route.continue();
 });
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>window.__PP_SSE_PROGRESS_V1__?.installed,{},{timeout:20000});
 assert.equal(patches,1);
 console.log("DECIMAL_BROWSER_PARSE",JSON.stringify(await page.evaluate(()=>({parsed:JSON.parse('{"percent":13.27}').percent,eventSourceName:EventSource.name,parseName:JSON.parse.name}))));
 phase="synthetic_sse";
 await page.evaluate(()=>window.__PP_SSE_PROGRESS_V1__.start());
 await page.waitForFunction(()=>window.__qaDecimalTrace.length>0,{},{timeout:15000});
 const result=await page.evaluate(()=>({trace:window.__qaDecimalTrace.slice(0,3),state:window.__PP_SSE_PROGRESS_V1__.state,text:document.querySelector(".pp-sse-label")?.textContent}));
 await page.evaluate(()=>window.__PP_SSE_PROGRESS_V1__.stop());
 console.log("DECIMAL_BROWSER_DELIVERED_TRACE",JSON.stringify(result));
 assert.equal(result.state.percent,13.27);
 assert.equal(result.text,"13.27%");
 console.log("DECIMAL_FULL_BROWSER_SYNTHETIC_PASS");
}catch(e){
 console.log("DECIMAL_BROWSER_DIAGNOSTIC_FAILED",phase,e.name,String(e.message).slice(0,200));process.exitCode=6;
}finally{await browser.close()}
