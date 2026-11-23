import {chromium} from "playwright-core";
import assert from "node:assert/strict";
import {randomUUID,randomBytes} from "node:crypto";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1365,height:920}});
 const response=await page.goto("https://app.liftorbit.app",{waitUntil:"domcontentloaded",timeout:45000});
 assert.equal(response.status(),200);
 const email="kpi-current-base-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid";
 const password=randomBytes(28).toString("base64url");
 const registered=await page.evaluate(async ({email,password})=>{
  const r=await fetch("/api/auth/register",{method:"POST",
    headers:{"content-type":"application/json"},body:JSON.stringify({email,password,company:"KPI comparison isolation QA"})});
  return r.status;
 },{email,password});
 assert.equal(registered,200,"disposable account signup");
 const projectId="kpi-rebase-"+randomUUID().replaceAll("-","");
 const project={id:projectId,name:"KPI delta reference QA",revision:3,
  model:{orders:[{id:"ORD-1",quantity:20,unit:"m2"}],
    equipment:[{id:"EQ-1",name:"Machine",kind:"pressing",capacity:20,capacity_unit:"m2"}],
    employees:[{id:"EMP-1",name:"Operator"}]},
  lastPlan:{ok:true,valid:true,partial:false,_revision:3,
    duration_minutes:8290,batch_count:118,operator_wait_minutes:400000,machine_idle_minutes:17000,
    operations:[{operation_id:"OP-1",order:"ORD-1",start_min:0,end_min:100,
      equipment_ids:["EQ-1"],employee_ids:["EMP-1"],phase:"process"}]}
 };
 const projectStorage=JSON.stringify([project]);
 const save=await page.evaluate(async ({projectId,projectStorage})=>{
  const r=await fetch("/api/db-storage",{method:"POST",headers:{"content-type":"application/json"},
     body:JSON.stringify({storage:{"prodplan.project.active.v2":projectId,"prodplan.projects.v2":projectStorage}})});
  return r.status;
 },{projectId,projectStorage});
 assert.equal(save,200);
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>window.__PP_KPI_SELECTED_REFERENCE_V2__?.installed&&
  window.__PP_KPI_FIRST_BEST_V1__?.installed&&document.getElementById("dur"),null,{timeout:40000});
 const makeRecord=(duration,compare,source)=>({projectId,revision:3,
  metrics:{duration,cycles:119,wait:390000,idle:20000},compare,selectedSource:source});
 const keys={projectId,projectStorage,kpiKey:"pp.kpi.first-best.v1."+projectId};
 const v=await page.evaluate(({projectId,projectStorage,kpiKey})=>{
  localStorage.setItem("prodplan.project.active.v2",projectId);
  localStorage.setItem("prodplan.projects.v2",projectStorage);
  const stale={projectId,revision:3,metrics:{duration:8695,cycles:119,wait:390000,idle:20000},
   compare:true,selectedSource:"historical_result"};
  localStorage.setItem(kpiKey,JSON.stringify(stale));
  window.__PP_KPI_FIRST_BEST_V1__.sync();
  const before=window.__PP_KPI_SELECTED_REFERENCE_V2__.snapshot;
  window.__PP_KPI_SELECTED_REFERENCE_V2__.markContinue();
  const after=window.__PP_KPI_SELECTED_REFERENCE_V2__.snapshot;
  let durationDelta=null;
  try{
   const plan=JSON.parse(projectStorage)[0].lastPlan;
   window.renderKpisWithDelta?.(plan);
   durationDelta=document.getElementById("durDelta")?.textContent?.trim()||null;
  }catch(e){durationDelta="RENDER_ERROR:"+String(e)}
  return {before,after,durationDelta,visibleDuration:document.getElementById("dur")?.textContent?.trim()};
 },keys);
 assert.equal(v.before.metrics.duration,8695);
 assert.equal(v.after.metrics.duration,8290,"old stale 8695 must be replaced by 8290");
 assert.equal(v.after.compare,true);
 assert.equal(v.after.metrics.cycles,118,"all metrics must come from the same chosen plan");
 assert(!/[-−]405|[-−]4[,.]7/.test(v.durationDelta||""),"old -4.7% must not persist");
 if(v.durationDelta!=null)assert(/0/.test(v.durationDelta),"identical 8290 -> 8290 must show 0 change");
 console.log("KPI_8290_TO_8290_EQUALS_ZERO_PASS",JSON.stringify(v));
 // A manually chosen STOP plan is the authority even if project.lastPlan is stale.
 const manual=await page.evaluate(({projectId,kpiKey})=>{
  localStorage.setItem(kpiKey,JSON.stringify({
   projectId,revision:3,metrics:{duration:7800,cycles:101,wait:300000,idle:14000},
   compare:false,selectedSource:"stop_selected"
  }));
  window.__PP_KPI_SELECTED_REFERENCE_V2__.markContinue();
  return window.__PP_KPI_SELECTED_REFERENCE_V2__.snapshot;
 },keys);
 assert.equal(manual.metrics.duration,7800,"selected stopped plan must be used");
 assert.equal(manual.metrics.cycles,101);
 assert.equal(manual.compare,true);
 console.log("KPI_EXPLICIT_STOP_SELECTION_PRESERVED_PASS");
 // Subsequent new accepted result must rebase again, not keep 7800 indefinitely.
 const repeated=await page.evaluate(({projectStorage,projectId,kpiKey})=>{
  const updated=JSON.parse(projectStorage);
  updated[0].lastPlan.duration_minutes=7950;
  updated[0].lastPlan.batch_count=111;
  localStorage.setItem("prodplan.projects.v2",JSON.stringify(updated));
  window.__PP_KPI_SELECTED_REFERENCE_V2__.markContinue();
  return window.__PP_KPI_SELECTED_REFERENCE_V2__.snapshot;
 },keys);
 assert.equal(repeated.metrics.duration,7950);
 assert.equal(repeated.metrics.cycles,111);
 console.log("KPI_EACH_CONTINUE_REFRESHES_BASELINE_PASS");
} finally{await browser.close()}
