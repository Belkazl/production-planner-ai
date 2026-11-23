import {chromium} from "playwright-core";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try {
 const page=await browser.newPage();
 const resp=await page.goto("https://app.liftorbit.app",{waitUntil:"domcontentloaded",timeout:45000});
 assert.equal(resp.status(),200);
 const email="ga-seed-qa-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid";
 const pw=randomBytes(30).toString("base64url");
 const register=await page.evaluate(async ({email,pw})=>{
   const r=await fetch("/api/auth/register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password:pw,company:"Disposable GA seed QA"})});
   return r.status;
 },{email,pw});
 assert.equal(register,200,"temporary isolated test registration");
 const resource=(kind,id)=>({resource_type:kind,resource_ref:id,resource_refs:[id],match_mode:"specific",quantity:1});
 const kinds=["pressing","pressing","drying","drying","glazing","glazing","decoration","decoration","firing","firing","firing","sorting","packaging","packaging"];
 const equipment=kinds.map((kind,i)=>({id:"EQ-"+i,name:"Equipment "+i,kind,capacity:110,capacity_unit:"m2"}));
 const employees=Array.from({length:5},(_,i)=>({id:"EMP-"+i,name:"Operator "+i,shift:"day"}));
 const opEq=[0,2,4,6,8,11,12];
 const ids=["2601","2602","2603","2604","2605","2606","2607","2608","2609","2610","2611","2612"];
 const model={scheduler_mode:"resource",start:"2026-11-23T08:00:00",
  equipment,employees,shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},
  orders:ids.map((id,i)=>({id,quantity:[2400,2100,1800,2700,2100,1800,1300,1600,1700,1800,2100,1700][i],unit:"m2",technical_process_id:"PROC",parameters:{color:String(i%4)}})),
  technical_processes:[{id:"PROC",name:"Seven ceramic stages",operations:Array.from({length:7},(_,i)=>({
   id:"STEP-"+i,name:kinds[opEq[i]],sequence:i+1,duration_min:10,
   resource_requirements:[resource("equipment","EQ-"+opEq[i]),resource("employee","EMP-"+(i%5))]
  }))}],
  materials:[{id:"MAT-1",name:"Material",unit:"kg",stock:100000}],
  setup_rules:[{id:"COLOR",equipment_ref:"*",setup_parameter:"color",from_state:"*",to_state:"*",duration_min:10,employee_count:0}]
 };
 const project="qa-ga-seed-"+randomUUID().replaceAll("-","");
 const projects=JSON.stringify([{id:project,name:"Disposable GA test",model,revision:1}]);
 const stored=await page.evaluate(async ({project,projects})=>{
  const r=await fetch("/api/db-storage",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({storage:{"prodplan.projects.v2":projects,"prodplan.project.active.v2":project}})});
  return r.status;
 },{project,projects});
 assert.equal(stored,200,"isolated project creation");
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 const run=async(num)=>{
  const start=await page.evaluate(async ()=>{
   const r=await fetch("/api/plan",{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"content-type":"application/json","accept":"application/json"},body:JSON.stringify({generations:20,population:24,objective:"duration",continue:false,continue_run:false,__pp_async_start:true})});
   return {status:r.status,body:await r.json()};
  });
  assert.equal(start.status,202,"fresh worker startup "+num+" "+JSON.stringify(start));
  assert(start.body.started===true&&/^[0-9a-f]{32}$/.test(start.body.job_id||""),"new real GA job "+num);
  assert(start.body.joined!==true,"fresh job must not rejoin old job");
  console.log("FRESH_GA_LIVE_NEW_JOB",num,start.body.job_id);
  let state=null;
  for(let i=0;i<220;i++){
   await page.waitForTimeout(1400);
   state=await page.evaluate(async()=>{
    const r=await fetch("/api/plan-progress?qa="+Date.now(),{credentials:"same-origin",cache:"no-store"});
    return {status:r.status,body:await r.json()};
   });
   assert.equal(state.status,200,"progress endpoint "+num);
   const d=state.body;
   if(i%12===0)console.log("FRESH_GA_LIVE_PROGRESS",num,i,d.phase,d.percent,d.running,d.best_preview?.duration_minutes??null,d.candidate_preview?.duration_minutes??null,d.best_preview?.operations?.length??null);
   if(d.phase==="completed"||d.success===true||d.phase==="complete"){
     assert(d.result?.valid===true,"completed valid plan");
     assert((d.result.operations||[]).length>0,"completed nonempty operations");
     assert(Number.isFinite(Number(d.result.duration_minutes)),"valid duration");
     console.log("FRESH_GA_LIVE_FINISH",JSON.stringify({num,job:start.body.job_id,duration:d.result.duration_minutes,cycles:d.result.batch_count,priorBestRestored:!!d.result.optimization_prior_best_restored,bestDuration:d.best_preview?.duration_minutes??null,gen:d.result.total_generations??null,rows:d.result.operations.length}));
     return {id:start.body.job_id,plan:d.result};
   }
   if(["failed","cancelled","invalid","timed_out","stale","interrupted"].includes(d.phase))throw Error("FRESH_GA_WORKER_BAD_TERMINAL_"+num+"_"+JSON.stringify({phase:d.phase,error:d.error}));
  }
  throw Error("FRESH_GA_CALCULATION_NO_COMPLETE_"+num+"_"+JSON.stringify({phase:state?.body?.phase,percent:state?.body?.percent}));
 };
 const first=await run(1);
 const reset=await page.evaluate(async()=>{
   const r=await fetch("/api/optimizer-reset",{method:"POST",cache:"no-store",credentials:"same-origin"});
   return r.status;
 });
 assert.equal(reset,200,"clear prior GA state between genuinely independent runs");
 const second=await run(2);
 assert.notEqual(first.id,second.id,"two different GA jobs");
 console.log("FRESH_GA_REPEATED_PLAN_DIAGNOSTIC",JSON.stringify({firstDuration:first.plan.duration_minutes,secondDuration:second.plan.duration_minutes,firstRestored:!!first.plan.optimization_prior_best_restored,secondRestored:!!second.plan.optimization_prior_best_restored}));
 console.log("FRESH_GA_TWO_INDEPENDENT_COMPLETED_JOBS_PASS",JSON.stringify({jobsDifferent:true,first:first.plan.duration_minutes,second:second.plan.duration_minutes,firstOps:first.plan.operations.length,secondOps:second.plan.operations.length}));
} finally { await browser.close(); }
