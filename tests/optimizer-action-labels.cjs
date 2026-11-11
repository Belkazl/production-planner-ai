const fs=require("node:fs");
const assert=require("node:assert/strict");
const {JSDOM}=require("jsdom");
const source=fs.readFileSync("stop-ui.js","utf8");
const goodPlan=(duration,order=2601)=>({valid:true,partial:false,duration_minutes:duration,operator_wait_minutes:7,machine_idle_minutes:10,batch_count:3,operations:[{order,resource:"oven",start:0,end:duration}]});
async function delay(ms){return new Promise(r=>setTimeout(r,ms))}
async function scenario({previous=false,chooseBest=true}={}){
 const dom=new JSDOM('<!doctype html><html><head></head><body><button id="opt" type="button">Запустить оптимизацию</button><span id="valid">GA: модель готова</span><div id="validator"></div><div id="ppOptimizerCandidateStatus"></div></body></html>',{url:"https://planner.test/",pretendToBeVisual:true,runScripts:"dangerously"});
 const w=dom.window,doc=w.document,btn=doc.getElementById("opt");
 w.Response=Response;w.AbortController=AbortController;
 let resolveRun,runCount=0,restoreCalls=[],kpiCalls=[];
 const prior=previous?goodPlan(120,2602):null;
 w.__ppOptimizerCommittedPlan=prior;
 w.__ppTabPlan=prior;
 w.renderPlan=p=>restoreCalls.push(p);
 w.renderKpisWithDelta=p=>kpiCalls.push(p);
 const best=goodPlan(100);
 w.fetch=async function(input,options={}){
  const url=typeof input==="string"?input:input.url;
  if(url.includes("/api/optimizer-stop"))return new Response(JSON.stringify({ok:true,stopped:true,best_preview:best,variants:[{plan:best}]}),{status:200,headers:{"content-type":"application/json"}});
  if(url.includes("/api/plan-progress"))return new Response(JSON.stringify({ok:true,running:true,best_preview:best,candidate_preview:best}),{status:200,headers:{"content-type":"application/json"}});
  throw Error("Unexpected endpoint "+url);
 };
 btn.onclick=function(){
  runCount++;
  btn.disabled=true;
  return new Promise(resolve=>{resolveRun=()=>{btn.textContent="Оптимизация остановлена";btn.disabled=false;resolve({ok:true})}});
 };
 w.eval(source);
 assert.equal(w.__ppStopOptimizerInstalled,true);
 const stop=doc.getElementById("ppStopOptimizer");
 assert(stop,"Stop action missing");
 assert.equal(stop.textContent,"Остановить оптимизацию");
 assert.equal(btn.textContent,"Запустить оптимизацию");
 assert.equal(stop.classList.contains("pp-on"),false);
 const runningPromise=btn.onclick({type:"click"});
 assert.equal(runCount,1,"GA should start on initial button");
 assert.equal(stop.classList.contains("pp-on"),true);
 btn.textContent="Оптимизация 40%";
 await delay(750);
 assert.equal(stop.disabled,false,"Stop should enable once a complete candidate arrives");
 assert.equal(stop.textContent,"Остановить оптимизацию");
 await stop.onclick();
 assert.equal(btn.textContent,"Продолжить оптимизацию","Main button must show action, not status, immediately after stop");
 assert(!btn.textContent.includes("остановлена"),"Stop status must not become CTA");
 assert(doc.getElementById("valid").textContent.includes("остановлено"),"Status should remain in GA badge");
 await delay(85);
 const modal=doc.getElementById("ppStopModal");
 assert(modal.classList.contains("pp-open"),"Best-plan chooser must still open");
 const choice=[...modal.querySelectorAll(".pp-actions button")];
 assert.equal(choice.length,2);
 if(chooseBest){
  choice[0].click();
  assert.equal(btn.textContent,"Продолжить оптимизацию","Choosing best must leave resume action");
  assert.equal(w.__ppOptimizerCommittedPlan.duration_minutes,100,"Chosen best plan must be displayed");
  assert(restoreCalls.length>0&&kpiCalls.length>0,"Gantt/KPI must refresh");
 }else{
  choice[1].click();
  assert.equal(btn.textContent,previous?"Продолжить оптимизацию":"Запустить оптимизацию","Previous-plan choice must reflect whether a plan exists");
  if(previous)assert.equal(w.__ppOptimizerCommittedPlan.duration_minutes,120,"Existing saved plan must remain");
 }
 assert.equal(modal.classList.contains("pp-open"),false);
 resolveRun();
 await runningPromise;
 assert.equal(btn.textContent,chooseBest||previous?"Продолжить оптимизацию":"Запустить оптимизацию","Delayed optimiser cleanup must not overwrite action label");
 assert.equal(btn.disabled,false);
 assert.equal(stop.classList.contains("pp-on"),false);
 if(chooseBest){
  const again=btn.onclick({type:"click"});
  assert.equal(runCount,2,"Continue optimisation must initiate a new optimisation run");
  assert.equal(stop.classList.contains("pp-on"),true,"Stop action must reappear on continuation");
  assert.equal(w.__PP_STOP_DEBUG__().running,true);
  resolveRun();await again;
 }
 w.close();
 return {previous,chooseBest,runCount,details:restoreCalls.length};
}
(async()=>{
 const results=[];
 results.push(await scenario({previous:false,chooseBest:true}));
 results.push(await scenario({previous:true,chooseBest:false}));
 results.push(await scenario({previous:false,chooseBest:false}));
 console.log("OPTIMIZER_ACTION_LABELS_PASS",JSON.stringify({cases:results,initial:"Запустить оптимизацию",runningStop:"Остановить оптимизацию",stoppedContinue:"Продолжить оптимизацию",stopStatusOnlyBadge:true,lateCleanupStable:true,unchangedPlanChoice:true}));
})().catch(e=>{console.error(e);process.exitCode=1});
