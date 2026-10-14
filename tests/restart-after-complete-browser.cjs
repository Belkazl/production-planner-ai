const assert=require("node:assert/strict");
const fs=require("node:fs");
const {chromium}=require("playwright");

// Exercise the actual authenticated planner and the original GA click chain.
// Regression for the real screenshot: "GA: план валиден", Continue is active,
// but Start again was grey because __ppOptimizationInFlight was stale.
(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const context=await browser.newContext({viewport:{width:1780,height:970}});
  // Legacy functional checks intentionally exercise the Russian language option.
  await context.addInitScript(()=>{try{localStorage.setItem('prodplan.ui.language.v1','ru')}catch(_){}});
  await context.addCookies([{name:"pp_demo_auth",value:"tenantA",url:"http://127.0.0.1:8080",httpOnly:true}]);
  const page=await context.newPage();
  const errors=[],requests=[];
  page.on("pageerror",e=>errors.push(String(e)));
  const modelFixture=JSON.parse(fs.readFileSync("/tmp/pp-ceramics-live-model.json","utf8")).model;
  const makePlan=(score,run)=>({
   ok:true,valid:true,success:true,completed:true,partial:false,
   duration_minutes:score,batch_count:65,operator_wait_minutes:110,
   machine_idle_minutes:28,optimization_run:run,total_generations:120*run,
   generations:120,objective:"duration",start:"2026-10-05T08:00:00Z",
   operations:[{operation_id:"completed-ga-"+run,order:2601,
    operation_name:"Обжиг",start_min:0,end_min:60,duration_min:60,batch:1,
    equipment_ids:["E9"],employee_ids:[]}],
   generic_operations:[{operation_id:"completed-ga-"+run,order:2601,
    operation_name:"Обжиг",start_min:0,end_min:60,duration_min:60,batch:1,
    equipment_ids:["E9"],employee_ids:[]}]
  });
  await page.route("**/api/plan",async route=>{
   const body=JSON.parse(route.request().postData()||"{}");
   requests.push(body);
   await new Promise(resolve=>setTimeout(resolve,250));
   await route.fulfill({status:200,contentType:"application/json",
    body:JSON.stringify(makePlan(requests.length===1?4402:4510,requests.length))});
  });
  await page.route("**/api/plan-progress?*",route=>route.fulfill({
   status:200,contentType:"application/json",
   body:JSON.stringify({ok:true,running:false,success:false,done:0,total:120,percent:0})
  }));
  const opened=await page.goto("http://127.0.0.1:8080/",{waitUntil:"domcontentloaded",timeout:30000});
  assert.equal(opened.status(),200);
  await page.locator("#ppOptimizerStartOver").waitFor({state:"attached",timeout:12000});
  await page.evaluate(givenModel=>{
   const previous={id:"qa-completed-restart",revision:7,name:"Керамика",
    lastPlan:{valid:true,duration_minutes:4509,batch_count:65,
     operator_wait_minutes:400,machine_idle_minutes:50,
     operations:[{operation_id:"old",order:2601,operation_name:"Обжиг",
      start_min:0,end_min:90,equipment_ids:["E9"]}]},
    savedPlans:[{id:"saved_qa",plan:{duration_minutes:4509}}]};
   localStorage.setItem("prodplan.project.active.v2",previous.id);
   localStorage.setItem("prodplan.projects.v2",JSON.stringify([previous]));
   document.body.classList.remove("projects-mode");
   document.getElementById("planView").style.display="block";
   document.getElementById("sectionView").style.display="none";
   model=givenModel;modelReady=true;hasResult=true;
   window.__ppOptimizerCommittedPlan=previous.lastPlan;
   window.__ppTabPlan=previous.lastPlan;
   document.getElementById("opt").disabled=false;
   document.getElementById("opt").textContent="Продолжить оптимизацию";
  },modelFixture);
  await page.locator("#ppOptimizerStartOver").waitFor({state:"visible",timeout:10000});
  assert.equal(await page.locator("#ppOptimizerStartOver").isDisabled(),false,
   "restart must be available when no GA is running");
  await page.locator("#opt").click();
  await page.waitForFunction(()=>window.__PP_STOP_DEBUG__?.().running===true,null,{timeout:7000});
  assert.equal(await page.locator("#ppOptimizerStartOver").isDisabled(),true,
   "restart must be locked during an active GA pass");
  await page.waitForFunction(()=>window.__PP_STOP_DEBUG__?.().running===false &&
    document.getElementById("dur")?.textContent==="4402",null,{timeout:18000});
  assert.equal(await page.locator("#opt").isDisabled(),false,
   "regular optimizer must return to ready state");
  // Stale bookkeeping flags and unrelated primary-button states are not proof
  // that an optimization is currently running.
  await page.evaluate(()=>{window.__ppOptimizationInFlight=true;
   const opt=document.getElementById("opt");
   opt.disabled=true;
  });
  await page.waitForTimeout(100);
  const stale=await page.evaluate(()=>({
   ga:document.getElementById("valid")?.textContent,
   running:window.__PP_STOP_DEBUG__?.().running,
   staleInFlight:window.__ppOptimizationInFlight,
   primaryDisabled:document.getElementById("opt").disabled,
   freshDisabled:document.getElementById("ppOptimizerStartOver").disabled
  }));
  assert.equal(stale.running,false);
  assert.equal(stale.staleInFlight,true);
  assert.equal(stale.primaryDisabled,true);
  assert.equal(stale.freshDisabled,false,
   "restart must stay active despite stale flags or primary button disabled");
  await page.evaluate(()=>{document.getElementById("opt").disabled=false});
  await page.waitForTimeout(100);
  assert.equal(await page.locator("#ppOptimizerStartOver").isDisabled(),false);
  await page.screenshot({path:"restart-enabled-after-normal-completion.png"});

  await page.locator("#ppOptimizerStartOver").click();
  await page.waitForFunction(()=>window.__PP_FRESH_OPTIMIZER_DEBUG__?.().freshMode===true,null,{timeout:8000});
  await page.waitForFunction(()=>document.getElementById("dur")?.textContent==="4510",null,{timeout:18000});
  await page.waitForFunction(()=>window.__PP_FRESH_OPTIMIZER_DEBUG__?.().pending===false,null,{timeout:5000});
  assert.equal(requests.length,2,"normal completion must permit immediate fresh baseline");
  assert.equal(requests[0].continue,true);
  assert.equal(requests[1].continue,false,"restart must not continue previous plan");
  assert.equal(requests[1].generations,60,"the GA timeout mitigation must stay intact");
  const after=await page.evaluate(()=>({
   running:window.__PP_STOP_DEBUG__?.().running,
   freshDisabled:document.getElementById("ppOptimizerStartOver").disabled,
   duration:document.getElementById("dur")?.textContent,
   baseline:window.__PP_FRESH_OPTIMIZER_DEBUG__?.().referenceDuration,
   savedPlans:JSON.parse(localStorage.getItem("prodplan.projects.v2")||"[]")[0]?.savedPlans?.length
  }));
  assert.equal(after.duration,"4510");
  assert.equal(after.running,false);
  assert.equal(after.freshDisabled,false,"restart must be ready after its own successful GA run");
  assert.equal(after.baseline,4510);
  assert.equal(after.savedPlans,1);
  assert.deepEqual(errors,[],"page errors after completed GA and restart");
  console.log("RESTART_AFTER_NORMAL_COMPLETE_BROWSER_PASS",JSON.stringify({
   runningDuringFirst:true,unlockedAfterNormalFinish:true,
   staleInFlightIgnored:stale.staleInFlight,
   disabledPrimaryIgnored:stale.primaryDisabled,
   freshBaseline:after.duration,newBaselineReference:after.baseline,
   afterFreshStillUnlocked:!after.freshDisabled,
   savedPlansPreserved:after.savedPlans,apiRequests:requests.length,browserErrors:errors.length
  }));
 }finally{await browser.close()}
})().catch(err=>{console.error(err);process.exit(1)});
