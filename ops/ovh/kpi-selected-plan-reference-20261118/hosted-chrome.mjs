import {chromium} from "playwright-core";
import assert from "node:assert/strict";
import {randomUUID,randomBytes} from "node:crypto";

const base="https://app.liftorbit.app";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1600,height:950}});
const errors=[];
page.on("pageerror",e=>errors.push(String(e).slice(0,180)));
const ids=Array.from({length:12},(_,i)=>"QA_ORDER_"+i);
const model={
 orders:ids.map(id=>({id})),
 equipment:[{id:"QA_MACHINE"}],
 employees:[{id:"QA_EMP"}]
};
const makePlan=(duration,wait=413124,idle=16859)=>({
 ok:true,valid:true,partial:false,_revision:7,
 operations:Array.from({length:915},(_,i)=>({
  order:ids[i%12],is_setup:i<89,phase:i<89?"setup":"process",
  equipment_ids:["QA_MACHINE"],employee_ids:["QA_EMP"]
 })),
 duration_minutes:duration,batch_count:118,operator_wait_minutes:wait,machine_idle_minutes:idle
});
const api=(path,method="GET",data)=>page.evaluate(async({path,method,data})=>{
 const init={method,cache:"no-store",credentials:"same-origin",headers:{accept:"application/json"}};
 if(data!==undefined){init.headers["content-type"]="application/json";init.body=JSON.stringify(data)}
 const r=await fetch(path,init);let body={};try{body=await r.json()}catch{}
 return {status:r.status,body};
},{path,method,data});
try{
 const first=await page.goto(base,{waitUntil:"domcontentloaded",timeout:60000});
 assert.equal(first.status(),200);
 const reg=await api("/api/auth/register","POST",{
  email:"selected-kpi-qa-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid",
  password:randomBytes(26).toString("base64url"),
  company:"Disposable KPI Stop selection acceptance"
 });
 assert.equal(reg.status,200);
 await page.goto(base,{waitUntil:"domcontentloaded",timeout:60000});
 await page.waitForFunction(()=>window.__PP_KPI_FIRST_BEST_V1__?.installed===true&&
  window.__PP_KPI_SELECTED_REFERENCE_V2__?.installed===true&&
  !!document.getElementById("ppStopModal")&&
  !!document.getElementById("durDelta"),null,{timeout:35000});
 const id="selected-kpi-"+randomUUID().replaceAll("-","");
 const projects=JSON.stringify([{id,name:"Disposable selected KPI",
  revision:7,model,lastPlan:null}]);
 await page.evaluate(({id,projects})=>{
  localStorage.setItem("prodplan.project.active.v2",id);
  localStorage.setItem("prodplan.projects.v2",projects);
  window.__PP_KPI_FIRST_BEST_V1__.sync();
 },{id,projects});
 const initial=await page.evaluate(plan=>{
  window.ppProjectAfterPlan(plan);
  window.renderKpisWithDelta(plan);
  const button=document.getElementById("opt");
  button.textContent="Continue optimization";
  button.disabled=false;
  // Never submit a real optimization from this fixture.
  button.addEventListener("click",e=>{e.preventDefault();e.stopImmediatePropagation()},true);
  button.click();
  const snapshot=window.__PP_KPI_FIRST_BEST_V1__.snapshot;
  return {snapshot,hidden:window.__PP_KPI_FIRST_BEST_V1__.compareVisible===false};
 },makePlan(4338,412568,18706));
 assert.equal(initial.snapshot.metrics.duration,4338);
 assert.equal(initial.snapshot.compare,true);
 const reproduced=await page.evaluate(plan=>{
  window.renderKpisWithDelta(plan);
  return document.getElementById("durDelta").textContent;
 },makePlan(4405));
 assert.match(reproduced,/\+67/);
 console.log("KPI_SELECTED_LIVE_OLD_WRONG_DELTA_REPRODUCED",reproduced);
 // Add a chooser using the exact STOP modal structure and button click
 // semantics. Its real handler lives in stop-ui.js (the production source is
 // unchanged); this tests the patched browser event boundary, not a live job.
 await page.evaluate(plan=>{
  const modal=document.getElementById("ppStopModal");
  const box=document.createElement("div");box.className="pp-box";
  const actions=document.createElement("div");actions.className="pp-actions";
  const choice=document.createElement("button");choice.textContent="Выбрать и показать на Ганте";
  const keep=document.createElement("button");keep.textContent="Оставить прежний план";
  choice.onclick=()=>{
   window.__ppOptimizerCommittedPlan=plan;
   window.__ppTabPlan=plan;
   window.__ppGenericPlan=plan;
   window.renderKpisWithDelta(plan);
   modal.classList.remove("pp-open");modal.style.display="none";
  };
  keep.onclick=()=>{modal.classList.remove("pp-open");modal.style.display="none"};
  actions.append(choice,keep);box.append(actions);
  modal.replaceChildren(box);
  modal.style.display="flex";modal.classList.add("pp-open");
 },makePlan(4405));
 await page.locator("#ppStopModal .pp-actions button").first().click();
 await page.waitForFunction(()=>window.__PP_KPI_SELECTED_REFERENCE_V2__?.snapshot?.metrics?.duration===4405&&
  window.__PP_KPI_SELECTED_REFERENCE_V2__?.snapshot?.compare===false,null,{timeout:8000});
 const chosen=await page.evaluate(()=>({
  kpi:window.__PP_KPI_FIRST_BEST_V1__.snapshot,
  improved:document.getElementById("durDelta").textContent,
  shown:document.getElementById("dur").textContent,
  hidden:getComputedStyle(document.getElementById("durDelta")).display==="none"
 }));
 console.log("KPI_SELECTED_LIVE_STOP_CHOICE",JSON.stringify(chosen));
 assert.equal(chosen.kpi.metrics.duration,4405,"Stop selected plan replaces 4338 reference");
 assert.equal(chosen.kpi.compare,false);
 assert.equal(chosen.hidden,true);
 assert.equal(Number(chosen.shown),4405);
 await page.route("**/api/plan",async route=>{
  await route.fulfill({status:202,contentType:"application/json",body:JSON.stringify({ok:true,started:true})});
 });
 const next=await page.evaluate(async plan=>{
  const r=await fetch("/api/plan",{method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({continue:true,generations:10,population:12})});
  if(r.status!==202)throw Error("Mock continuation was not intercepted");
  window.renderKpisWithDelta(plan);
  return {duration:document.getElementById("durDelta").textContent,
   cycles:document.getElementById("cyclesDelta").textContent,
   wait:document.getElementById("waitDelta").textContent,
   idle:document.getElementById("idleDelta").textContent,
   ref:window.__PP_KPI_SELECTED_REFERENCE_V2__.snapshot,
   value:document.getElementById("dur").textContent};
 },makePlan(4375,411000,17000));
 console.log("KPI_SELECTED_LIVE_CONTINUE",JSON.stringify(next));
 assert.equal(next.ref.metrics.duration,4405);
 assert.equal(next.ref.compare,true);
 assert.match(next.duration,/−30/);
 assert.match(next.wait,/−2124/);
 assert.match(next.idle,/\+141/);
 assert.equal(Number(next.value),4375);
 const second=await page.evaluate(plan=>{
  window.renderKpisWithDelta(plan);
  return {delta:document.getElementById("durDelta").textContent,
   ref:window.__PP_KPI_SELECTED_REFERENCE_V2__.snapshot.metrics.duration};
 },makePlan(4350));
 assert.equal(second.ref,4405);
 assert.match(second.delta,/−55/);
 await page.reload({waitUntil:"domcontentloaded",timeout:60000});
 await page.waitForFunction(()=>window.__PP_KPI_SELECTED_REFERENCE_V2__?.installed===true,null,{timeout:35000});
 const persisted=await page.evaluate(plan=>{
  window.renderKpisWithDelta(plan);
  return {ref:window.__PP_KPI_SELECTED_REFERENCE_V2__.snapshot,
   delta:document.getElementById("durDelta").textContent};
 },makePlan(4340));
 console.log("KPI_SELECTED_LIVE_RELOAD",JSON.stringify(persisted));
 assert.equal(persisted.ref.metrics.duration,4405);
 assert.match(persisted.delta,/−65/);
 assert.deepEqual(errors,[],"no JavaScript errors in authenticated browser");
 console.log("KPI_SELECTED_STOP_CHOOSER_REAL_CHROME_REFERENCE_ACCEPTANCE_PASS");
}catch(error){
 console.log("KPI_SELECTED_STOP_CHOOSER_REAL_CHROME_FAIL",String(error?.stack||error).slice(0,1600));
 console.log("KPI_SELECTED_BROWSER_JS_ERRORS",JSON.stringify(errors.slice(-6)));
 process.exitCode=1;
}finally{await browser.close()}
