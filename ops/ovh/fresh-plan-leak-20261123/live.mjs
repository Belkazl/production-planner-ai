import {chromium} from "playwright-core";
import {randomBytes,randomUUID} from "node:crypto";
import assert from "node:assert/strict";
const browser=await chromium.launch({channel:"chrome",headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage();
 const base="https://app.liftorbit.app";
 let r=await page.goto(base,{waitUntil:"domcontentloaded",timeout:50000});
 assert.equal(r.status(),200);
 const email="qa-stale-floor-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid";
 const password=randomBytes(28).toString("base64url");
 const registered=await page.evaluate(async({email,password})=>{
  const r=await fetch("/api/auth/register",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({email,password,company:"Fresh plan isolation QA"})});
  return r.status;
 },{email,password});
 assert.equal(registered,200,"fresh disposable account registration");
 const project="fresh-plan-isolation-"+randomUUID().replaceAll("-","");
 const model={scheduler_mode:"resource",start:"2026-11-23T08:00:00",
  orders:[{id:"A",quantity:10,unit:"m2",technical_process_id:"P"}],
  equipment:[{id:"M",name:"Machine M",kind:"workstation",capacity:20,capacity_unit:"m2"}],
  employees:[{id:"E",name:"Employee E",shift:"day"}],
  shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},
  technical_processes:[{id:"P",name:"Process P",operations:[{id:"S",name:"Stage",
   sequence:1,duration_min:20,resource_requirements:[
    {resource_type:"equipment",resource_ref:"M",resource_refs:["M"],match_mode:"specific",quantity:1},
    {resource_type:"employee",resource_ref:"E",resource_refs:["E"],match_mode:"specific",quantity:1}
  ]}]}],materials:[],setup_rules:[]
 };
 const make=(duration,cycles)=>({ok:true,valid:true,partial:false,
  duration_minutes:duration,batch_count:cycles,operator_wait_minutes:duration,
  machine_idle_minutes:duration,operations:[{order:"A",start_min:0,end_min:duration,
    equipment_ids:["M"],employee_ids:["E"],phase:"process"}]});
 const prior=make(50,1);
 const projectData=JSON.stringify([{id:project,name:"Stale prior result regression",model,revision:1,lastPlan:prior}]);
 const saved='[{"id":"SAVED-PLAN-LEAVE-UNCHANGED","label":"Saved old plan"}]';
 const status=await page.evaluate(async({project,projectData,saved})=>{
  localStorage.setItem("prodplan.project.active.v2",project);
  localStorage.setItem("prodplan.projects.v2",projectData);
  localStorage.setItem("prodplan.saved.plans.v2",saved);
  const r=await fetch("/api/db-storage",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({storage:{"prodplan.project.active.v2":project,
      "prodplan.projects.v2":projectData}})});
  return r.status;
 },{project,projectData,saved});
 assert.equal(status,200);
 await page.reload({waitUntil:"domcontentloaded",timeout:50000});
 await page.waitForFunction(()=>window.__PP_GA_OBJECTIVE_FLOOR_V1__?.installed===true,null,{timeout:35000});
 await page.evaluate(({project,projectData,saved})=>{
  localStorage.setItem("prodplan.project.active.v2",project);
  localStorage.setItem("prodplan.projects.v2",projectData);
  localStorage.setItem("prodplan.saved.plans.v2",saved);
  window.__ppOptimizerObjectiveAtStart="duration";
  window.__ppFreshRestartMode=false;window.__ppFreshRestartProject=null;
  window.__ppFreshReferencePlan=null;window.__ppFreshRestartPending=false;
 },{project,projectData,saved});
 let candidate=make(100,2);
 await page.route("**/api/plan-progress?qaStale=*",async route=>{
   await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
      ok:true,running:false,success:true,phase:"completed",result:candidate})});
 });
 const req=()=>page.evaluate(async()=>await(await fetch("/api/plan-progress?qaStale="+Date.now(),
    {cache:"no-store",credentials:"same-origin"})).json());
 const normal=await req();
 assert.equal(normal.result.duration_minutes,50,"normal continue mode intentionally keeps existing better plan");
 assert.equal(normal.result.optimization_previous_best_preserved,true);
 console.log("FRESH_LEAK_CONTINUE_OLD_FLOOR_STILL_ACTIVE_PASS");
 await page.evaluate(project=>{
  window.__ppFreshRestartMode=true;
  window.__ppFreshRestartProject=project;
  window.__ppFreshRestartPending=false; // real UI clears this after it dispatches GA POST
  window.__ppFreshReferencePlan=null;
 },project);
 const fresh=await req();
 assert.equal(fresh.result.duration_minutes,100,
  "fresh result MUST NOT be masked by a pre-reset project.lastPlan at 50 minutes");
 assert.notEqual(fresh.result.optimization_previous_best_preserved,true);
 console.log("FRESH_LEAK_SAVED_PRIOR_PLAN_NOT_SUBSTITUTED_PASS");
 await page.evaluate(makePlan=>{
   window.__ppFreshReferencePlan=makePlan;
 },make(80,1));
 const freshContinue=await req();
 assert.equal(freshContinue.result.duration_minutes,80,
  "follow-on comparisons must use only the newly accepted fresh plan, not the older 50-minute plan");
 assert.equal(freshContinue.result.optimization_previous_best_preserved,true);
 candidate=make(70,1);
 const improved=await req();
 assert.equal(improved.result.duration_minutes,70,
  "new, better plan must be accepted");
 assert.notEqual(improved.result.optimization_previous_best_preserved,true);
 console.log("FRESH_LEAK_NEW_BASELINE_AND_BETTER_CANDIDATE_PASS");
 const unchanged=await page.evaluate(saved=>localStorage.getItem("prodplan.saved.plans.v2")===saved,saved);
 assert.equal(unchanged,true,"saved plans must be preserved");
 console.log("FRESH_LEAK_END_TO_END_BROWSER_PASS");
}finally{await browser.close();}
