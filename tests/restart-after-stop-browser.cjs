const assert=require("node:assert/strict");
const fs=require("node:fs");
const {chromium}=require("playwright");

// Regression: user stops a still-pending GA, selects the best candidate,
// then must be able to start a NEW GA baseline without waiting for the
// cancelled upstream /api/plan response.
(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 let releaseOldRequest=null;
 try{
  const context=await browser.newContext({viewport:{width:1600,height:900}});
  // Legacy functional checks intentionally exercise the Russian language option.
  await context.addInitScript(()=>{try{localStorage.setItem('prodplan.ui.language.v1','ru')}catch(_){}});
  await context.addCookies([{name:"pp_demo_auth",value:"tenantA",url:"http://127.0.0.1:8080",httpOnly:true}]);
  const page=await context.newPage();
  const errors=[],planRequests=[];
  page.on("pageerror",e=>errors.push(String(e)));
  const op={operation_id:"qa-stopped-1",order:2601,operation_name:"Обжиг",
   start_min:0,end_min:60,duration_min:60,batch:1,equipment_ids:["E9"],employee_ids:[]};
  const candidate={ok:true,valid:true,partial:false,duration_minutes:4402,
   operator_wait_minutes:100,machine_idle_minutes:40,batch_count:65,
   operations:[op],generic_operations:[op],start:"2026-10-05T08:00:00Z",objective:"duration"};
  const newBaseline={...candidate,duration_minutes:4510,optimization_run:1,
   total_generations:120,generations:120,completed:true,success:true};
  let signalFirst;
  const firstSeen=new Promise(resolve=>signalFirst=resolve);
  await page.route("**/api/plan-progress?*",route=>route.fulfill({
   status:200,contentType:"application/json",
   body:JSON.stringify({ok:true,running:true,done:32,total:120,phase:"GA",
    candidate_preview:candidate,best_preview:candidate})
  }));
  await page.route("**/api/optimizer-stop",route=>route.fulfill({
   status:200,contentType:"application/json",
   body:JSON.stringify({ok:true,stopped:true,objective:"duration",
    best_preview:candidate,variants:[{plan:candidate}]})
  }));
  await page.route("**/api/plan",async route=>{
   const payload=JSON.parse(route.request().postData()||"{}");
   planRequests.push(payload);
   if(planRequests.length===1){
    signalFirst();
    await new Promise(resolve=>{releaseOldRequest=resolve});
    // If the client aborts, fulfilling after cancellation may fail; expected.
    try{await route.fulfill({status:200,contentType:"application/json",
     body:JSON.stringify({...candidate,duration_minutes:4390,success:true})})}catch(_){}
   }else{
    await route.fulfill({status:200,contentType:"application/json",
     body:JSON.stringify(newBaseline)});
   }
  });
  const opened=await page.goto("http://127.0.0.1:8080/",{waitUntil:"domcontentloaded",timeout:30000});
  assert.equal(opened.status(),200);
  const modelFixture=JSON.parse(fs.readFileSync("/tmp/pp-ceramics-live-model.json","utf8")).model;
  await page.evaluate(data=>{
   const previous={id:"qa-stopped-restart",revision:7,name:"Керамика",
    lastPlan:{valid:true,duration_minutes:4509,operator_wait_minutes:200,
     machine_idle_minutes:40,batch_count:65,
     operations:[{operation_id:"old",order:2601,operation_name:"Обжиг",start_min:0,end_min:90,equipment_ids:["E9"]}]},
    savedPlans:[{id:"saved_qa",plan:{duration_minutes:4509}}]};
   localStorage.setItem("prodplan.project.active.v2",previous.id);
   localStorage.setItem("prodplan.projects.v2",JSON.stringify([previous]));
   document.body.classList.remove("projects-mode");
   document.getElementById("planView").style.display="block";
   document.getElementById("sectionView").style.display="none";
   model=data;modelReady=true;hasResult=true;
   window.__ppOptimizerCommittedPlan=previous.lastPlan;
   window.__ppTabPlan=previous.lastPlan;
   const opt=document.getElementById("opt");
   opt.disabled=false;
   opt.textContent="Продолжить оптимизацию";
  },modelFixture);
  await page.locator("#ppOptimizerStartOver").waitFor({state:"visible",timeout:12000});
  await page.locator("#opt").click();
  await Promise.race([firstSeen,new Promise((_,reject)=>setTimeout(()=>reject(Error("first GA did not start")),18000))]);
  await page.waitForFunction(()=>window.__PP_STOP_DEBUG__?.().running===true,{timeout:8000});
  await page.locator("#ppStopOptimizer").waitFor({state:"visible",timeout:7000});
  await page.waitForFunction(()=>document.getElementById("ppStopOptimizer")?.disabled===false,null,{timeout:10000});
  assert.equal(await page.locator("#ppOptimizerStartOver").isDisabled(),true,
   "new search must be locked while optimizer actually runs");
  await page.locator("#ppStopOptimizer").click();
  await page.locator("#ppStopModal.pp-open .pp-actions button").first().click({timeout:9000});
  await page.waitForFunction(()=>document.getElementById("valid")?.textContent.includes("план выбран"),null,{timeout:7000});
  const stopped=await page.evaluate(()=>{
   const debug=window.__PP_STOP_DEBUG__?.();
   const fresh=window.__PP_FRESH_OPTIMIZER_DEBUG__?.();
   return {stopped:debug?.stopped,running:debug?.running,
    candidates:debug?.variants,stoppedPlanAvailable:debug?.stoppedPlanAvailable,
    freshDisabled:document.getElementById("ppOptimizerStartOver")?.disabled,
    optDisabled:document.getElementById("opt")?.disabled,
    label:document.getElementById("opt")?.textContent?.trim(),
    selected:window.__ppOptimizerCommittedPlan?.duration_minutes,
    savedPlans:JSON.parse(localStorage.getItem("prodplan.projects.v2")||"[]")[0]?.savedPlans?.length,
    freshDebug:fresh};
  });
  console.log("STOPPED_GA_BUTTON_STATE",JSON.stringify(stopped));
  assert.equal(stopped.stopped,true,"must have server-confirmed stop");
  assert.equal(stopped.running,false,"stopped optimizer must release running state before old HTTP resolves");
  assert.equal(stopped.freshDisabled,false,"Start over must unlock immediately after confirmed stop");
  assert.equal(stopped.optDisabled,false,"Continue must remain clickable");
  assert.equal(stopped.label,"Продолжить оптимизацию","continued plan must be selectable");
  assert.equal(stopped.selected,4402,"stopped candidate must be displayed on Gantt");
  assert.equal(stopped.savedPlans,1,"saved plans must remain untouched");
  await page.screenshot({path:"restart-unlocked-after-stop.png",fullPage:false});

  // Do not release the old optimization request yet: an unresponsive upstream
  // must not trap fresh start behind stale frontend state.
  await page.locator("#ppOptimizerStartOver").click();
  await page.waitForFunction(()=>window.__PP_FRESH_OPTIMIZER_DEBUG__?.().freshMode===true,null,{timeout:10000});
  await page.waitForFunction(()=>document.getElementById("dur")?.textContent==="4510",null,{timeout:18000});
  assert.equal(planRequests.length,2,"new optimization POST must be made after stop");
  assert.equal(planRequests[1].continue,false,"fresh run must not inherit stopped candidate");
  assert.equal(planRequests[1].generations,60,"bounded GA budget must remain intact");
  const finished=await page.evaluate(()=>({
   duration:document.getElementById("dur")?.textContent,
   fresh:window.__PP_FRESH_OPTIMIZER_DEBUG__?.(),
   savedPlans:JSON.parse(localStorage.getItem("prodplan.projects.v2")||"[]")[0]?.savedPlans?.length,
   stop:window.__PP_STOP_DEBUG__?.()
  }));
  assert.equal(finished.duration,"4510");
  assert.equal(finished.savedPlans,1,"new baseline must not erase saved plans");
  assert.equal(finished.fresh.pending,false);
  assert.equal(finished.fresh.referenceDuration,4510);
  console.log("RESTART_AFTER_STOP_BROWSER_PASS",JSON.stringify({
   firstPendingUntilAfterRestart:true,stopReleasedRunning:true,buttonUnlocked:true,
   selectedStopPlan:4402,newBaseline:4510,requests:planRequests.length,
   savedPlansPreserved:finished.savedPlans,browserErrors:errors.length
  }));
  assert.deepEqual(errors,[],"uncaught browser errors");
 }finally{
  if(releaseOldRequest)releaseOldRequest();
  await browser.close();
 }
})().catch(e=>{console.error(e);process.exit(1)});
