import {chromium} from "playwright-core";
import {randomUUID,randomBytes} from "node:crypto";
const base="https://app.liftorbit.app";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox"]});
const ctx=await browser.newContext({viewport:{width:1700,height:960}});
const page=await ctx.newPage();
const errors=[], requests=[];
const progressNetworkFailures=[], progressHttpErrors=[];
const firstStageResponseHeaders=[],firstStageVisibleSamples=[];
page.on("response",r=>{try{
 if(new URL(r.url()).pathname==="/api/plan-progress"&&r.status()===200){
  const stage=r.headers()["x-liftorbit-ga-stage"];
  if(stage)firstStageResponseHeaders.push({t:Date.now(),stage});
 }
}catch{}});
page.on("requestfailed",r=>{try{if(new URL(r.url()).pathname==="/api/plan-progress")progressNetworkFailures.push({failure:r.failure(),time:Date.now()})}catch{}});
page.on("response",r=>{try{if(new URL(r.url()).pathname==="/api/plan-progress"&&r.status()>=400)progressHttpErrors.push(r.status())}catch{}});
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
 const noIntermediate=false;
 const guard=await page.evaluate(()=>({v4:window.__PP_GA_PROGRESS_V4__?.installed===true,shed:window.__PP_GA_PROGRESS_LOAD_SHED_V1__?.installed===true}));
 if(!guard.v4||!guard.shed)throw Error("LIVE_ADAPTIVE_GA_PROGRESS_NOT_INSTALLED_"+JSON.stringify(guard));
 console.log("GA_SHED_LIVE_GUARDS",JSON.stringify(guard));
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
  await page.waitForTimeout(4000);
  let pageState=null,progressState=null;
  try{
   pageState=await Promise.race([
    page.evaluate(()=>({percent:document.getElementById("opt")?.textContent?.slice(0,65),probe:window.__freezeProbe,
     candidate:window.__PP_AUTO_INTERMEDIATE_PREVIEW_V1__?.switches,legacyStopped:window.__qaLegacyProgressStopped||false,skipped:window.__qaSkippedGantt||0,bars:document.querySelectorAll(".pg2-bar").length,
     backendPhase:window.__PP_STOP_DEBUG__?.()?.remotePhase,
     optimizerRunning:window.__PP_STOP_DEBUG__?.()?.running,
     currentClass:document.getElementById("opt")?.className,
     currentDisabled:document.getElementById("opt")?.disabled,
     effectiveAfter:getComputedStyle(document.getElementById("opt"),"::after").content,
     smoother:window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__?.state,
     nativeSmoothTarget:window.__PP_TRUTHFUL_SMOOTH_GA_PERCENT_V1__?.confirmedTarget,shed:window.__PP_GA_PROGRESS_LOAD_SHED_V1__?.state,v4:window.__PP_GA_PROGRESS_V4__?.state})),
    new Promise((_,reject)=>setTimeout(()=>reject(Error("UI_EVAL_TIMEOUT")),4000))
   ]);
  }catch(e){pageState={error:String(e)}}
  // Observe the browser's REAL authenticated native optimizer poll. An
  // independent 2s test-client GET previously generated additional expensive
  // setup recalculations and wasn't representative of a single user session.
  progressState={phase:pageState?.v4?.finalDone?"completed":pageState?.backendPhase,
   running:pageState?.optimizerRunning,percent:pageState?.v4?.confirmed,
   busy:pageState?.v4?.running,shed:pageState?.shed,
   bars:pageState?.bars,visual100:pageState?.v4?.has100,
   networkFailures:progressNetworkFailures.length,httpErrors:progressHttpErrors.length};
  lastProgress=progressState;
  if(pageState?.v4?.confirmed<=1&&pageState?.v4?.firstStage){
   firstStageVisibleSamples.push({at:Date.now()-epochs,stage:pageState.v4.firstStage,
    label:pageState.v4.visible,cls:pageState.currentClass,percent:pageState.v4.confirmed});
  }
  // An underlying native Continue label is allowed ONLY when the CSS owner
  // covers it with Optimization N% and the original button cannot be clicked.
  // The first visibly clickable Continue must contain the verified 100%.
  if(pageState && /continue|продолж/i.test(String(pageState.percent||"")) && !pageState.v4?.finalDone){
   // The native app changes text and class across separate microtasks.
   // Give the single V5 owner one 65-ms polling tick before deciding that
   // a transient DOM snapshot was actually exposed to the user.
   await page.waitForTimeout(350);
   const transition=await page.evaluate(()=>({
    native:document.getElementById("opt")?.textContent,
    disabled:document.getElementById("opt")?.disabled,
    cls:document.getElementById("opt")?.className,
    css:getComputedStyle(document.getElementById("opt"),"::after").content,
    v4:window.__PP_GA_PROGRESS_V4__?.state
   }));
   if(/continue|продолж/i.test(String(transition.native||""))&&!transition.v4?.finalDone&&
     (!transition.v4?.finishing||!transition.v4?.visible?.includes("%")||
      /continue|продолж/i.test(transition.v4.visible)||!transition.disabled||
      !/(pp-ga-v4-busy|pp-ga-v4-final)/.test(transition.cls||"")||
      !/Optimization|Оптимизация/.test(transition.css||"")))
    throw Error("GA_V5_REAL_EARLY_CONTINUE_EXPOSED_"+JSON.stringify({transition,previous:pageState,elapsed:Date.now()-epochs}));
  }
    console.log("GA_LOAD_SHED_REAL_BROWSER_SAMPLE",JSON.stringify({i,elapsed:Date.now()-epochs,state:progressState,ui:pageState?.percent,visible:pageState?.v4?.visible}));
  if(noIntermediate && (i%5===0||progressState?.phase==="completed"))console.log("QA_INTERMEDIATE_ISOLATION_STATS",JSON.stringify({suppressedUiProgressRequests,elapsed:Date.now()-epochs}));
  if(i%5===0||progressState?.phase==="completed"||progressState?.error)console.log("LIVE_CERAMIC_COMPLEX_SAMPLE",i,JSON.stringify({pageState,progressState,elapsed:Date.now()-epochs,requests:requests.length}));
  if(pageState?.error==="Error: UI_EVAL_TIMEOUT")throw Error("RENDERER_UI_BLOCKED");
  if(pageState?.v4?.finalDone)break;
  if(progressState?.phase==="failed"||progressState?.phase==="timed_out"||progressState?.phase==="stale")break;
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
 if(lastProgress?.phase!=="completed")throw Error("CERAMIC_COMPLEX_NO_VISIBLE_SUCCESS_"+JSON.stringify(lastProgress));
 const built=firstStageResponseHeaders.filter(x=>x.stage==="building_first_plan");
 const forwardedStageEvents=await page.evaluate(()=>window.__PP_GA_PROGRESS_V4__?.state.serverStageEvents||0);
 // The first full status may correctly say queued, loading, or building:
 // expensive GA response throttling can skip very brief intermediate stages.
 // What matters is a genuine worker stage and an advancing visible clock
 // while the real numerical progress still has not passed 1%.
 const shown=firstStageVisibleSamples.filter(x=>
  /Preparing optimization|Подготовка оптимизации|Preparing calculation|Подготовка расчёта|Validating model|Проверка модели|Preparing resources|Подготовка ресурсов|Building the first plan|Формирование первого плана|Optimizing candidate plans|Поиск лучшего плана/.test(x.label||"")&&
  /pp-ga-v4-busy/.test(x.cls||"")&&x.percent<=1);
 const clock=x=>{const m=(x.label||"").match(/(\d\d):(\d\d)/);
  return m?Number(m[1])*60+Number(m[2]):-1};
 const advanced=shown.length>=2&&shown.some(x=>clock(x)>clock(shown[0]));
 console.log("GA_INITIAL_STAGE_LIVE_RESPONSE_AND_LABEL_AUDIT",JSON.stringify({
  networkFirstPlan:built.length,forwardedStageEvents,headers:firstStageResponseHeaders.map(x=>x.stage).slice(0,20),
  firstPlanLabels:shown.map(x=>({at:x.at,label:x.label})),clockAdvanced:advanced}));
 if((!built.length&&!forwardedStageEvents)||!shown.length||!advanced)
  throw Error("GA_INITIAL_STAGE_1_PERCENT_NO_ACTIVE_SERVER_HEARTBEAT_"+JSON.stringify({
   headers:firstStageResponseHeaders.map(x=>x.stage).slice(0,20),samples:firstStageVisibleSamples.slice(0,10)}));
 console.log("GA_INITIAL_STAGE_TRUTHFUL_PREPARATION_CLOCK_LIVE_PASS");
 const shed=await page.evaluate(()=>window.__PP_GA_PROGRESS_LOAD_SHED_V1__?.state);
 const v4=await page.evaluate(()=>window.__PP_GA_PROGRESS_V4__?.state);
 console.log("GA_SHED_REAL_BROWSER_SUMMARY",JSON.stringify({shed,v4,errors:progressNetworkFailures,httpErrors:progressHttpErrors}));
 if(!shed||shed.maxOps<350||shed.lightweight<2||shed.realCalls<2)
  throw Error("GA_SHED_DID_NOT_REDUCE_FULL_PLANS_"+JSON.stringify(shed));
 if(progressNetworkFailures.length||progressHttpErrors.length)
  throw Error("GA_SHED_BROWSER_PROGRESS_NETWORK_FAILURES_"+JSON.stringify({progressNetworkFailures,progressHttpErrors}));
 if(!v4||v4.firstStagePaints<2)throw Error("GA_INITIAL_STAGE_UI_NEVER_UPDATED_CLOCK");
 if(!v4?.finalDone||!v4.has100||!v4.visible?.includes("100%"))
  throw Error("GA_SHED_VISIBLE_100_NOT_PERSISTENT_"+JSON.stringify(v4));
 const persisted=await ctx.request.get(base+"/api/plan-progress",{timeout:30000});
 const snapshot=await persisted.json();
 if(persisted.status()!==200||snapshot.phase!=="completed"||
    !Array.isArray(snapshot.result?.operations)||snapshot.result.operations.length<800)
   throw Error("CERAMIC_COMPLEX_DURABLE_RESULT_MISSING_"+persisted.status()+"_"+snapshot.error);
 const finalAudit=safeAudit(snapshot.result);
 if(!finalAudit||finalAudit.rows<800||finalAudit.setup<25||finalAudit.badOrder||
  finalAudit.badEq||finalAudit.badEmp||finalAudit.badMat||finalAudit.resourceBad)
  throw Error("GA_SHED_FINAL_VALIDATION_FAILED_"+JSON.stringify(finalAudit));
 await page.waitForTimeout(6200);
 console.log("GA_V5_LIVE_NO_EARLY_CONTINUE_GUARD_REACHED");
 const held=await page.evaluate(()=>({
  v4:window.__PP_GA_PROGRESS_V4__?.state,
  label:document.getElementById("opt")?.getAttribute("data-pp-ga-v4-label"),
  native:document.getElementById("opt")?.textContent?.slice(0,90),
  disabled:document.getElementById("opt")?.disabled,
  extra:document.querySelectorAll("#ppGaProgressBusyV2,#ppGaProgressFinalV2,#ppGaTerminal100V1").length
 }));
 console.log("GA_SHED_VISIBLE_100_HELD_FOR_SIX_SECONDS",JSON.stringify(held));
 if(!held.v4?.finalDone||!held.label?.includes("100%")||held.disabled||held.extra)
  throw Error("GA_SHED_FINAL_BUTTON_BROKEN_"+JSON.stringify(held));
 console.log("CERAMIC_DURABLE_PLAN_VERIFIED",JSON.stringify({rows:snapshot.result.operations.length,
   setups:snapshot.result.operations.filter(x=>x.is_setup).length,
   recovered:snapshot.result.optimization_account_check_recovered===true,
   completedEarly:snapshot.result.optimization_completed_early===true,
   reason:snapshot.result.optimization_termination_reason||null,
   actualGenerations:snapshot.result.total_generations??null,
   actualRuns:snapshot.result.optimization_run??null,
   duration:snapshot.result.duration_minutes}));


 // Full second optimization on the SAME large-model account. The real server
 // accepts the POST (HTTP 202), but the proxy appears to return HTML 502.
 // The browser must reconnect to the already-running account job; no duplicate.
 let maskedPosts=0, acceptedStart=null;
 await page.route("**/api/plan",async route=>{
  if(route.request().method()!=="POST")return route.continue();
  maskedPosts++;
  if(maskedPosts>1)return route.continue();
  const actual=await route.fetch({timeout:45000});
  let body=null;try{body=await actual.clone().json()}catch{}
  acceptedStart={status:actual.status(),accepted:body?.ok===true&&body?.started===true,
   joined:body?.joined===true,contentType:(actual.headers()["content-type"]||"").slice(0,70)};
  // Mask a genuine accepted 202 with HTML 502, or propagate a real 502 from
  // the upstream. Both must recover without displaying a validator error.
  if(actual.status()===202&&acceptedStart.accepted)
   return route.fulfill({status:502,contentType:"text/html",body:"<html><body>Bad Gateway</body></html>"});
  if(actual.status()>=500)
   return route.fulfill({response:actual});
  return route.fulfill({response:actual});
 });
 const beforeSecond=requests.length;
 const secondGate=await page.evaluate(()=>({
  text:document.getElementById("opt")?.textContent,
  disabled:document.getElementById("opt")?.disabled,
  transport:window.__PP_ASYNC_PLAN_TRANSPORT__===true
 }));
 if(!secondGate.transport||secondGate.disabled||!/continue|продолж/i.test(secondGate.text||""))
  throw Error("SECOND_GA_CONTINUE_GATE_"+JSON.stringify(secondGate));
 await page.locator("#opt").click({timeout:10000,noWaitAfter:true});
 await page.waitForFunction(()=>{
  const s=window.__PP_ASYNC_PLAN_TRANSPORT_STATUS__?.state;
  return s&&(s.recoveries>=1||s.retries>=1);
 },null,{timeout:45000});
 console.log("GA_START_HTML_502_LIVE_REJOIN",JSON.stringify({
  acceptedStart,maskedPosts,recovery:await page.evaluate(()=>window.__PP_ASYNC_PLAN_TRANSPORT_STATUS__?.state)
 }));
 await page.waitForFunction(()=>window.__PP_GA_PROGRESS_V4__?.state?.finalDone===true&&
  window.__PP_GA_PROGRESS_V4__?.state?.visible?.includes("100%"),null,{timeout:175000,polling:700});
 const secondResponse=await ctx.request.get(base+"/api/plan-progress",{timeout:30000});
 const second=await secondResponse.json();
 const secondUi=await page.evaluate(()=>({
  v4:window.__PP_GA_PROGRESS_V4__?.state,
  text:document.getElementById("opt")?.getAttribute("data-pp-ga-v4-label"),
  transport:window.__PP_ASYNC_PLAN_TRANSPORT_STATUS__?.state,
  validator:document.getElementById("validator")?.textContent?.slice(0,160)
 }));
 if(maskedPosts<1||maskedPosts>3||requests.length!==beforeSecond+maskedPosts||
    !(acceptedStart?.status===202||acceptedStart?.status>=500)||
    second.phase!=="completed"||second.success!==true||
    !Array.isArray(second.result?.operations)||second.result.operations.length<800||
    !secondUi.v4?.finalDone||!secondUi.text?.includes("100%")||
    !(secondUi.transport?.recoveries||secondUi.transport?.retries)||
    /ga_start_invalid_response/.test(secondUi.validator||""))
  throw Error("SECOND_GA_HTML_502_RECOVERY_NOT_VERIFIED_"+JSON.stringify({
   maskedPosts,requests:requests.length-beforeSecond,acceptedStart,secondPhase:second.phase,
   secondRows:second.result?.operations?.length,secondUi
  }));
 console.log("GA_START_502_HTML_ON_REAL_886_OP_CONTINUE_NO_DUPLICATE_PASS",JSON.stringify({
  maskedPosts,status:acceptedStart.status,rows:second.result.operations.length,
  secondRun:second.result.optimization_run,visible:secondUi.text,
  recoveries:secondUi.transport.recoveries,retries:secondUi.transport.retries
 }));

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
