import {chromium} from "playwright-core";
import {randomUUID,randomBytes} from "node:crypto";
const base="https://app.liftorbit.app";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox"]});
const ctx=await browser.newContext({viewport:{width:1700,height:960}});
const page=await ctx.newPage();
const errors=[], requests=[];
page.on("pageerror",e=>errors.push(String(e).slice(0,180)));
page.on("request",r=>{if(new URL(r.url()).pathname==="/api/plan"&&r.method()==="POST")requests.push(Date.now())});
let started=false;
try{
 const first=await page.goto(base,{waitUntil:"domcontentloaded",timeout:50000});
 if(first.status()!==200)throw Error("LIVE_HOME_"+first.status());
 const reg=await page.evaluate(async ({email,password})=>{
  const r=await fetch("/api/auth/register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password,company:"Disposable live GA freeze QA"})});
  return r.status;
 },{email:"live-freeze-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid",password:randomBytes(27).toString("base64url")});
 if(reg!==200)throw Error("LIVE_REGISTER_"+reg);
 const resource=(kind,id)=>({resource_type:kind,resource_ref:id,resource_refs:[id],match_mode:"specific",quantity:1});
 const equipment=Array.from({length:14},(_,i)=>({id:"LQE_"+i,name:"Equipment "+i,kind:"workstation",capacity:600,capacity_unit:"m2"}));
 const people=Array.from({length:5},(_,i)=>({id:"LQP_"+i,name:"Employee "+i,shift:"day"}));
 const model={
  scheduler_mode:"resource",start:"2026-11-17T08:00:00",
  equipment,employees:people,shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},
  orders:Array.from({length:6},(_,i)=>({id:"LQO_"+i,quantity:[1500,2100,2700,1800,2400,2400][i],unit:"m2",
   technical_process_id:"LQPROCESS",parameters:{color:String(i%4)}})),
  technical_processes:[{id:"LQPROCESS",name:"Ceramic-like QA",operations:
   Array.from({length:7},(_,i)=>({id:"LQOP_"+i,name:"Operation "+i,sequence:i+1,duration_min:10,
    resource_requirements:[resource("equipment","LQE_"+i),resource("employee","LQP_"+(i%5))]}))}],
  materials:[],setup_rules:[]
 };
 const project="live-freeze-"+randomUUID().replaceAll("-","");
 const projects=JSON.stringify([{id:project,name:"Isolated optimizer freeze synthetic",model,revision:10}]);
 await page.evaluate(({project,projects})=>{
  localStorage.setItem("prodplan.projects.v2",projects);
  localStorage.setItem("prodplan.project.active.v2",project);
 },{project,projects});
 const db=await page.evaluate(async projects=>{
  const r=await fetch("/api/db-storage",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
   storage:{"prodplan.projects.v2":projects,"prodplan.project.active.v2":JSON.parse(projects)[0].id}})});
  return r.status;
 },projects);
 if(db!==200)throw Error("SAVE_MODEL_"+db);
 await page.addInitScript(()=>{
  window.__freezeProbe={n:0,maxLag:0,slow:0,longtasks:0,longestTask:0,last:performance.now()};
  setInterval(()=>{
   const p=window.__freezeProbe;
   const now=performance.now(),lag=Math.max(0,now-p.last-100);
   p.n++;p.last=now;p.maxLag=Math.max(p.maxLag,lag);
   if(lag>1000)p.slow++;
  },100);
  try{new PerformanceObserver(l=>{for(const x of l.getEntries()){
   window.__freezeProbe.longtasks++;
   window.__freezeProbe.longestTask=Math.max(window.__freezeProbe.longestTask,x.duration);
  }}).observe({entryTypes:["longtask"]})}catch{}
 });
 await page.goto(base,{waitUntil:"domcontentloaded",timeout:50000});
 await page.waitForFunction(()=>window.__PP_OPTIMIZER_DEPTH__?.installed===true&&!!document.getElementById("opt"),null,{timeout:35000});
 await page.waitForFunction(()=>window.__PP_STOP_DEBUG__?.().reconnecting===false,null,{timeout:35000});
 if(process.env.FREEZE_TEST_MODE==="deployed"){
  const single=await page.evaluate(()=>window.__PP_SINGLE_GA_PROGRESS_RENDERER_V1__);
  if(!single?.installed||!single.legacyObserverStopped)throw Error("DEPLOYED_SINGLE_PROGRESS_MISSING");
  console.log("LIVE_FREEZE_DEPLOYED_SINGLE_PROGRESS",JSON.stringify(single));
 }
 if(process.env.FREEZE_TEST_MODE==="single-progress"){
  const isolated=await page.evaluate(()=>{
   const a=window.__PP_TRUTHFUL_SMOOTH_GA_PERCENT_V1__;
   const b=window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__;
   if(!a?.installed||typeof a.stop!=="function"||!b?.installed)throw Error("EXPECTED_TWO_PERCENT_ENGINES");
   a.stop();window.__qaLegacyProgressStopped=true;
   return {legacy:a.installed,smooth:b.installed,stopped:true};
  });
  console.log("LIVE_FREEZE_PROGRESS_ISOLATION",JSON.stringify(isolated));
 }
 if(process.env.FREEZE_TEST_MODE==="skip-gantt"){
  await page.evaluate(()=>{
   const original=window.renderPlan;
   window.__qaSkippedGantt=0;
   window.renderPlan=function(p){
    if(window.__ppOptimizationInFlight===true){window.__qaSkippedGantt++;return;}
    return original.apply(this,arguments);
   };
  });
 }
 const gate=await page.evaluate(()=>({
  optDisabled:document.getElementById("opt")?.disabled,
  optText:document.getElementById("opt")?.textContent,
  modelOrderCount:model?.orders?.length,
  depth:window.__PP_OPTIMIZER_DEPTH__?.get(),mode:window.__qaSkippedGantt===0?"skip-gantt":"normal",
  stop:window.__PP_STOP_DEBUG__?.(),
  current:window.__freezeProbe
 }));
 console.log("LIVE_FREEZE_GATE",JSON.stringify(gate));
 await page.evaluate(()=>{
  if(!window.__PP_OPTIMIZER_DEPTH__.set("quick"))throw Error("QUICK_MODE_BLOCKED");
  if(typeof modelReady!=="undefined")modelReady=true;
  if(typeof busy!=="undefined")busy=false;
  document.getElementById("opt").disabled=false;
 });
 const beforeModel=await page.evaluate(async()=>{const r=await fetch("/api/model",{cache:"no-store",credentials:"same-origin"});return (await r.json()).model});
 const statusBefore=await page.evaluate(async()=>{const r=await fetch("/api/plan-progress",{cache:"no-store"});const p=await r.json();return{phase:p.phase,percent:p.percent,error:p.error}});
 console.log("QA_MODEL_AT_START",JSON.stringify({keys:Object.keys(beforeModel||{}).sort(),orders:beforeModel?.orders?.length,equipment:beforeModel?.equipment?.length,phase:statusBefore.phase}));
 console.log("LIVE_FREEZE_CLICK_BEGIN",JSON.stringify(await page.evaluate(()=>({stop:window.__PP_STOP_DEBUG__?.(),depth:window.__PP_OPTIMIZER_DEPTH__.get(),disabled:document.getElementById("opt").disabled}))));
 await page.locator("#opt").click({timeout:10000,noWaitAfter:true});
 await page.waitForTimeout(200);
 started=requests.length>0;
 console.log("LIVE_FREEZE_AFTER_CLICK",JSON.stringify({requests:requests.length,errors:errors.slice(-2)}));
 const epochs=Date.now();
 let lastProgress=null;
 for(let i=0;i<16;i++){
  await page.waitForTimeout(2000);
  let pageState=null,progressState=null;
  try{
   pageState=await Promise.race([
    page.evaluate(()=>({percent:document.getElementById("opt")?.textContent?.slice(0,65),probe:window.__freezeProbe,
     candidate:window.__PP_AUTO_INTERMEDIATE_PREVIEW_V1__?.switches,legacyStopped:window.__qaLegacyProgressStopped||false,skipped:window.__qaSkippedGantt||0,bars:document.querySelectorAll(".pg2-bar").length})),
    new Promise((_,reject)=>setTimeout(()=>reject(Error("UI_EVAL_TIMEOUT")),4000))
   ]);
  }catch(e){pageState={error:String(e)}}
  try{
   const r=await ctx.request.get(base+"/api/plan-progress",{timeout:8000});
   const p=await r.json();progressState={code:r.status(),phase:p.phase,percent:p.percent,running:p.running,done:p.done,total:p.total,error:p.error,
    candidateOps:p.candidate_preview?.operations?.length,candidateDuration:p.candidate_preview?.duration_minutes,bestDuration:p.best_preview?.duration_minutes,bestOps:p.best_preview?.operations?.length,bestValid:p.best_preview?.valid,bestPartial:p.best_preview?.partial,finalOps:p.result?.operations?.length};
  }catch(e){progressState={error:String(e).slice(0,70)}}
  lastProgress=progressState;
  console.log("LIVE_SIX_ORDER_SAMPLE",i,JSON.stringify({pageState,progressState,elapsed:Date.now()-epochs,requests:requests.length}));
  if(pageState?.error==="Error: UI_EVAL_TIMEOUT")throw Error("RENDERER_UI_BLOCKED");
  if(progressState?.phase==="completed"||progressState?.phase==="failed"||progressState?.phase==="timed_out"||progressState?.phase==="stale"||progressState?.error==="account_plan_mismatch")break;
 }
 const afterModel=await page.evaluate(async()=>{const r=await fetch("/api/model",{cache:"no-store",credentials:"same-origin"});return (await r.json()).model});
 function different(a,b,p="",out=[]){
  if(out.length>=45)return out;
  if(JSON.stringify(a)===JSON.stringify(b))return out;
  if(a===null||b===null||typeof a!=="object"||typeof b!=="object"){
   out.push(p||"<root>");return out;
  }
  const keys=new Set([...Object.keys(a),...Object.keys(b)]);
  for(const k of keys){
   if(out.length>=45)break;
   different(a?.[k],b?.[k],p?(Array.isArray(a)||Array.isArray(b)?p+"["+k+"]":p+"."+k):k,out);
  }
  return out;
 }
 const paths=different(beforeModel,afterModel);
 console.log("QA_MODEL_DIFF_AFTER_RUN",JSON.stringify({same:!paths.length,changes:paths,orders:afterModel?.orders?.length,equipment:afterModel?.equipment?.length,phase:lastProgress?.phase,error:lastProgress?.error}));
 if(lastProgress?.error==="account_plan_mismatch")throw Error("SIX_ORDER_ACCOUNT_PLAN_MISMATCH_REPRODUCED");
 if(lastProgress?.phase!=="completed")throw Error("SIX_ORDER_NO_SUCCESS_"+JSON.stringify(lastProgress));
 if(errors.length)throw Error("BROWSER_ERRORS_"+JSON.stringify(errors.slice(0,4)));
 console.log("LIVE_SIX_ORDER_GA_FINISHED");
} catch(e){
 console.log("LIVE_FREEZE_FAILED",String(e?.stack||e).slice(0,1000));
 process.exitCode=1;
} finally{
 try{if(started){
  const r=await ctx.request.post(base+"/api/optimizer-stop",{timeout:12000,headers:{origin:base,"sec-fetch-site":"same-origin"}});
  console.log("LIVE_FREEZE_CLEANUP_STOP_STATUS",r.status());
 }}catch(e){console.log("LIVE_FREEZE_CLEANUP_UNAVAILABLE",String(e).slice(0,150))}
 await browser.close();
}
