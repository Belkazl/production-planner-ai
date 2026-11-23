const assert=require("node:assert/strict");
const fs=require("node:fs");
const {chromium}=require("playwright-core");
const file=process.argv[2];
if(!file)throw Error("FRESH_FIRST_BASELINE_TEST_SOURCE_REQUIRED");
const source=fs.readFileSync(file,"utf8");
const stop=source.indexOf("// Production optimization depth");
const opener='(function(){\n"use strict";\nif(window.__ppFreshOptimizerUiInstalled)return;';
if(stop<=0||!source.startsWith(opener))throw Error("FRESH_FIRST_TEST_MODULE_BOUNDARIES_DRIFT");
const isolated=source.slice(0,stop)+"\n})();";
for(const part of [
 'window.__ppFreshDisplayBaseline=null;',
 'pp:fresh-gantt-cleared',
 'return accepted||(lastReal?.partial===true?lastReal:null);',
 'window.__ppFreshReferencePlan=null;',
 'window.__ppFreshRestartPending=true;',
 'fetch("/api/optimizer-reset"',
]){
 assert(source.includes(part),"Missing new baseline guard "+part);
}
for(const forbidden of [
 'showFreshDisplayBaseline()',
 'function storedLastPlan()',
 'const previous=window.__ppOptimizerCommittedPlan||window.__ppTabPlan||window.__ppManualPlan'
]){
 assert(!source.includes(forbidden),"Old plan must never be shown after a fresh reset: "+forbidden);
}
(async()=>{
 const browser=await chromium.launch({headless:true,channel:"chrome",
    args:["--no-sandbox","--disable-dev-shm-usage"]});
 try{
  const page=await browser.newPage();
  const html='<!doctype html><html lang="en"><body>'+
   '<main id="planView"><div id="ganttScroll"><div id="ppGanttToolV2">'+
   '<div class="pg2-row"><div class="pg2-bar">OLD PLAN</div></div></div></div>'+
   '<div id="meta">OLD</div><div id="valid">OLD</div><div id="validator">OLD</div>'+
   '<div id="dur">4300</div><div id="cycles">22</div><div id="waitKpi">500</div><div id="idleKpi">600</div>'+
   '<div id="durDelta">+7%</div><div id="cyclesDelta">+6%</div>'+
   '<div id="waitDelta">+5%</div><div id="idleDelta">+3%</div>'+
   '<button id="opt">Continue optimization</button></main></body></html>';
  // A real HTTPS origin is needed for localStorage; route every request in
  // memory so this unit test never touches the live LiftOrbit server.
  await page.route("https://unit.liftorbit.test/**",route=>
    route.fulfill({status:200,contentType:"text/html",body:html}));
  await page.goto("https://unit.liftorbit.test/",{waitUntil:"domcontentloaded"});
  await page.evaluate(()=>{
   const p={id:"TEST-PROJECT",revision:4,model:{
    orders:[{id:"O1",quantity:10}],equipment:[{id:"E1"}],
    materials:[{id:"M1",stock:30}]},
    lastPlan:{valid:true,operations:[{order:"O1"}],duration_minutes:4300}};
   const snapshots={savedPlans:'[{"id":"saved-A","duration_minutes":123}]',
    active:p.id,project:JSON.stringify([p])};
   localStorage.setItem("prodplan.project.active.v2",snapshots.active);
   localStorage.setItem("prodplan.projects.v2",snapshots.project);
   localStorage.setItem("prodplan.saved.plans.v2",snapshots.savedPlans);
   localStorage.setItem("pp.kpi.first-best.v1."+p.id,JSON.stringify({
    projectId:p.id,revision:4,metrics:{duration:4300,cycles:22,wait:500,idle:600},compare:true
   }));
   window.__qa={snapshots,clicked:false,resetCalls:0,clearCalls:0,repaint:0,cleared:null,
     originalPlan:p.lastPlan,firstPlan:{valid:true,operations:[{order:"O1",start_min:0,end_min:55}],
      duration_minutes:1000,batch_count:2,operator_wait_minutes:20,machine_idle_minutes:30}};
   window.__PP_STOP_DEBUG__=()=>({running:false,reconnecting:false});
   window.model=p.model;
   window.modelReady=true;window.hasResult=true;window.busy=false;
   window.model_ready=()=>true;
   window.__ppOptimizerCommittedPlan=p.lastPlan;
   window.__ppTabPlan=p.lastPlan;
   window.__PP_LANGUAGE__={current:"en"};
   window.clearPlan=function(){
    window.__qa.clearCalls++;
    document.getElementById("ppGanttToolV2").replaceChildren();
    for(const id of ["dur","cycles","waitKpi","idleKpi"])
      document.getElementById(id).textContent="—";
   };
   window.renderPlan=function(plan){
    window.__qa.repaint++;
    const el=document.createElement("div");el.className="pg2-bar";
    el.textContent=String(plan?.duration_minutes);
    document.getElementById("ppGanttToolV2").appendChild(el);
   };
   window.fetch=async(url,init)=>{
    if(url!=="/api/optimizer-reset"||init?.method!=="POST")
      throw Error("Unexpected network request: "+String(url));
    window.__qa.resetCalls++;
    return {ok:true,json:async()=>({ok:true})};
   };
   document.getElementById("opt").onclick=async()=>{
    const q=window.__qa;
    q.clicked=true;
    q.beforeStart={
      bars:document.querySelectorAll("#ppGanttToolV2 .pg2-bar").length,
      oldBaseline:window.__ppFreshDisplayBaseline,
      reference:window.__ppFreshReferencePlan,
      committed:window.__ppOptimizerCommittedPlan,
      tab:window.__ppTabPlan,
      pending:window.__ppFreshRestartPending,
      mode:window.__ppFreshRestartMode
    };
    window.__ppOptimizerCommittedPlan=q.firstPlan;
   };
   window.addEventListener("pp:fresh-gantt-cleared",()=>{
    window.__qa.cleared={
      bars:document.querySelectorAll("#ppGanttToolV2 .pg2-bar").length,
      project:localStorage.getItem("prodplan.projects.v2"),
      saved:localStorage.getItem("prodplan.saved.plans.v2"),
      priorBaseline:window.__ppFreshDisplayBaseline
    };
   });
  });
  await page.addScriptTag({content:isolated});
  await page.locator("#ppOptimizerStartOver").click();
  await page.waitForFunction(()=>window.__qa.clicked===true &&
   window.__ppFreshReferencePlan===window.__qa.firstPlan,null,{timeout:7000});
  const state=await page.evaluate(()=>({
    qa:window.__qa,
    newReference:window.__ppFreshReferencePlan===window.__qa.firstPlan,
    oldReference:window.__ppFreshReferencePlan===window.__qa.originalPlan,
    priorPlanCleared:window.__ppFreshDisplayBaseline===null,
    saved:localStorage.getItem("prodplan.saved.plans.v2"),
    project:localStorage.getItem("prodplan.projects.v2"),
    numResetButtons:document.querySelectorAll("#ppOptimizerStartOver").length
  }));
  assert.equal(state.qa.resetCalls,1,"Exactly one server reset");
  assert.equal(state.qa.clearCalls,1,"Gantt cleared exactly once");
  assert.equal(state.qa.repaint,0,"Old plan must NOT be repainted as a temporary baseline");
  assert.equal(state.qa.cleared.bars,0,"Gantt must be empty before the new optimization");
  assert.equal(state.qa.beforeStart.bars,0);
  assert.equal(state.qa.beforeStart.oldBaseline,null);
  assert.equal(state.qa.beforeStart.reference,null);
  assert.equal(state.qa.beforeStart.committed,null);
  assert.equal(state.qa.beforeStart.tab,null);
  assert.equal(state.qa.beforeStart.mode,true);
  assert.equal(state.qa.beforeStart.pending,true);
  assert.equal(state.newReference,true,"First completed new plan is comparison reference");
  assert.equal(state.oldReference,false);
  assert.equal(state.priorPlanCleared,true);
  assert.equal(state.qa.cleared.project,state.qa.snapshots.project,
    "Orders, machines, stock, project revisions and existing current data untouched");
  assert.equal(state.qa.cleared.saved,state.qa.snapshots.savedPlans,
    "Saved plans must remain untouched");
  assert.equal(state.project,state.qa.snapshots.project);
  assert.equal(state.saved,state.qa.snapshots.savedPlans);
  assert.equal(state.numResetButtons,1,"Reuse Start optimization again, no additional reset button");
  console.log("FRESH_FIRST_OPTIMIZATION_BLANK_GANTT_NO_PREVIOUS_PLAN_REFERENCE_TEST_PASS",
    JSON.stringify({serverResets:state.qa.resetCalls,clearCalls:state.qa.clearCalls,
      savedUntouched:true,modelUntouched:true,firstResultAsReference:state.newReference}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
