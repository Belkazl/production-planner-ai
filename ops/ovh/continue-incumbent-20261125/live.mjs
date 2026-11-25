import {chromium} from "playwright-core";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";

const browser=await chromium.launch({headless:true,channel:"chrome"});
try {
 const page=await browser.newPage();
 await page.goto("https://app.liftorbit.app",{waitUntil:"domcontentloaded"});
 const response=await page.evaluate(async credentials=>{
   const r=await fetch("/api/auth/register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(credentials)});
   return r.status;
 },{email:"continue-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(28).toString("base64url"),company:"Continuation QA"});
 assert.equal(response,200);
 await page.reload({waitUntil:"domcontentloaded"});
 await page.waitForFunction(()=>typeof window.ppProjectAfterPlan==="function");
 const results=await page.evaluate(id=>{
   const project={id,name:"Continuation QA",revision:1,model:{orders:[{id:"order"}],equipment:[{id:"M"}],employees:[]}};
   const plan=minutes=>({ok:true,valid:true,partial:false,_revision:1,duration_minutes:minutes,
     operator_wait_minutes:0,machine_idle_minutes:0,batch_count:1,
     operations:[{order:"order",equipment_ids:["M"],start_min:0,end_min:minutes,phase:"process"}]});
   localStorage.setItem("prodplan.project.active.v2",id);
   localStorage.setItem("prodplan.projects.v2",JSON.stringify([{...project,lastPlan:plan(10)}]));
   Object.assign(window,{__ppFreshRestartMode:true,__ppFreshRestartProject:id,__ppFreshReferencePlan:null,__ppOptimizerObjectiveAtStart:"duration"});
   return [16350,16050,16020,16350].map(minutes=>{
     window.ppProjectAfterPlan(plan(minutes));
     const stored=JSON.parse(localStorage.getItem("prodplan.projects.v2")).find(p=>p.id===id);
     return [stored.lastPlan.duration_minutes,window.__ppFreshReferencePlan?.duration_minutes];
   });
 },randomUUID());
 assert.deepEqual(results,[[16350,16350],[16050,16050],[16020,16020],[16020,16020]]);
 console.log("Accepted durations in production",results);
} finally {await browser.close()}
