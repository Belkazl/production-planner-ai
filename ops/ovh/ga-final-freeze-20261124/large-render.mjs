import {chromium} from "playwright-core";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
const page=await browser.newPage({viewport:{width:1700,height:1000}});
const errors=[];
page.on("pageerror",e=>errors.push(String(e).slice(0,450)));
try{
 let r=await page.goto("https://app.liftorbit.app",{waitUntil:"domcontentloaded",timeout:45000});
 assert.equal(r.status(),200);
 const email="ga-large-render-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid";
 const password=randomBytes(27).toString("base64url");
 let status=await page.evaluate(async ({email,password})=>{
  const r=await fetch("/api/auth/register",{method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({email,password,company:"Isolated final render QA"})});return r.status;
 },{email,password});
 assert.equal(status,200);
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>typeof renderPlan==="function"&&document.getElementById("planView")&&window.__PP_UNIFIED_GANTT_V2__?.installed,null,{timeout:30000});
 await page.evaluate(()=>{
  window.__gaRenderLag={last:performance.now(),maxGap:0,ticks:0,longtasks:0,maxTask:0};
  setInterval(()=>{const o=window.__gaRenderLag,now=performance.now();o.maxGap=Math.max(o.maxGap,now-o.last-100);o.last=now;o.ticks++},100);
  try{new PerformanceObserver(list=>{for(const x of list.getEntries()){window.__gaRenderLag.longtasks++;window.__gaRenderLag.maxTask=Math.max(window.__gaRenderLag.maxTask,x.duration)}}).observe({entryTypes:["longtask"]})}catch{}
 });
 const make=await page.evaluate(()=>{
  document.getElementById("sectionView").style.display="none";
  document.getElementById("planView").style.display="block";
  const eq=Array.from({length:14},(_,i)=>({id:"Q_EQ_"+i,name:"Equipment "+i,kind:["pressing","drying","glazing","decoration","firing","sorting","packaging"][i%7],capacity:100,capacity_unit:"m²"}));
  const people=Array.from({length:7},(_,i)=>({id:"Q_STAFF_"+i,name:"Operator "+i,role:"operator",shift:"day"}));
  const orders=Array.from({length:12},(_,i)=>({id:"260"+i,quantity:60,unit:"m²",area:60,technical_process_id:"T1"}));
  model={start:"2026-11-24T08:00:00",equipment:eq,autoclaves:eq,employees:people,orders,quantity_unit:"m²",
    technical_processes:[{id:"T1",name:"Full plan render",operations:[]}],materials:[],shifts:{day:[["08:00","12:00"],["13:00","17:00"]]}};
  window.__gaPlanFactory=n=>{const operations=Array.from({length:n},(_,i)=>({
   id:"P_"+i,operation_id:"P_"+i,order:String(2600+i%12),
   start_min:Math.floor(i/14)*38+(i%14)*4,end_min:Math.floor(i/14)*38+(i%14)*4+22,
   is_setup:i%9===0,phase:i%9===0?"setup":"process",
   equipment_ids:["Q_EQ_"+i%14],employee_ids:["Q_STAFF_"+i%7],operation_name:"Process "+i
  }));
  return {ok:true,valid:true,partial:false,duration_minutes:Math.round(n/14)*38+60,batch_count:118,
   operator_wait_minutes:21000,machine_idle_minutes:17000,start:model.start,operations,generic_operations:operations,batches:[]};
  };
  return {eq:eq.length,lang:document.documentElement.lang,mode:window.__PP_UNIFIED_GANTT_V2__?.activeMode};
 });
 console.log("FULL_RENDER_INIT",JSON.stringify(make));
 async function runSize(n){
  const t=Date.now();
  const result=await Promise.race([
   page.evaluate(size=>{
    const p=window.__gaPlanFactory(size);
    window.__ppTabPlan=p;window.__ppGenericPlan=p;
    const t=performance.now();renderPlan(p);
    return {size,renderMs:Math.round(performance.now()-t),
      eqRows:document.querySelectorAll("#ppGanttToolV2 .pg2-row").length,
      bars:document.querySelectorAll("#ppGanttToolV2 .pg2-bar").length,
      lag:window.__gaRenderLag}
   },n),
   new Promise((_,reject)=>setTimeout(()=>reject(Error("FULL_RENDER_EVALUATE_TIMEOUT_"+n)),20000))
  ]);
  console.log("FULL_RENDER_SYNC",n,JSON.stringify(result).slice(0,1800),"wallMs",Date.now()-t);
  await page.waitForTimeout(1750);
  const after=await Promise.race([
   page.evaluate(()=>({lag:window.__gaRenderLag,
     nodes:document.querySelectorAll("#ppGanttToolV2 .pg2-bar").length,
     lang:window.__PP_LANGUAGE__?.current,
     flags:{sse:window.__PP_SSE_PROGRESS_V1__?.state?.completed}})),
   new Promise((_,reject)=>setTimeout(()=>reject(Error("FULL_RENDER_AFTER_TIMEOUT_"+n)),9000))
  ]);
  console.log("FULL_RENDER_AFTER",n,JSON.stringify(after));
 }
 await runSize(140);
 await runSize(933);
 console.log("FULL_RENDER_PAGE_ERRORS",JSON.stringify(errors.slice(0,10)));
 console.log("FULL_RENDER_PROBE_COMPLETE");
}finally{await Promise.race([browser.close(),new Promise(r=>setTimeout(r,3000))])}
