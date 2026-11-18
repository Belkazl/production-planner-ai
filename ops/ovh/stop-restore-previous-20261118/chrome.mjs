import {chromium} from "playwright-core";
import assert from "node:assert/strict";
import {randomUUID,randomBytes} from "node:crypto";

const base="https://app.liftorbit.app";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1500,height:900}});
const errors=[];
page.on("pageerror",e=>errors.push(String(e).slice(0,180)));
const ids=Array.from({length:12},(_,i)=>"STP_QA_"+i);
const model={orders:ids.map(id=>({id})),equipment:[{id:"STP_EQ"}],employees:[{id:"STP_EMP"}]};
const plan=(minutes)=>({
 ok:true,valid:true,partial:false,_revision:7,duration_minutes:minutes,
 batch_count:118,operator_wait_minutes:413124,machine_idle_minutes:16859,
 operations:Array.from({length:915},(_,i)=>({
  order:ids[i%12],is_setup:i<89,phase:i<89?"setup":"process",
  equipment_ids:["STP_EQ"],employee_ids:["STP_EMP"],
  start_min:i*5,end_min:i*5+4
 }))
});
const api=(p,method="GET",body)=>page.evaluate(async({p,method,body})=>{
 const init={method,credentials:"same-origin",headers:{accept:"application/json"},cache:"no-store"};
 if(body!==undefined){init.headers["content-type"]="application/json";init.body=JSON.stringify(body)}
 const r=await fetch(p,init);let data={};try{data=await r.json()}catch{}
 return {status:r.status,body:data};
},{p,method,body});
try{
 const first=await page.goto(base,{waitUntil:"domcontentloaded",timeout:60000});
 assert.equal(first.status(),200);
 const registered=await api("/api/auth/register","POST",{
  email:"stop-rollback-qa-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid",
  password:randomBytes(24).toString("base64url"),
  company:"Disposable STOP previous-plan QA"
 });
 assert.equal(registered.status,200);
 await page.goto(base,{waitUntil:"domcontentloaded",timeout:60000});
 await page.waitForFunction(()=>window.__PP_STOP_RESTORE_PREVIOUS_V1__?.installed===true&&
  window.__PP_KPI_SELECTED_REFERENCE_V2__?.installed===true&&
  !!document.getElementById("ppStopModal")&&
  !!document.getElementById("durDelta"),null,{timeout:40000});
 const project="stop-rollback-"+randomUUID().replaceAll("-","");
 const data=JSON.stringify([{id:project,name:"Disposable prior accepted plan",
  revision:7,model,lastPlan:plan(4405)}]);
 await page.evaluate(({data,project})=>{
  localStorage.setItem("prodplan.project.active.v2",project);
  localStorage.setItem("prodplan.projects.v2",data);
  window.__PP_KPI_FIRST_BEST_V1__?.sync();
 },{data,project});
 const prior=plan(4405),candidate=plan(4275);
 const result=await page.evaluate(async ({prior,candidate})=>{
  window.__ppOptimizerCommittedPlan=prior;
  window.__ppTabPlan=candidate;
  window.__ppGenericPlan=candidate;
  window.__PP_KPI_SELECTED_REFERENCE_V2__.select(prior);
  window.__PP_KPI_SELECTED_REFERENCE_V2__.markContinue();
  window.renderKpisWithDelta(candidate);
  const modal=document.getElementById("ppStopModal");
  const opt=document.getElementById("opt");
  const state={nativeKept:0,nativeCandidateChosen:0,hiddenBeforeClick:false};
  const modalBox=document.createElement("div");modalBox.className="pp-box";
  const actions=document.createElement("div");actions.className="pp-actions";
  const choose=document.createElement("button");choose.textContent="Choose intermediate candidate";
  const keep=document.createElement("button");keep.className="pp-secondary";
  keep.textContent="Оставить прежний план";
  choose.onclick=()=>{state.nativeCandidateChosen++;window.__ppOptimizerCommittedPlan=candidate;
   modal.classList.remove("pp-open");modal.style.display="none"};
  keep.onclick=()=>{
   state.hiddenBeforeClick=getComputedStyle(modal).display==="none";
   state.nativeKept++;
   window.__ppOptimizerCommittedPlan=prior;
   window.__ppTabPlan=prior;
   window.__ppGenericPlan=prior;
   window.renderKpisWithDelta(prior);
   modal.classList.remove("pp-open");
   modal.style.display="none";
   opt.disabled=false;
   opt.textContent="Continue optimization";
  };
  actions.append(choose,keep);
  modalBox.append(actions);
  modal.replaceChildren(modalBox);
  modal.style.display="flex";
  modal.classList.add("pp-open");
  for(let i=0;i<40&&state.nativeKept===0;i++)await new Promise(r=>setTimeout(r,20));
  for(let i=0;i<40&&window.__PP_KPI_SELECTED_REFERENCE_V2__.snapshot?.compare!==false;i++)
   await new Promise(r=>setTimeout(r,20));
  return {
   ...state,hiddenAfter:getComputedStyle(modal).display==="none",
   modalOpen:modal.classList.contains("pp-open"),
   restorationCount:window.__PP_STOP_RESTORE_PREVIOUS_V1__.restored,
   prevMetric:window.__ppOptimizerCommittedPlan?.duration_minutes,
   tabMetric:window.__ppTabPlan?.duration_minutes,
   kpiReference:window.__PP_KPI_SELECTED_REFERENCE_V2__.snapshot,
   deltaVisible:getComputedStyle(document.getElementById("durDelta")).display!=="none",
   continueText:opt.textContent
  };
 },{prior,candidate});
 console.log("STOP_SILENT_ROLLBACK_REAL_CHROME",JSON.stringify(result));
 assert.equal(result.nativeKept,1,"must automatically invoke native Keep previous");
 assert.equal(result.nativeCandidateChosen,0,"must not accept intermediate candidate");
 assert.equal(result.hiddenBeforeClick,true,"stop-choice dialog must never appear");
 assert.equal(result.hiddenAfter,true);
 assert.equal(result.modalOpen,false);
 assert.equal(result.restorationCount,1);
 assert.equal(result.prevMetric,4405);
 assert.equal(result.tabMetric,4405);
 assert.equal(result.kpiReference.metrics.duration,4405);
 assert.equal(result.kpiReference.compare,false,"prior accepted plan becomes new comparison baseline");
 assert.equal(result.deltaVisible,false,"old candidate delta should be hidden");
 assert.match(result.continueText,/Continue optimization/i);
 const persisted=await page.evaluate(({p})=>{
  window.__PP_KPI_SELECTED_REFERENCE_V2__.markContinue();
  window.renderKpisWithDelta(p);
  return {ref:window.__PP_KPI_SELECTED_REFERENCE_V2__.snapshot,
   delta:document.getElementById("durDelta").textContent};
 },{p:plan(4375)});
 console.log("STOP_SILENT_ROLLBACK_CONTINUE_DELTA",JSON.stringify(persisted));
 assert.equal(persisted.ref.metrics.duration,4405);
 assert.equal(persisted.ref.compare,true);
 assert.match(persisted.delta,/−30/);
 const server=await api("/api/plan-progress");
 assert.equal(server.status,200);
 assert.equal(server.body.running,false,"test account never started a GA worker");
 assert.deepEqual(errors,[],"no JS errors");
 console.log("STOP_SILENT_RESTORE_PREVIOUS_PLAN_REAL_CHROME_ACCEPTANCE_PASS");
}catch(error){
 console.log("STOP_SILENT_RESTORE_PREVIOUS_PLAN_REAL_CHROME_FAIL",String(error?.stack||error).slice(0,1450));
 console.log("STOP_RESTORE_BROWSER_ERRORS",JSON.stringify(errors.slice(-6)));
 process.exitCode=1;
}finally{await browser.close()}
