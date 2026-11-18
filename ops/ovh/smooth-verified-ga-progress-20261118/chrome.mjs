import {chromium} from "playwright-core";
import assert from "node:assert/strict";
import {randomUUID,randomBytes} from "node:crypto";
const base="https://app.liftorbit.app";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1600,height:900}});
const errors=[];
page.on("pageerror",err=>errors.push(String(err).slice(0,220)));
const api=(path,method="GET",data)=>page.evaluate(async({path,method,data})=>{
 const init={method,cache:"no-store",credentials:"same-origin",headers:{accept:"application/json"}};
 if(data!==undefined){init.headers["content-type"]="application/json";init.body=JSON.stringify(data)}
 const r=await fetch(path,init);let body={};try{body=await r.json()}catch{}
 return {status:r.status,body};
},{path,method,data});
try{
 const home=await page.goto(base,{waitUntil:"domcontentloaded",timeout:60000});
 assert.equal(home.status(),200);
 const registered=await api("/api/auth/register","POST",{
  email:"progress-percent-qa-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid",
  password:randomBytes(24).toString("base64url"),
  company:"Disposable GA progress percent test"
 });
 assert.equal(registered.status,200);
 await page.goto(base,{waitUntil:"domcontentloaded",timeout:60000});
 await page.waitForFunction(()=>window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__?.installed===true&&
  !!document.getElementById("opt")&&window.__PP_UNIFIED_GANTT_V2__?.installed===true,
  null,{timeout:40000});
 const initial=await page.evaluate(()=>{
  const b=document.getElementById("opt");
  b.classList.add("pp-opt-running");
  b.textContent="Optimization 10%";
  const bar=document.createElement("span");
  bar.className="pp-opt-progress-line";
  bar.style.width="10%";
  b.appendChild(bar);
  window.__qaProgressHistory=[];
  const log=new MutationObserver(()=>{
   const m=/(\d{1,3})\s*%/.exec(b.textContent||"");
   if(m&&window.__qaProgressHistory.at(-1)!==Number(m[1]))
    window.__qaProgressHistory.push(Number(m[1]));
  });
  log.observe(b,{childList:true,subtree:true,characterData:true});
  window.__qaProgressObserver=log;
  window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__.refresh();
  return {state:window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__.state,
   bar:bar.style.width,text:b.textContent,hasGantt:window.__PP_UNIFIED_GANTT_V2__.installed};
 });
 console.log("GA_PROGRESS_CHROME_INITIAL",JSON.stringify(initial));
 assert.equal(initial.state.displayed,10);
 assert.equal(initial.state.confirmed,10);
 assert.equal(initial.hasGantt,true);
 await page.evaluate(()=>{
  const b=document.getElementById("opt");
  b.textContent="Optimization 20%";
  const span=document.createElement("span");
  span.className="pp-opt-progress-line";
  span.style.width="20%";
  b.appendChild(span);
  window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__.refresh();
 });
 const mid=await page.evaluate(()=>window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__.state);
 assert.equal(mid.confirmed,20);
 assert.equal(mid.displayed,10,"no instant jump to 20");
 await page.waitForTimeout(260);
 const midway=await page.evaluate(()=>window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__.state);
 console.log("GA_PROGRESS_CHROME_MID",JSON.stringify(midway));
 assert(midway.displayed>10&&midway.displayed<20,"must animate within last confirmed interval");
 assert.equal(midway.confirmed,20);
 await page.waitForFunction(()=>window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__.state.displayed===20,
  null,{timeout:3500});
 const after=await page.evaluate(()=>({
  history:window.__qaProgressHistory,
  state:window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__.state,
  text:document.getElementById("opt").textContent,
  bar:document.getElementById("opt").querySelector(".pp-opt-progress-line")?.style.width
 }));
 console.log("GA_PROGRESS_CHROME_CONFIRMED_10_TO_20",JSON.stringify(after));
 for(let n=11;n<=20;n++)assert(after.history.includes(n),"must display verified step "+n);
 assert.equal(after.state.confirmed,20);
 assert.equal(after.bar,"20%");
 await page.evaluate(()=>{
  const b=document.getElementById("opt");
  b.classList.remove("pp-opt-running");
  b.textContent="Continue optimization";
  window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__.refresh();
 });
 const stopped=await page.evaluate(()=>window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__.state);
 assert.equal(stopped.active,false);
 assert.equal(stopped.confirmed,0);
 await page.reload({waitUntil:"domcontentloaded",timeout:60000});
 await page.waitForFunction(()=>window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__?.installed===true,
  null,{timeout:35000});
 const resumed=await page.evaluate(()=>{
  const b=document.getElementById("opt");
  b.classList.add("pp-opt-running");
  b.textContent="Optimization 47%";
  window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__.refresh();
  return window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__.state;
 });
 console.log("GA_PROGRESS_CHROME_RECONNECT",JSON.stringify(resumed));
 assert.equal(resumed.displayed,47,"reload immediately shows real server state");
 assert.equal(resumed.confirmed,47);
 const progress=await api("/api/plan-progress");
 assert.equal(progress.status,200);
 assert.equal(progress.body.running,false,"QA did not run a worker");
 assert.deepEqual(errors,[],"no browser JS exceptions");
 console.log("GA_SMOOTH_VERIFIED_PROGRESS_REAL_CHROME_ACCEPTANCE_PASS");
}catch(err){
 console.log("GA_SMOOTH_VERIFIED_PROGRESS_REAL_CHROME_FAIL",String(err?.stack||err).slice(0,1750));
 console.log("GA_SMOOTH_BROWSER_ERRORS",JSON.stringify(errors.slice(-5)));
 process.exitCode=1;
}finally{await browser.close()}
