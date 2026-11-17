import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {JSDOM} from "jsdom";

const stopScript=readFileSync("stop-ui.js","utf8");
const freshScript=readFileSync("restart-optimizer-ui.js","utf8");
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const best={ok:true,valid:true,partial:false,duration_minutes:4389,
 operator_wait_minutes:4100,machine_idle_minutes:1200,batch_count:118,
 operations:[{order:"QA_1",start_min:0,end_min:30,equipment_ids:["EQ_1"]}],
 batches:[{order:"QA_1",batch:1,quantity:100}]};
async function until(check,timeout=3900){
 const end=Date.now()+timeout;
 do {if(check())return;await delay(30)}while(Date.now()<end);
 throw new Error("REJOIN_TEST_WAIT_EXPIRED");
}
function build({running=true,autoComplete=false}={}){
 const dom=new JSDOM('<!doctype html><html><body>'+
 '<div id="ppProtectedAccount"></div>'+
 '<div id="meta">New search · 0 generations · run 0</div>'+
 '<span id="valid">GA ready</span><div id="validator"></div>'+
 '<div id="planView"><div class="toolbar"></div><button data-mode="best">Best found</button>'+
 '<button data-mode="candidate">Candidate plan</button></div>'+
 '<div id="ppOptimizerCandidateStatus"></div>'+
 '<button id="opt">Start optimization</button></body></html>',{
 url:"https://app.liftorbit.app/",runScripts:"outside-only",pretendToBeVisual:true});
 const w=dom.window;w.Response=Response;
 let phase=running?"running":"idle",percent=19,postPlan=0,reset=0,cancels=0,renders=[],kpi=0;
 const btn=w.document.getElementById("opt");
 btn.onclick=async()=>{postPlan++};
 w.renderPlan=p=>{renders.push(p)};
 w.renderKpisWithDelta=()=>{kpi++};
 w.ppOptimizerObjective=()=> "duration";
 w.fetch=async input=>{
  const path=new URL(String(input),w.location.href).pathname;
  if(path==="/api/plan-progress"){
   const done=phase==="completed",active=phase==="running";
   return new Response(JSON.stringify({ok:true,running:active,phase,
    success:done,percent:active?percent:done?100:0,
    best_preview:phase==="idle"?null:best,
    candidate_preview:active?best:null,result:done?best:null}),{
     status:200,headers:{"content-type":"application/json"}});
  }
  if(path==="/api/optimizer-stop"){
   cancels++;phase="cancelled";
   return new Response(JSON.stringify({ok:true,stopped:true,best_preview:best,
    variants:[{plan:best}]}),{status:200,headers:{"content-type":"application/json"}});
  }
  if(path==="/api/optimizer-reset"){
   reset++;
   return new Response(JSON.stringify({ok:false,error:"optimization_running_stop_first"}),{
     status:409,headers:{"content-type":"application/json"}});
  }
  throw new Error("UNEXPECTED_HTTP_PATH "+path);
 };
 w.eval(stopScript);
 w.eval(freshScript);
 return {w,dom,btn,best,renders,
  get stop(){return w.document.getElementById("ppStopOptimizer")},
  get fresh(){return w.document.getElementById("ppOptimizerStartOver")},
  get debug(){return w.__PP_STOP_DEBUG__()},
  get postPlan(){return postPlan},get reset(){return reset},
  get cancels(){return cancels},get kpi(){return kpi},
  setProgress(value){percent=value},setPhase(value){phase=value},
  close(){dom.window.close()}
 };
}
test("after refresh, running account GA restores Stop and progress, disables restart and never POSTs a second GA",async()=>{
 const q=build();
 try{
  assert.equal(q.debug.reconnecting,true,"buttons must stay gated until status is known");
  assert.equal(q.fresh.disabled,true,"restart blocked during status probe");
  await q.fresh.onclick();
  assert.equal(q.reset,0,"no reset during reconnect");
  await until(()=>q.debug.recoveredSession);
  assert.equal(q.debug.running,true);
  assert.equal(q.debug.remotePercent,19);
  assert.equal(q.btn.disabled,true);
  assert.equal(q.fresh.disabled,true);
  assert.equal(q.stop.disabled,false);
  assert.equal(q.stop.classList.contains("pp-on"),true);
  assert.equal(q.w.document.getElementById("valid").textContent,"GA: оптимизация · 19%");
  assert.equal(q.w.document.getElementById("meta").textContent,"GA: оптимизация · 19%");
  assert.equal(q.btn.textContent,"Оптимизация 19%");
  assert.equal(q.postPlan,0);
  await q.fresh.onclick();
  assert.equal(q.reset,0,"reset not allowed during running GA");
  await q.btn.onclick();
  assert.equal(q.postPlan,0,"must never fire original optimizer while recovered job runs");
  q.setProgress(43);
  await until(()=>q.debug.remotePercent===43,3500);
  assert.equal(q.w.document.getElementById("valid").textContent,"GA: оптимизация · 43%");
  await q.stop.onclick();
  await until(()=>q.debug.running===false);
  assert.equal(q.cancels,1);
  assert.equal(q.stop.classList.contains("pp-on"),false);
  await until(()=>!!q.w.document.querySelector("#ppStopModal.pp-open"));
  q.w.document.querySelector("#ppStopModal.pp-open .pp-actions button").click();
  assert.equal(q.w.__ppOptimizerCommittedPlan.duration_minutes,4389);
  assert.equal(q.btn.disabled,false);
  assert.equal(q.fresh.disabled,false);
  console.log("GA_RELOAD_RUNNING_STOP_CHOICE_PASS");
 }finally{q.close()}
});
test("a calculation completed during reload is accepted and shown without a new GA run",async()=>{
 const q=build({running:true});
 try{
  await until(()=>q.debug.recoveredSession);
  q.setPhase("completed");
  await until(()=>q.debug.running===false&&q.w.__ppOptimizerCommittedPlan?.duration_minutes===4389,3500);
  assert.equal(q.debug.recoveredSession,false);
  assert.equal(q.w.document.getElementById("valid").textContent,"GA: расчёт завершён");
  assert.equal(q.w.document.getElementById("validator").textContent,"План показан на Ганте");
  assert.equal(q.btn.disabled,false);
  assert.equal(q.btn.textContent,"Продолжить оптимизацию");
  assert.equal(q.fresh.disabled,false);
  assert.equal(q.postPlan,0);
  assert.equal(q.renders.length>=1,true);
  assert.equal(q.kpi>=1,true);
  console.log("GA_RELOAD_COMPLETED_RESULT_RESTORED_PASS");
 }finally{q.close()}
});
test("when there is no active job, startup probe unlocks existing native Start and saved plans",async()=>{
 const q=build({running:false});
 try{
  await until(()=>q.debug.reconnecting===false);
  assert.equal(q.debug.running,false);
  assert.equal(q.stop.classList.contains("pp-on"),false);
  assert.equal(q.fresh.disabled,false);
  await q.btn.onclick();
  assert.equal(q.postPlan,1);
  assert.equal(q.reset,0);
  console.log("GA_RELOAD_IDLE_DOES_NOT_BLOCK_NEW_JOB_PASS");
 }finally{q.close()}
});
