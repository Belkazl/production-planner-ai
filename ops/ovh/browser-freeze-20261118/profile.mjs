import {chromium} from "playwright-core";
import {randomUUID, randomBytes} from "node:crypto";
const base="https://app.liftorbit.app";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox"]});
const context=await browser.newContext({viewport:{width:1700,height:940}});
const page=await context.newPage();
page.on("pageerror",e=>console.log("BROWSER_JS_ERROR",String(e).slice(0,200)));
try {
 const initial=await page.goto(base,{waitUntil:"domcontentloaded",timeout:50000});
 if(initial.status()!==200)throw Error("HOME_BAD_"+initial.status());
 const reg=await page.evaluate(async ({email,password})=>{
  const r=await fetch("/api/auth/register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password,company:"Disposable freeze QA"})});
  return r.status;
 },{email:"freeze-qa-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid",password:randomBytes(28).toString("hex")});
 if(reg!==200)throw Error("REGISTRATION_"+reg);
 await page.goto(base,{waitUntil:"domcontentloaded",timeout:50000});
 await page.waitForFunction(()=>Boolean(window.__PP_UNIFIED_GANTT_V2__?.installed&&window.__PP_AUTO_INTERMEDIATE_PREVIEW_V1__?.installed&&window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__?.installed),null,{timeout:45000});
 console.log("FRONTEND_MODULES_READY");
 const t0=Date.now();
 const stats=await page.evaluate(()=>{
  document.getElementById("planView").style.display="block";
  document.getElementById("sectionView").style.display="none";
  const orders=Array.from({length:6},(_,i)=>"FROZEN_ORDER_"+i);
  const e=Array.from({length:14},(_,i)=>({id:"FRZ_EQ"+i,name:"Machine "+i,kind:"pressing",capacity:600}));
  const people=Array.from({length:6},(_,i)=>({id:"FRZ_EMP"+i,name:"Operator "+i,role:"operator"}));
  model={start:"2026-10-05T08:00:00",equipment:e,autoclaves:e,employees:people,
   orders:orders.map(id=>({id,quantity:600,unit:"m2",technical_process_id:"FRZ_TP"})),
   technical_processes:[{id:"FRZ_TP",name:"Ceramic line"}],materials:[]};
  modelReady=true;
  const operations=Array.from({length:1100},(_,i)=>({order:orders[i%6],
   start_min:i*5,end_min:i*5+4,is_setup:i<90,phase:i<90?"setup":"process",
   equipment_ids:["FRZ_EQ"+(i%14)],employee_ids:["FRZ_EMP"+(i%6)],
   operation_name:i<90?"Setup":"Glazing"}));
  const plan={valid:true,ok:true,partial:false,duration_minutes:5500,
   operator_wait_minutes:413124,machine_idle_minutes:16859,batch_count:144,
   start:model.start,operations,generic_operations:operations,batches:[]};
  window.__ppTabPlan=plan;window.__ppGenericPlan=plan;window.__ppOptimizerCommittedPlan=plan;
  const times=[];
  for(let i=0;i<5;i++){
   const t=performance.now();
   renderPlan(plan);
   times.push(Math.round(performance.now()-t));
  }
  const preview=document.querySelector("#ppLivePreview button[data-mode='candidate']");
  const b=document.getElementById("opt");
  b.classList.add("pp-opt-running");b.textContent="Optimization 0%";
  window.__ppOptimizationInFlight=true;
  window.__ppLiveCandidate=plan;
  window.__ppLiveBest=plan;
  preview.disabled=false;preview.classList.remove("a");
  const s=performance.now();
  window.__PP_AUTO_INTERMEDIATE_PREVIEW_V1__.refresh();
  const previewMs=Math.round(performance.now()-s);
  return {renderTimesMs:times,previewMs,autoSwitches:window.__PP_AUTO_INTERMEDIATE_PREVIEW_V1__.switches,
    rows:document.querySelectorAll("#ppGanttToolV2 .pg2-row").length,
    bars:document.querySelectorAll("#ppGanttToolV2 .pg2-bar").length};
 });
 console.log("FRONTEND_LARGE_PLAN_TEST",JSON.stringify(stats),"wallMs",Date.now()-t0);
 await page.waitForTimeout(2500);
 const alive=await page.evaluate(()=>({runningText:document.getElementById("opt")?.textContent?.slice(0,55),
  progress:window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__?.state,
  chartRows:document.querySelectorAll("#ppGanttToolV2 .pg2-row").length}));
 console.log("FRONTEND_ALIVE_AFTER_2500",JSON.stringify(alive));
 if(Math.max(...stats.renderTimesMs,stats.previewMs)>3500)throw Error("SLOW_GANTT_OVER_3500_MS");
 console.log("LARGE_FRONTEND_QA_SUCCESS");
} catch(e) {
 console.log("LARGE_FRONTEND_QA_FAILED",String(e?.stack||e).slice(0,1000));
 process.exitCode=1;
} finally {await browser.close();}
