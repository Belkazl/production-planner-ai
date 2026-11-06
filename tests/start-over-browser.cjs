const assert=require("node:assert/strict");
const fs=require("node:fs");
const {chromium}=require("playwright");
(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const context=await browser.newContext({viewport:{width:1600,height:1000}});
  await context.addCookies([{name:"pp_demo_auth",value:"tenantA",url:"http://127.0.0.1:8080",httpOnly:true}]);
  const page=await context.newPage();
  const pageErrors=[],requests=[],durations=[4600,4320];
  page.on("pageerror",e=>pageErrors.push(String(e)));
  let releaseFirst=null,seenFirst=null;const seen=new Promise(r=>seenFirst=r);
  const modelFixture=JSON.parse(fs.readFileSync("/tmp/pp-ceramics-live-model.json","utf8")).model;
  await page.route("**/api/plan",async route=>{
   const data=JSON.parse(route.request().postData()||"{}");
   requests.push(data);
   if(requests.length===1){seenFirst();await new Promise(r=>{releaseFirst=r})}
   const nth=requests.length-1,score=durations[nth]??4250;
   const op={operation_id:"qa-"+nth,order:2601,operation_name:"Обжиг",start_min:0,end_min:60,duration_min:60,batch:1,equipment_ids:["E9"],employee_ids:[]};
   const reply={ok:true,valid:true,success:true,partial:false,
    duration_minutes:score,batch_count:65,operator_wait_minutes:100,machine_idle_minutes:40,
    operations:[op],generic_operations:[op],start:"2026-10-05T08:00:00Z",
    optimization_run:nth+1,total_generations:240*(nth+1),generations:240,
    completed:true,objective:"duration"
   };
   await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(reply)});
  });
  const pageResponse=await page.goto("http://127.0.0.1:8080/",{waitUntil:"domcontentloaded",timeout:30000});
  assert.equal(pageResponse.status(),200);
  await page.locator("#ppOptimizerStartOver").waitFor({state:"attached",timeout:12000});
  assert.equal(await page.locator("#ppOptimizerStartOver").innerText(),"Начать оптимизацию заново");
  await page.evaluate(givenModel=>{
   window.__qaOldStored={id:"prj-ceramic-qa",revision:55,name:"Керамика",lastPlan:{
    valid:true,duration_minutes:2539,batch_count:65,operator_wait_minutes:76231,machine_idle_minutes:8930,
    operations:[{operation_id:"old",order:2601,operation_name:"Обжиг",equipment_ids:["E9"],start_min:0,end_min:80}]
   },savedPlans:[{id:"saved_1",plan:{duration_minutes:2539}}]};
   localStorage.setItem("prodplan.project.active.v2","prj-ceramic-qa");
   localStorage.setItem("prodplan.projects.v2",JSON.stringify([window.__qaOldStored]));
   document.body.classList.remove("projects-mode");
   document.getElementById("planView").style.display="block";
   document.getElementById("sectionView").style.display="none";
   model=givenModel;
   modelReady=true;
   hasResult=true;
   window.__ppOptimizerCommittedPlan=window.__qaOldStored.lastPlan;
   window.__ppTabPlan=window.__qaOldStored.lastPlan;
   document.getElementById("opt").disabled=false;
   document.getElementById("opt").textContent="Продолжить оптимизацию";
   document.getElementById("dur").textContent="2539";
   document.getElementById("cycles").textContent="65";
   document.getElementById("waitKpi").textContent="76231 мин";
   document.getElementById("idleKpi").textContent="8930 мин";
   document.getElementById("meta").textContent="GA · всего 32640 поколений · запуск 141";
   document.getElementById("validator").textContent="Новый вариант не применён: ухудшена длительность";
  },modelFixture);
  await page.locator("#ppOptimizerStartOver").waitFor({state:"visible",timeout:8000});
  await page.locator("#ppOptimizerStartOver").click();
  await Promise.race([seen,new Promise((_,reject)=>setTimeout(()=>reject(Error("new optimizer never started")),16000))]);
  assert.equal(requests.length,1);
  assert.equal(requests[0].continue,false,"first pass must NOT continue the old 2539 plan");
  const intermediate=await page.evaluate(()=>({
    duration:document.getElementById("dur").textContent,
    cycles:document.getElementById("cycles").textContent,
    validator:document.getElementById("validator").textContent,
    meta:document.getElementById("meta").textContent,
    fresh:window.__PP_FRESH_OPTIMIZER_DEBUG__?.(),
    projects:JSON.parse(localStorage.getItem("prodplan.projects.v2")||"[]")
  }));
  assert.equal(intermediate.duration,"—","old KPI 2539 should be cleared");
  assert.equal(intermediate.cycles,"—","old 65 cycles should be cleared");
  assert(!intermediate.meta.includes("32640"),"old GA generation count visible");
  assert(!intermediate.validator.includes("ухудшена"),"old validation message visible");
  assert.equal(intermediate.fresh.pending,true,"fresh first-run comparison guard must be active");
  assert.equal(intermediate.projects[0].savedPlans.length,1,"saved plans must remain untouched");
  await page.screenshot({path:"start-over-reset-state.png"});
  releaseFirst();
  await page.waitForFunction(()=>document.getElementById("dur").textContent==="4600",null,{timeout:20000});
  await page.waitForFunction(()=>window.__PP_FRESH_OPTIMIZER_DEBUG__?.().pending===false,null,{timeout:5000});
  const afterFirst=await page.evaluate(()=>({
   duration:document.getElementById("dur").textContent,
   meta:document.getElementById("meta").textContent,
   validator:document.getElementById("validator").textContent,
   reference:window.__PP_FRESH_OPTIMIZER_DEBUG__(),
   oldStored:JSON.parse(localStorage.getItem("prodplan.projects.v2")||"[]")[0]
  }));
  assert.equal(afterFirst.duration,"4600","worse than 2539 must still become NEW first-pass baseline");
  assert.equal(afterFirst.reference.referenceDuration,4600);
  assert(!afterFirst.meta.includes("32640"),"generation counter must be current epoch");
  assert.equal(afterFirst.oldStored.savedPlans.length,1);
  await page.screenshot({path:"start-over-first-new-baseline.png"});
  await page.locator("#opt").click();
  await page.waitForFunction(()=>document.getElementById("dur").textContent==="4320",null,{timeout:20000});
  assert.equal(requests.length,2);
  assert.equal(requests[1].continue,true,"second pass should improve new baseline");
  await page.screenshot({path:"start-over-second-improved.png"});
  assert.equal(pageErrors.length,0,"browser errors: "+pageErrors.join(" ; "));
  console.log("FRESH_OPTIMIZER_BROWSER_E2E_PASS",JSON.stringify({
   firstPassContinue:requests[0].continue,firstBaseline:4600,oldBest:2539,
   secondPassContinue:requests[1].continue,secondBetter:4320,
   oldKpiCleared:true,oldValidatorCleared:true,oldGenerationsCleared:true,
   savedPlansKept:afterFirst.oldStored.savedPlans.length,browserErrors:0
  }));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
