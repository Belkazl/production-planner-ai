import {chromium} from "playwright-core";
import assert from "node:assert/strict";
import {randomUUID,randomBytes} from "node:crypto";
const origin="https://app.liftorbit.app";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1600,height:950}});
const errors=[];
page.on("pageerror",err=>errors.push(String(err).slice(0,180)));
const api=(path,method="GET",data)=>page.evaluate(async({path,method,data})=>{
 const init={method,credentials:"same-origin",cache:"no-store",headers:{accept:"application/json"}};
 if(data!==undefined){init.headers["content-type"]="application/json";init.body=JSON.stringify(data)}
 const r=await fetch(path,init);let result={};try{result=await r.json()}catch{}
 return {status:r.status,body:result};
},{path,method,data});
const sample=()=>page.evaluate(async()=>{
 const btn=document.getElementById("opt"),api=window.__PP_TRUTHFUL_SMOOTH_GA_PERCENT_V1__;
 if(!btn||!api)throw Error("GA_SMOOTH_DOM_NOT_FOUND");
 const delay=n=>new Promise(resolve=>setTimeout(resolve,n));
 const native=(n,prefix="Optimization ")=>{
  btn.classList.add("pp-opt-running");
  btn.textContent=prefix+n+"%";
  const bar=document.createElement("span");
  bar.className="pp-opt-progress-line";bar.style.width=n+"%";
  btn.appendChild(bar);
 };
 native(10);
 for(let i=0;i<40&&api.shown!==10;i++)await delay(15);
 const first={shown:api.shown,target:api.confirmedTarget};
 native(20);
 for(let i=0;i<40&&api.confirmedTarget!==20;i++)await delay(15);
 const initial={shown:api.shown,target:api.confirmedTarget};
 const sequence=[];
 let last=api.shown;
 for(let i=0;i<250&&api.shown<20;i++){
  await delay(12);
  if(api.shown!==last){sequence.push(api.shown);last=api.shown;}
 }
 const full={target:api.confirmedTarget,shown:api.shown,bar:btn.querySelector(".pp-opt-progress-line")?.style.width};
 native(30);
 for(let i=0;i<20&&api.confirmedTarget!==30;i++)await delay(12);
 await delay(100);
 const next={shown:api.shown,target:api.confirmedTarget};
 btn.classList.remove("pp-opt-running");
 btn.textContent="Continue optimization";
 for(let i=0;i<30&&api.shown!==null;i++)await delay(12);
 const stopped={shown:api.shown,target:api.confirmedTarget,label:btn.textContent};
 native(5,"Оптимизация ");
 for(let i=0;i<40&&api.shown!==5;i++)await delay(12);
 const restarted={shown:api.shown,target:api.confirmedTarget,label:btn.textContent};
 btn.classList.remove("pp-opt-running");btn.textContent="Continue optimization";
 return {first,initial,sequence,full,next,stopped,restarted,configuredInterval:api.intervalMs};
});
try{
 const before=await page.goto(origin,{waitUntil:"domcontentloaded",timeout:60000});
 assert.equal(before.status(),200);
 const registered=await api("/api/auth/register","POST",{
  email:"smooth-percent-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid",
  password:randomBytes(22).toString("base64url"),
  company:"Disposable GA percent acceptance"
 });
 assert.equal(registered.status,200);
 await page.goto(origin,{waitUntil:"domcontentloaded",timeout:60000});
 await page.waitForFunction(()=>window.__PP_TRUTHFUL_SMOOTH_GA_PERCENT_V1__?.installed===true&&
  window.__PP_UNIFIED_GANTT_V2__?.installed===true&&
  document.getElementById("opt")!==null,null,{timeout:35000});
 const measured=await sample();
 console.log("GA_SMOOTH_LIVE_CHROME_SAMPLE",JSON.stringify(measured));
 assert.deepEqual(measured.first,{shown:10,target:10});
 assert.deepEqual(measured.initial,{shown:10,target:20});
 assert.deepEqual(measured.sequence,[11,12,13,14,15,16,17,18,19,20],"render each confirmed integer");
 assert.deepEqual(measured.full,{target:20,shown:20,bar:"20%"});
 assert(measured.next.shown<=measured.next.target,"never exceed reported server progress");
 assert.deepEqual(measured.stopped,{shown:null,target:null,label:"Continue optimization"});
 assert.equal(measured.restarted.shown,5);
 assert.equal(measured.restarted.target,5);
 assert.equal(measured.configuredInterval,85);
 await page.reload({waitUntil:"domcontentloaded",timeout:60000});
 await page.waitForFunction(()=>window.__PP_TRUTHFUL_SMOOTH_GA_PERCENT_V1__?.installed===true,null,{timeout:35000});
 const reconnect=await page.evaluate(async()=>{
  const el=document.getElementById("opt");
  el.classList.add("pp-opt-running");
  el.textContent="Optimization 47%";
  await new Promise(r=>setTimeout(r,125));
  const state=window.__PP_TRUTHFUL_SMOOTH_GA_PERCENT_V1__;
  const out={shown:state.shown,target:state.confirmedTarget};
  el.classList.remove("pp-opt-running");el.textContent="Continue optimization";
  return out;
 });
 console.log("GA_SMOOTH_LIVE_CHROME_RECONNECT",JSON.stringify(reconnect));
 assert.equal(reconnect.shown,47);
 assert.equal(reconnect.target,47);
 const status=await api("/api/plan-progress");
 assert.equal(status.status,200);
 assert.equal(status.body.running,false,"no GA job launched in disposable account");
 assert.deepEqual(errors,[],"no JavaScript errors");
 console.log("GA_SMOOTH_PERCENT_10_11_THROUGH_20_STOP_NEW_RUN_RELOAD_REAL_CHROME_PASS");
}catch(e){
 console.log("GA_SMOOTH_CHROME_FAILED",String(e?.stack||e).slice(0,1600));
 console.log("GA_SMOOTH_CHROME_JS_ERRORS",JSON.stringify(errors.slice(-6)));
 process.exitCode=1;
}finally{await browser.close()}
