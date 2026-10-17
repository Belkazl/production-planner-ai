const fs=require("node:fs");
const assert=require("node:assert/strict");
const {JSDOM}=require("jsdom");
const script=fs.readFileSync("restart-optimizer-ui.js","utf8");
const html='<!doctype html><html><body><div id="planView"><div class="toolbar"><button id="opt">Продолжить оптимизацию</button><button id="ppStopOptimizer">Остановить оптимизацию</button><span id="valid">GA: остановлено</span><span id="meta">GA · всего 32640 поколений · запуск 141</span></div><div id="ganttContent">СТАРЫЙ ГАНТ</div><div id="ganttEmpty" style="display:none">Пусто</div><div id="validator">Новый вариант не применён: ухудшена длительность</div><div id="dur">2539</div><div id="cycles">65</div><div id="waitKpi">76231 мин</div><div id="idleKpi">8930 мин</div><div id="durDelta">0 мин</div><div id="cyclesDelta">0 цикла</div><div id="waitDelta">0 мин</div><div id="idleDelta">0 мин</div><div id="ppOptimizerCandidateStatus">старый вариант</div></div></body></html>';
const oldPlan={valid:true,partial:false,duration_minutes:2539,operations:[{id:1}]};
const newPlan={valid:true,partial:false,duration_minutes:4600,operations:[{id:2}]};
async function tick(){return new Promise(r=>setTimeout(r,0))}
async function scenario(reject=false){
 const dom=new JSDOM(html,{runScripts:"dangerously",url:"https://production-planner-gateway-v2-production.up.railway.app",pretendToBeVisual:true});
 const w=dom.window,doc=w.document;
 w.Response=Response;
 w.__ppStopUiLocked=true;
 w.__ppOptimizationInFlight=false;
 w.__ppOptimizerCommittedPlan=oldPlan;
 w.__ppTabPlan=oldPlan;
 w.__ppKpiBaselinePlan=oldPlan;
 w.hasResult=true;w.previousKpiMetrics={duration:2539};
 const previousStorage=JSON.stringify([{id:"prj-ceramic",name:"Керамика",lastPlan:oldPlan,savedPlans:[oldPlan]}]);
 w.localStorage.setItem("prodplan.projects.v2",previousStorage);
 w.localStorage.setItem("prodplan.project.active.v2","prj-ceramic");
 let resCalls=0,planCalls=0;
 w.__PP_STOP_DEBUG__=()=>({running:false});
 w.clearPlan=()=>{
  doc.getElementById("ganttContent").textContent="";
  doc.getElementById("ganttEmpty").style.display="block";
 };
 w.fetch=async(path,options)=>{
  if(!String(path).includes("/api/optimizer-reset"))throw Error("unexpected request");
  resCalls++;
  assert.equal(options.method,"POST");
  return reject?new Response(JSON.stringify({ok:false,error:"optimization_running_stop_first"}),{status:409,headers:{"content-type":"application/json"}})
  :new Response(JSON.stringify({ok:true,reset:true,total_generations:0,run:0}),{status:200,headers:{"content-type":"application/json"}});
 };
 const button=doc.getElementById("opt");
 button.onclick=async()=>{
  planCalls++;
  assert.equal(w.__ppFreshRestartPending,true);
  assert.equal(w.__ppOptimizerCommittedPlan,null);
  assert.equal(w.__ppTabPlan,null);
  assert.equal(w.__ppKpiBaselinePlan,null);
  assert.equal(w.hasResult,false);
  assert.equal(doc.getElementById("dur").textContent,"—");
  assert.equal(doc.getElementById("cycles").textContent,"—");
  assert.equal(doc.getElementById("waitKpi").textContent,"—");
  assert.equal(doc.getElementById("idleKpi").textContent,"—");
  assert(doc.getElementById("meta").textContent.includes("0 поколений"));
  assert(doc.getElementById("valid").textContent.includes("0/240"));
  assert.equal(w.localStorage.getItem("prodplan.projects.v2"),previousStorage);
  await tick();
  w.__ppOptimizerCommittedPlan=newPlan;
  w.__ppTabPlan=newPlan;
  w.hasResult=true;
  // Mirrors ppStartOverHtml's patched projectAfterPlan success branch.
  w.__ppFreshReferencePlan=newPlan;
  return {ok:true};
 };
 w.eval(script);
 const fresh=doc.getElementById("ppOptimizerStartOver");
 assert(fresh,"Fresh-start button must mount");
 assert.equal(fresh.textContent,"Начать оптимизацию заново");
 await fresh.onclick();
 await tick();
 assert.equal(resCalls,1);
 if(reject){
  assert.equal(planCalls,0,"409 must not clear plan or start optimizer");
  assert.equal(doc.getElementById("dur").textContent,"2539");
  assert.equal(w.__ppOptimizerCommittedPlan,oldPlan);
  assert.equal(doc.getElementById("meta").textContent.includes("32640"),true);
  assert(doc.getElementById("validator").textContent.includes("Не удалось начать заново"));
 }else{
  assert.equal(planCalls,1,"reset should trigger first real optimizer pass");
  assert.equal(w.__ppFreshRestartPending,false);
  assert.equal(w.__ppFreshReferencePlan,newPlan);
  assert.equal(w.__ppFreshRestartMode,true);
  assert.equal(w.__ppFreshRestartProject,"prj-ceramic");
  assert.equal(w.localStorage.getItem("prodplan.projects.v2"),previousStorage,"saved plans must not be deleted by reset");
 }
 w.close();
 return {reject,resCalls,planCalls};
}
(async()=>{
 const results=[await scenario(false),await scenario(true)];
 console.log("PP_FRESH_START_UI_PASS",JSON.stringify({
 button:"Начать оптимизацию заново",resetKpis:true,
 resetValidator:true,resetMeta:true,resetGA:true,
 firstPassNewBaseline:4600,priorBestUninherited:2539,
 savedPlansPreserved:true,initialResetErrorSafe:true,scenarios:results
 }));
})().catch(e=>{console.error(e);process.exitCode=1});
