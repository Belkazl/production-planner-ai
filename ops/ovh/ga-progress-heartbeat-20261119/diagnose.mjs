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
 const machineNames=["SACMI PH3800 VELOCE","SACMI PH5000XXL VELOCE","SACMI/ECP RD5","E7P","VELA FC","CAM 1804-1806","DHD908","DHD1408","MAESTRO FMA","FBN-A","FBN-B","EKOSORT DINAMICA","FASTWRAP","EkoRoll"];
 const machineKinds=["pressing","pressing","drying","drying","glazing","glazing","decoration","decoration","firing","firing","firing","sorting","packaging","packaging"];
 const equipment=machineNames.map((name,i)=>({id:"EQ-"+i,name,kind:machineKinds[i],capacity:110,capacity_unit:"m2"}));
 const people=Array.from({length:6},(_,i)=>({id:"EMP-"+i,name:"Operator "+i,shift:"day"}));
 const operationEquipment=[0,2,4,6,8,11,12];
 const orderIds=["2601","2602","2604","2605","2606","2610"];
 const model={
  scheduler_mode:"resource",start:"2026-11-17T08:00:00",
  equipment,employees:people,shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},
  orders:orderIds.map((id,i)=>({id,quantity:[2400,2100,1800,2700,2100,1800][i],unit:"m2",
   technical_process_id:"CERAMIC_7_STAGES",parameters:{color:String(i%4)}})),
  technical_processes:[{id:"CERAMIC_7_STAGES",name:"Seven ceramic stages",operations:
   Array.from({length:7},(_,i)=>({id:"STAGE-"+i,name:machineKinds[operationEquipment[i]],sequence:i+1,duration_min:10,
    resource_requirements:[resource("equipment","EQ-"+operationEquipment[i]),resource("employee","EMP-"+(i%6))]}))}],
  materials:Array.from({length:6},(_,i)=>({id:"MAT-"+i,name:"Material "+i,unit:"kg",stock:1e9})),
  setup_rules:[{id:"CERAMIC_COLOR",equipment_ref:"*",setup_parameter:"color",from_state:"*",to_state:"*",duration_min:10,employee_count:0}]
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
 const noIntermediate=process.env.FREEZE_TEST_MODE==="no-intermediate";
 let suppressedUiProgressRequests=0;
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
 if(noIntermediate){
  // Keep the real startup handshake intact. The worker must already be running
  // before we isolate client-side progress traffic.
  if(!started)throw Error("REAL_OPTIMIZER_POST_WAS_NOT_SENT");
  let realProgress=null;
  for(let attempt=0;attempt<24;attempt++){
   const response=await ctx.request.get(base+"/api/plan-progress",{timeout:12000});
   const body=await response.json();
   if(body.phase==="running"){realProgress=body;break}
   if(["failed","stale","invalid"].includes(body.phase))throw Error("FAILED_BEFORE_ISOLATION_"+body.phase);
   await page.waitForTimeout(400);
  }
  if(!realProgress)throw Error("REAL_OPTIMIZER_DID_NOT_START");
  const safeProgress={ok:true,running:true,success:false,
   done:realProgress.done||0,total:100,percent:realProgress.percent||0,
   phase:"running",best_preview:null,candidate_preview:null,result:null,error:null};
  await page.route("**/api/plan-progress*",async route=>{
   if(route.request().method()!=="GET")return route.continue();
   suppressedUiProgressRequests++;
   return route.fulfill({status:200,contentType:"application/json",
    headers:{"cache-control":"no-store"},body:JSON.stringify(safeProgress)});
  });
  console.log("QA_REAL_GA_RUNNING_BEFORE_INTERCEPTION",
   JSON.stringify({postCount:requests.length,phase:realProgress.phase,percent:realProgress.percent}));
  console.log("QA_INTERMEDIATE_BROWSER_UPDATES_DISABLED",JSON.stringify({isolatedAccount:true}));
 }

 const safeAudit=plan=>{if(!plan)return null;
 const rows=plan.generic_operations?.length?plan.generic_operations:(plan.operations||[]);
 const sets={ord:new Set(model.orders.map(v=>String(v.id))),eq:new Set(model.equipment.map(v=>String(v.id))),emp:new Set(model.employees.map(v=>String(v.id))),mat:new Set(model.materials.map(v=>String(v.id)))};
 const bad=(key,k)=>rows.reduce((n,x)=>n+(x[key]||[]).filter(id=>!sets[k].has(String(id))).length,0);
 const ids=new Set([...sets.eq,...sets.emp]);
 const names=new Set([...model.equipment,...model.employees].map(v=>String(v.name||"")));
 const resourceBad=rows.reduce((n,x)=>n+(x.resources||[]).filter(y=>["equipment","employee"].includes(y.resource_type)&&y.id!=null&&!ids.has(String(y.id))&&!names.has(String(y.name||""))).length,0);
 return{rows:rows.length,setup:rows.filter(x=>x.is_setup).length,
 noOrder:rows.filter(x=>x.order==null).length,badOrder:rows.filter(x=>x.order!=null&&!sets.ord.has(String(x.order))).length,
 badEq:bad("equipment_ids","eq"),badEmp:bad("employee_ids","emp"),badMat:bad("material_ids","mat"),resourceBad,
 native:plan.operations?.length,generic:plan.generic_operations?.length,nestedBest:!!plan.best_preview,nestedCandidate:!!plan.candidate_preview,nestedVariants:plan.variants?.length||0,
 seed:plan.resume_state?.order_sequence?.length||0,seqBad:(plan.order_sequence||[]).filter(id=>!sets.ord.has(String(id))).length,batchBadOrder:(plan.batches||[]).filter(b=>b?.order!=null&&!sets.ord.has(String(b.order))).length,batchBadEq:(plan.batches||[]).reduce((n,b)=>n+(b?.equipment_ids||[]).filter(id=>!sets.eq.has(String(id))).length,0),valid:plan.valid,partial:plan.partial};
 };
 const epochs=Date.now();
 let lastProgress=null;
 for(let i=0;i<48;i++){
  if(Date.now()-epochs>155000)throw Error("CERAMIC_QA_WALL_TIME_EXCEEDED");
  await page.waitForTimeout(noIntermediate?8000:2000);
  let pageState=null,progressState=null;
  try{
   pageState=await Promise.race([
    page.evaluate(()=>({percent:document.getElementById("opt")?.textContent?.slice(0,65),probe:window.__freezeProbe,
     candidate:window.__PP_AUTO_INTERMEDIATE_PREVIEW_V1__?.switches,legacyStopped:window.__qaLegacyProgressStopped||false,skipped:window.__qaSkippedGantt||0,bars:document.querySelectorAll(".pg2-bar").length,
     backendPhase:window.__PP_STOP_DEBUG__?.()?.remotePhase,
     optimizerRunning:window.__PP_STOP_DEBUG__?.()?.running,
     currentClass:document.getElementById("opt")?.className,
     smoother:window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__?.state,
     nativeSmoothTarget:window.__PP_TRUTHFUL_SMOOTH_GA_PERCENT_V1__?.confirmedTarget})),
    new Promise((_,reject)=>setTimeout(()=>reject(Error("UI_EVAL_TIMEOUT")),4000))
   ]);
  }catch(e){pageState={error:String(e)}}
  try{
   const r=await ctx.request.get(base+"/api/plan-progress",{timeout:12000,headers:{"x-liftorbit-qa-trace":"1"}});
   const p=await r.json();progressState={code:r.status(),diagnostic:p.diagnostic||null,phase:p.phase,percent:p.percent,running:p.running,done:p.done,total:p.total,error:p.error,
    variantsCount:p.result?.variants?.length||0,candidateOps:p.candidate_preview?.operations?.length,candidateDuration:p.candidate_preview?.duration_minutes,bestDuration:p.best_preview?.duration_minutes,bestOps:p.best_preview?.operations?.length,unsetSetupOrder:(p.best_preview?.operations||[]).filter(x=>x?.is_setup&&x.order==null).length,bestValid:p.best_preview?.valid,bestPartial:p.best_preview?.partial,finalOps:p.result?.operations?.length,bestAudit:safeAudit(p.best_preview),candidateAudit:safeAudit(p.candidate_preview),finalAudit:safeAudit(p.result)};
  }catch(e){progressState={error:String(e).slice(0,70)}}
  lastProgress=progressState;
  console.log("GA_REAL_PROGRESS_TIMELINE",JSON.stringify({elapsedMs:Date.now()-epochs,phase:progressState?.phase,serverPercent:progressState?.percent,serverError:progressState?.error||null,ui:pageState?.percent,v3:pageState?.unified?.shown,uiStalled:pageState?.unified?.busy,liveLatencyMs:pageState?.probe?.maxLag}));
  if(noIntermediate && (i%5===0||progressState?.phase==="completed"))console.log("QA_INTERMEDIATE_ISOLATION_STATS",JSON.stringify({suppressedUiProgressRequests,elapsed:Date.now()-epochs}));
  if(i%5===0||progressState?.phase==="completed"||progressState?.error)console.log("LIVE_CERAMIC_COMPLEX_SAMPLE",i,JSON.stringify({pageState,progressState,elapsed:Date.now()-epochs,requests:requests.length}));
  if(pageState?.error==="Error: UI_EVAL_TIMEOUT")throw Error("RENDERER_UI_BLOCKED");
  if(progressState?.phase==="completed"||progressState?.phase==="failed"||progressState?.phase==="timed_out"||progressState?.phase==="stale"||progressState?.error==="account_plan_mismatch")break;
 }
 if(noIntermediate && suppressedUiProgressRequests<1)throw Error("NO_PROGRESS_REQUEST_INTERCEPTED");
 console.log("QA_INTERMEDIATE_ISOLATION_TOTAL",suppressedUiProgressRequests);
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
 if(lastProgress?.phase!=="completed")throw Error("CERAMIC_COMPLEX_NO_SUCCESS_"+JSON.stringify(lastProgress));
 const finalAudit=lastProgress.finalAudit;
 if(!finalAudit||finalAudit.rows<800||finalAudit.setup<25||finalAudit.badOrder||
    finalAudit.badEq||finalAudit.badEmp||finalAudit.badMat||finalAudit.resourceBad)
  throw Error("CERAMIC_COMPLEX_FINAL_NOT_OWNED_OR_INCOMPLETE_"+JSON.stringify(finalAudit));
 const persisted=await ctx.request.get(base+"/api/plan-progress",{timeout:30000});
 const snapshot=await persisted.json();
 if(persisted.status()!==200||snapshot.phase!=="completed"||
    !Array.isArray(snapshot.result?.operations)||snapshot.result.operations.length<800)
   throw Error("CERAMIC_COMPLEX_DURABLE_RESULT_MISSING_"+persisted.status()+"_"+snapshot.error);
 console.log("CERAMIC_DURABLE_PLAN_VERIFIED",JSON.stringify({rows:snapshot.result.operations.length,
   setups:snapshot.result.operations.filter(x=>x.is_setup).length,
   recovered:snapshot.result.optimization_account_check_recovered===true,
   completedEarly:snapshot.result.optimization_completed_early===true,
   reason:snapshot.result.optimization_termination_reason||null,
   actualGenerations:snapshot.result.total_generations??null,
   actualRuns:snapshot.result.optimization_run??null,
   duration:snapshot.result.duration_minutes}));

 if(errors.length)throw Error("BROWSER_ERRORS_"+JSON.stringify(errors.slice(0,4)));
 console.log("LIVE_CERAMIC_COMPLEX_GA_FINISHED");
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
