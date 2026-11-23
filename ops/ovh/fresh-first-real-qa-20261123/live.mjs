import {chromium} from "playwright-core";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
const browser=await chromium.launch({headless:true,channel:"chrome",
 args:["--no-sandbox","--disable-dev-shm-usage"]});
const page=await browser.newPage({viewport:{width:1700,height:950}});
const errors=[],posts=[],responses=[];
page.on("pageerror",e=>errors.push(String(e).slice(0,280)));
page.on("request",req=>{
 try{
  if(new URL(req.url()).pathname!=="/api/plan"||req.method()!=="POST")return;
  const p=req.postDataJSON()||{};
  posts.push({continue:p.continue??null,continue_run:p.continue_run??null,
   hasResume:!!p.resume_plan,
   depth:p.optimization_depth??p.depth??null,
   first:Date.now()});
 }catch(e){errors.push("REQUEST_DIAG_"+String(e).slice(0,90))}
});
page.on("response",r=>{
 try{if(["/api/optimizer-reset","/api/plan"].includes(new URL(r.url()).pathname))
  responses.push({path:new URL(r.url()).pathname,status:r.status()})}catch{}
});
try{
 const base="https://app.liftorbit.app";
 const first=await page.goto(base,{waitUntil:"domcontentloaded",timeout:45000});
 assert.equal(first.status(),200);
 const email="fresh-baseline-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid";
 const password=randomBytes(30).toString("base64url");
 const status=await page.evaluate(async ({email,password})=>{
  const r=await fetch("/api/auth/register",{
   method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({email,password,company:"Disposable fresh-baseline QA"})
  });
  return r.status;
 },{email,password});
 assert.equal(status,200,"Disposable test account registration");
 const resource=(kind,id)=>({resource_type:kind,resource_ref:id,
  resource_refs:[id],match_mode:"specific",quantity:1});
 const kinds=["pressing","pressing","drying","drying","glazing","glazing",
  "decoration","decoration","firing","firing","firing","sorting","packaging","packaging"];
 const equipment=kinds.map((kind,i)=>({id:"EQ-"+i,name:"Equipment "+i,
  kind,capacity:110,capacity_unit:"m2"}));
 const employees=Array.from({length:6},(_,i)=>({
  id:"EMP-"+i,name:"Operator "+i,shift:"day"}));
 const operationEquipment=[0,2,4,6,8,11,12];
 const ids=["2601","2602","2604","2605","2606","2610"];
 const oldOp={operation_id:"OLD-COMMITTED",order:"2601",equipment_ids:["EQ-0"],
  employee_ids:["EMP-0"],start_min:0,end_min:55};
 const oldPlan={ok:true,valid:true,partial:false,_revision:10,
  operations:[oldOp],generic_operations:[oldOp],
  duration_minutes:999999,batch_count:1,operator_wait_minutes:11,machine_idle_minutes:22};
 const model={
  scheduler_mode:"resource",start:"2026-11-17T08:00:00",
  equipment,employees,shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},
  orders:ids.map((id,i)=>({id,quantity:[2400,2100,1800,2700,2100,1800][i],
   unit:"m2",technical_process_id:"PROC",parameters:{color:String(i%4)}})),
  technical_processes:[{id:"PROC",name:"Seven ceramic stages",operations:
   Array.from({length:7},(_,i)=>({id:"STEP-"+i,name:kinds[operationEquipment[i]],
    sequence:i+1,duration_min:10,
    resource_requirements:[resource("equipment","EQ-"+operationEquipment[i]),
      resource("employee","EMP-"+(i%6))]}))}],
  materials:Array.from({length:6},(_,i)=>({
   id:"MAT-"+i,name:"Material "+i,unit:"kg",stock:1e9})),
  setup_rules:[{id:"COLOR",equipment_ref:"*",setup_parameter:"color",
   from_state:"*",to_state:"*",duration_min:10,employee_count:0}]
 };
 const project="qa-fresh-"+randomUUID().replaceAll("-","");
 const projects=JSON.stringify([{id:project,name:"Fresh baseline isolated QA",
  model,revision:10,lastPlan:oldPlan}]);
 const sentinel='[{"id":"SAVED-PLAN-NEVER-DELETE","label":"Saved plan","duration_minutes":12}]';
 await page.evaluate(({project,projects,sentinel})=>{
  localStorage.setItem("prodplan.projects.v2",projects);
  localStorage.setItem("prodplan.project.active.v2",project);
  localStorage.setItem("prodplan.saved.plans.v2",sentinel);
  localStorage.setItem("pp.kpi.first-best.v1."+project,JSON.stringify({
   projectId:project,revision:10,compare:true,
   metrics:{duration:999999,cycles:1,wait:11,idle:22}
  }));
 },{project,projects,sentinel});
 const db=await page.evaluate(async ({projects,project})=>{
  const r=await fetch("/api/db-storage",{
   method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({storage:{"prodplan.projects.v2":projects,
    "prodplan.project.active.v2":project}})
  });
  return r.status;
 },{project,projects});
 assert.equal(db,200,"Store disposable project");
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>window.__PP_FRESH_OPTIMIZER_DEBUG__ &&
  document.getElementById("ppOptimizerStartOver") &&
  window.__PP_OPTIMIZER_DEPTH__?.installed===true,null,{timeout:45000});
 await page.waitForFunction(()=>window.__PP_STOP_DEBUG__?.().reconnecting===false,
  null,{timeout:45000});
 const before=await page.evaluate(({sentinel})=>{
  try{window.__PP_OPTIMIZER_DEPTH__?.set("quick")}catch(_){}
  window.__freshQa={cleared:null};
  window.addEventListener("pp:fresh-gantt-cleared",()=>{
   window.__freshQa.cleared={
    bars:document.querySelectorAll("#ppGanttToolV2 .pg2-bar").length,
    project:localStorage.getItem("prodplan.projects.v2"),
    saved:localStorage.getItem("prodplan.saved.plans.v2"),
    oldBaseline:window.__ppFreshDisplayBaseline,
    reference:window.__ppFreshReferencePlan,
    committed:window.__ppOptimizerCommittedPlan,
    pending:window.__ppFreshRestartPending,
    mode:window.__ppFreshRestartMode
   };
  });
  if(typeof window.renderPlan==="function")window.renderPlan(
   JSON.parse(localStorage.getItem("prodplan.projects.v2"))[0].lastPlan);
  return {bars:document.querySelectorAll("#ppGanttToolV2 .pg2-bar").length,
   saved:localStorage.getItem("prodplan.saved.plans.v2"),
   depth:window.__PP_OPTIMIZER_DEPTH__?.get?.().mode};
 },{sentinel});
 assert(before.bars>0,"Initial Gantt must display an existing older plan");
 console.log("FRESH_QA_OLD_GANTT_CONFIRMED",JSON.stringify(before));
 await page.locator("#ppOptimizerStartOver").click({timeout:20000});
 await page.waitForFunction(()=>window.__freshQa?.cleared!=null,null,{timeout:45000});
 const afterReset=await page.evaluate(()=>({
  cleared:window.__freshQa.cleared,
  kpiBaseline:window.__PP_KPI_FIRST_BEST_V1__?.snapshot,
  selected:window.__PP_KPI_SELECTED_REFERENCE_V2__?.snapshot,
  storedSaved:localStorage.getItem("prodplan.saved.plans.v2")
 }));
 assert.equal(afterReset.cleared.bars,0,"Old Gantt operations must disappear immediately");
 assert.equal(afterReset.cleared.oldBaseline,null,"Old plan must not return as provisional baseline");
 assert.equal(afterReset.cleared.reference,null);
 assert.equal(afterReset.cleared.committed,null);
 assert.equal(afterReset.cleared.pending,true);
 assert.equal(afterReset.cleared.mode,true);
 assert.equal(afterReset.cleared.saved,sentinel);
 assert.equal(afterReset.storedSaved,sentinel);
 assert.deepEqual(JSON.parse(afterReset.cleared.project)[0].model,model,
  "Orders/materials/equipment/processes must not be reset");
 assert(!afterReset.kpiBaseline?.compare,"Old KPI comparison must be cleared");
 assert(!afterReset.selected?.compare,"Old selected-plan comparison must be cleared");
 console.log("FRESH_QA_GANTT_EMPTY_WITH_NO_COMPARATOR_AND_SAVED_UNCHANGED_PASS",
  JSON.stringify({bars:afterReset.cleared.bars,oldReference:afterReset.cleared.reference,
   kpiComparison:afterReset.kpiBaseline?.compare??null,selectedComparison:afterReset.selected?.compare??null}));
 await page.waitForFunction(()=>window.__PP_SSE_PROGRESS_V1__?.state?.active===true||
    window.__PP_SSE_PROGRESS_V1__?.state?.completed===true,
   null,{timeout:45000});
 await page.waitForFunction(()=>window.__qaNoop===true || document.getElementById("opt")!=null,
   null,{timeout:10000});
 await page.waitForTimeout(1500);
 assert(posts.length>0,"Start optimization again must launch an actual new GA run");
 const firstPost=posts[0];
 assert(!firstPost.continue&&!firstPost.continue_run,
  "Fresh iteration cannot silently continue the old optimizer run: "+JSON.stringify(firstPost));
 assert.equal(firstPost.hasResume,false,
  "Fresh iteration must not inherit an old schedule/resume hint");
 console.log("FRESH_QA_REAL_GA_FIRST_POST_HAS_NO_OLD_RESUME_PASS",
   JSON.stringify({posts:posts.length,first:firstPost,responses}));
 // The model is intentionally large and a real worker may take a while.
 // The primary requirement here is verified new-job start with a cleared
 // Gantt and zero comparator; the deterministic browser test separately
 // validates first final plan becomes the next comparison baseline.
 const final=await page.evaluate(()=>({
  progress:window.__PP_SSE_PROGRESS_V1__?.state,
  fresh:window.__PP_FRESH_OPTIMIZER_DEBUG__?.(),
  saved:localStorage.getItem("prodplan.saved.plans.v2")
 }));
 assert.equal(final.saved,sentinel);
 assert.equal(final.progress?.active,true);
 console.log("FRESH_QA_REAL_OVH_RUN_LAUNCHED_AND_SAVED_PRESERVED",
   JSON.stringify({progress:final.progress?.percent,active:final.progress?.active,
    responses,errors:errors.slice(-5)}));
}finally{await browser.close()}
