import {chromium} from "playwright";
import assert from "node:assert/strict";
import {randomUUID,randomBytes} from "node:crypto";
const base="https://app.liftorbit.app";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1600,height:950}});
const errors=[];
page.on("pageerror",e=>errors.push(String(e).slice(0,220)));
const plan=(duration,wait=400000,idle=21000)=>({
 valid:true,partial:false,_revision:7,
 operations:[{order:"QA_ONE",equipment_ids:["QA_E1"],employee_ids:["QA_EMP1"]}],
 duration_minutes:duration,batch_count:118,operator_wait_minutes:wait,machine_idle_minutes:idle
});
const api=(path,method="GET",body)=>page.evaluate(async({path,method,body})=>{
 const opts={method,cache:"no-store",credentials:"same-origin",headers:{accept:"application/json"}};
 if(body!==undefined){opts.headers["content-type"]="application/json";opts.body=JSON.stringify(body)}
 const r=await fetch(path,opts);let data={};try{data=await r.json()}catch{}
 return {status:r.status,body:data}
},{path,method,body});
try{
 const first=await page.goto(base,{waitUntil:"domcontentloaded",timeout:60000});
 assert.equal(first.status(),200);
 const register=await api("/api/auth/register","POST",{
  email:"kpi-fixed-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid",
  password:randomBytes(24).toString("base64url"),
  company:"Disposable KPI fixed baseline acceptance"
 });
 assert.equal(register.status,200);
 await page.goto(base,{waitUntil:"domcontentloaded",timeout:60000});
 await page.waitForFunction(()=>window.__PP_KPI_FIRST_BEST_V1__?.installed===true&&
  window.renderKpisWithDelta?.__ppFirstBestWrapped===true&&
  window.ppProjectAfterPlan?.__ppFirstBestWrapped===true&&
  !!document.getElementById("durDelta"),null,{timeout:35000});
 const project="kpi-qa-"+randomUUID().replaceAll("-","");
 const data=JSON.stringify([{id:project,name:"Disposable KPI first best",revision:7,
  model:{orders:[{id:"QA_ONE"}],equipment:[{id:"QA_E1"}],employees:[{id:"QA_EMP1"}]},
  lastPlan:null}]);
 await page.evaluate(({project,data})=>{
  localStorage.setItem("prodplan.project.active.v2",project);
  localStorage.setItem("prodplan.projects.v2",data);
  window.__PP_KPI_FIRST_BEST_V1__.sync();
 },{project,data});
 const initial=await page.evaluate(p=>{
  window.renderKpisWithDelta(p);
  const ids=["durDelta","cyclesDelta","waitDelta","idleDelta"];
  return {hidden:ids.every(id=>getComputedStyle(document.getElementById(id)).display==="none"),
   main:document.getElementById("dur").textContent,
   snapshot:window.__PP_KPI_FIRST_BEST_V1__.snapshot};
 },plan(5000));
 assert.equal(initial.hidden,true);
 assert.equal(initial.snapshot,null);
 assert.equal(Number(initial.main),5000);
 const firstSelected=await page.evaluate(p=>{
  window.renderKpisWithDelta(p);
  window.ppProjectAfterPlan(p);
  window.__PP_KPI_FIRST_BEST_V1__.sync();
  return {reference:window.__PP_KPI_FIRST_BEST_V1__.snapshot,
   hidden:window.__PP_KPI_FIRST_BEST_V1__.compareVisible===false,
   delta:document.getElementById("durDelta").textContent,
   main:document.getElementById("dur").textContent};
 },plan(4800));
 console.log("KPI_FIRST_BEST_LIVE_INITIAL",JSON.stringify(firstSelected));
 assert.equal(firstSelected.reference.metrics.duration,4800);
 assert.equal(firstSelected.reference.compare,false);
 assert.equal(firstSelected.hidden,true);
 assert.equal(firstSelected.delta,"");
 assert.equal(Number(firstSelected.main),4800);
 await page.evaluate(()=>{
  const button=document.getElementById("opt");
  // Catch the real click after KPI handler, preventing a worker request.
  button.addEventListener("click",event=>{
   event.preventDefault();event.stopImmediatePropagation();
  },true);
  button.textContent="Continue optimization";
  button.disabled=false;
  window.__ppOptimizationInFlight=false;
  window.__ppFreshRestartPending=false;
  button.click();
 });
 const afterContinue=await page.evaluate(p=>{
  window.renderKpisWithDelta(p);
  return {reference:window.__PP_KPI_FIRST_BEST_V1__.snapshot,
   duration:document.getElementById("durDelta").textContent,
   main:document.getElementById("dur").textContent,
   idle:document.getElementById("idleDelta").textContent};
 },plan(4775,398000,21600));
 console.log("KPI_FIRST_BEST_LIVE_CONTINUE",JSON.stringify(afterContinue));
 assert.equal(afterContinue.reference.compare,true);
 assert.match(afterContinue.duration,/25/);
 assert.equal(afterContinue.duration[0],"−");
 assert.equal(Number(afterContinue.main),4775);
 const secondContinue=await page.evaluate(p=>{
  window.renderKpisWithDelta(p);
  return {duration:document.getElementById("durDelta").textContent,
   idle:document.getElementById("idleDelta").textContent,
   reference:window.__PP_KPI_FIRST_BEST_V1__.snapshot.metrics.duration};
 },plan(4700,390000,23000));
 console.log("KPI_FIRST_BEST_LIVE_NEXT",JSON.stringify(secondContinue));
 assert.equal(secondContinue.reference,4800,"reference must never become previous candidate");
 assert.match(secondContinue.duration,/100/);
 assert.equal(secondContinue.duration[0],"−");
 await page.route("**/api/optimizer-reset",async route=>{
  await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ok:true})});
 });
 const reset=await api("/api/optimizer-reset","POST",{});
 assert.equal(reset.status,200);
 const afterReset=await page.evaluate(p=>{
  window.renderKpisWithDelta(p);
  return {reference:window.__PP_KPI_FIRST_BEST_V1__.snapshot,
   hidden:window.__PP_KPI_FIRST_BEST_V1__.compareVisible===false,
   delta:document.getElementById("durDelta").textContent,
   main:document.getElementById("dur").textContent};
 },plan(4600));
 console.log("KPI_FIRST_BEST_LIVE_START_AGAIN",JSON.stringify(afterReset));
 assert.equal(afterReset.reference,null);
 assert.equal(afterReset.hidden,true);
 assert.equal(afterReset.delta,"");
 assert.equal(Number(afterReset.main),4600);
 const afterNew=await page.evaluate(p=>{
  window.ppProjectAfterPlan(p);
  return window.__PP_KPI_FIRST_BEST_V1__.snapshot;
 },plan(4590));
 assert.equal(afterNew.metrics.duration,4590);
 assert.equal(afterNew.compare,false,"first new result must keep small changes hidden");
 assert.deepEqual(errors,[],"KPI reference addon must not produce JS errors");
 console.log("KPI_FIRST_BEST_REAL_CHROMIUM_FRESH_HIDE_CONTINUE_FREEZE_PASS");
}catch(e){
 console.log("KPI_FIRST_BEST_REAL_CHROMIUM_FAIL",String(e?.stack||e).slice(0,1750));
 console.log("KPI_FIRST_BEST_BROWSER_ERRORS",JSON.stringify(errors.slice(-6)));
 process.exitCode=1;
}finally{await browser.close()}
