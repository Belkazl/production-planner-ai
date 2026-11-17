// Real production HTTPS browser acceptance with an isolated disposable account.
// A live GA is started once using the normal authenticated API, then the page
// is reloaded. We never access, reset or change another user's active job.
import {chromium} from "playwright";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
const base="https://app.liftorbit.app";
const pause=ms=>new Promise(done=>setTimeout(done,ms));
const rq=(kind,ref)=>({resource_type:kind,resource_ref:ref,resource_refs:[ref],match_mode:"specific",quantity:1});
const model={
 scheduler_mode:"resource",start:"2026-11-17T08:00:00",
 equipment:Array.from({length:14},(_,i)=>({id:"RR_EQ"+i,name:"Synthetic machine "+i,kind:"workstation",capacity:600,capacity_unit:"m2"})),
 employees:Array.from({length:5},(_,i)=>({id:"RR_EMP"+i,name:"Synthetic operator "+i,shift:"day"})),
 shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},
 orders:Array.from({length:12},(_,i)=>({id:"RR_ORD"+i,quantity:7200,unit:"m2",technical_process_id:"RR_PROC"})),
 technical_processes:[{id:"RR_PROC",name:"Synthetic process",operations:Array.from({length:7},(_,i)=>({
  id:"RR_OP"+i,name:"Process "+i,sequence:i+1,duration_min:30,
  resource_requirements:[rq("equipment","RR_EQ"+i),rq("employee","RR_EMP"+i%5)]
 }))}],
 materials:[],setup_rules:[]
};
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const context=await browser.newContext({viewport:{width:1600,height:940}});
const page=await context.newPage();
const errors=[],apiPosts=[];
page.on("pageerror",e=>errors.push(String(e).slice(0,150)));
page.on("request",r=>{
 if(new URL(r.url()).pathname==="/api/plan"&&r.method()==="POST")
  apiPosts.push({method:r.method(),url:new URL(r.url()).pathname});
});
let accountCreated=false,jobRunning=false;
const api=(path,method="GET",data)=>page.evaluate(async({path,method,data})=>{
 const opts={method,credentials:"same-origin",cache:"no-store",headers:{accept:"application/json"}};
 if(data!==undefined){opts.headers["content-type"]="application/json";opts.body=JSON.stringify(data)}
 const response=await fetch(path,opts);
 let payload={};try{payload=await response.json()}catch{}
 return {status:response.status,data:payload};
},{path,method,data});
try{
 let response=await page.goto(base,{waitUntil:"domcontentloaded",timeout:60000});
 assert.equal(response.status(),200);
 const email="reload-live-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid";
 const password=randomBytes(34).toString("base64url");
 const reg=await api("/api/auth/register","POST",{email,password,company:"GA browser reload QA synthetic"});
 assert.equal(reg.status,200,"test account registration");
 accountCreated=true;
 await page.goto(base,{waitUntil:"domcontentloaded",timeout:60000});
 const project="rr-"+randomUUID().replaceAll("-","");
 const projects=JSON.stringify([{id:project,name:"Synthetic reload test",model}]);
 // The compatibility HTML may use the original storage shim; no assumption about transport.
 // Keep browser localStorage and the isolated account DB in sync, just like
 // saving a model through the real UI. Otherwise the app may upload its older
 // empty localStorage snapshot over a bare test-only /api/db-storage POST.
 await page.evaluate(({project,projects})=>{
  localStorage.setItem("prodplan.projects.v2",projects);
  localStorage.setItem("prodplan.project.active.v2",project);
 },{project,projects});
 const saved=await api("/api/db-storage","POST",{storage:{
  "prodplan.projects.v2":projects,
  "prodplan.project.active.v2":project
 }});
 assert.equal(saved.status,200,"synthetic model storage");
 let own=await api("/api/model");
 console.log("GA_RELOAD_LIVE_MODEL_STORED",JSON.stringify({http:own.status,
  orders:own.data.model?.orders?.length||0}));
 assert.equal(own.status,200,"model ownership boundary");
 assert.equal(own.data.model?.orders?.length,12,"synthetic model must be stored before refresh");
 await page.reload({waitUntil:"domcontentloaded",timeout:60000});
 // The compatibility HTML may use the original storage shim; no assumption about transport.
 own=await api("/api/model");
 console.log("GA_RELOAD_LIVE_MODEL_AFTER_RELOAD",JSON.stringify({http:own.status,
  orders:own.data.model?.orders?.length||0}));
 assert.equal(own.status,200,"model ownership after reload");
 assert.equal(own.data.model?.orders?.length,12,"model orders must survive refresh");
 await page.waitForSelector("#opt",{timeout:30000});
 await page.waitForFunction(()=>window.__PP_STOP_DEBUG__?.().reconnecting===false,null,{timeout:25000});
 // Starting by API is intentional: it must be the same account-owned server GA
 // even though the browser will lose all JS promises on reload.
 const started=await api("/api/plan","POST",{
  generations:15000,population:80,seed:1433,objective:"duration",__pp_async_start:true});
 console.log("GA_RELOAD_LIVE_INITIAL_START",JSON.stringify({
  status:started.status,started:started.data.started,error:started.data.error||null
 }));
 assert.equal(started.status,202,"first GA job accepted");
 jobRunning=true;
 let before;
 for(let i=0;i<12;i++){
  await pause(1000);
  before=await api("/api/plan-progress");
  if(before.status===200&&before.data.running===true)break;
 }
 assert.equal(before.status,200);
 assert.equal(before.data.running,true,"GA must actually be active before reload");
 const observedBefore=apiPosts.length;
 await page.reload({waitUntil:"domcontentloaded",timeout:60000});
 await page.waitForFunction(()=>{
  const debug=window.__PP_STOP_DEBUG__?.();
  const b=document.getElementById("ppStopOptimizer");
  return debug?.running===true&&debug?.recoveredSession===true&&
   debug.reconnecting===false&&b?.classList.contains("pp-on")&&!b.disabled;
 },null,{timeout:30000});
 const ui=await page.evaluate(()=>({
  stop:window.__PP_STOP_DEBUG__?.(),
  badge:document.getElementById("valid")?.textContent,
  meta:document.getElementById("meta")?.textContent,
  primaryDisabled:document.getElementById("opt")?.disabled,
  primaryText:document.getElementById("opt")?.textContent,
  restartDisabled:document.getElementById("ppOptimizerStartOver")?.disabled,
  preview:window.__PP_OVH_LIVE_PREVIEW_BRIDGE__?.getState?.()
 }));
 console.log("GA_RELOAD_LIVE_REATTACHED",JSON.stringify({
  running:ui.stop?.running,recovered:ui.stop?.recoveredSession,
  percent:ui.stop?.remotePercent,phase:ui.stop?.remotePhase,
  badge:String(ui.badge||"").slice(0,80),primaryDisabled:ui.primaryDisabled,
  restartDisabled:ui.restartDisabled,previewInstalled:!!ui.preview?.installed
 }));
 assert.equal(ui.primaryDisabled,true,"no concurrent optimization button during live GA");
 assert.equal(ui.restartDisabled,true,"Start again must be disabled during live GA");
 assert.match(ui.badge||"",/GA:.*\d+%/,"running progress must be visible after reload");
 assert.equal(apiPosts.length,observedBefore,"reloading must never POST /api/plan again");
 const best=page.locator("#ppOptimizerCandidateStatus");
 // This widget already reattaches the Gantt preview independently. Allow up
 // to 30s for the worker to find an intermediate candidate on a large model.
 try{await page.waitForFunction(()=>window.__PP_OVH_LIVE_PREVIEW_BRIDGE__?.getState?.().hasBest===true,null,{timeout:30000})}
 catch{}
 const preview=await page.evaluate(()=>window.__PP_OVH_LIVE_PREVIEW_BRIDGE__?.getState?.());
 console.log("GA_RELOAD_LIVE_PREVIEW",JSON.stringify({
  best:!!preview?.hasBest,candidate:!!preview?.hasCandidate,
  shown:preview?.shown||0,errors:preview?.failures||0
 }));
 await page.screenshot({path:"ga-after-reload-running.png",fullPage:false});
 const stopButton=page.locator("#ppStopOptimizer");
 const stopResponse=page.waitForResponse(res=>new URL(res.url()).pathname==="/api/optimizer-stop",{timeout:30000});
 await stopButton.click({timeout:10000});
 const stopR=await stopResponse;
 const stopBody=await stopR.json();
 console.log("GA_RELOAD_LIVE_STOP",JSON.stringify({status:stopR.status(),
  ok:stopBody.ok,stopped:stopBody.stopped,error:stopBody.error||null}));
 assert.equal(stopR.status(),200,"stop server response");
 assert.equal(stopBody.ok,true);
 await page.waitForFunction(()=>window.__PP_STOP_DEBUG__?.().running===false,null,{timeout:15000});
 jobRunning=false;
 const after=await api("/api/plan-progress");
 assert.equal(after.status,200);
 assert.equal(after.data.running,false,"server GA must remain stopped after UI click");
 assert.equal(after.data.phase,"cancelled","server GA must confirm cancellation");
 assert.equal(apiPosts.length,observedBefore,"stop must not trigger new GA");
 const modal=page.locator("#ppStopModal.pp-open");
 if(await modal.isVisible().catch(()=>false))
  await modal.locator(".pp-actions button").first().click({timeout:5000});
 const controls=await page.evaluate(()=>({
  stopVisible:document.getElementById("ppStopOptimizer")?.classList.contains("pp-on"),
  primaryDisabled:document.getElementById("opt")?.disabled,
  restartDisabled:document.getElementById("ppOptimizerStartOver")?.disabled,
  selectedDuration:window.__ppOptimizerCommittedPlan?.duration_minutes||null
 }));
 assert.equal(controls.stopVisible,false);
 assert.equal(controls.primaryDisabled,false);
 assert.equal(controls.restartDisabled,false);
 console.log("GA_RELOAD_LIVE_STOPPED_UI",JSON.stringify(controls));
 // Ensure second reload does not resurrect a cancelled job or restart GA.
 await page.reload({waitUntil:"domcontentloaded",timeout:60000});
 await page.waitForFunction(()=>window.__PP_STOP_DEBUG__?.().reconnecting===false,null,{timeout:20000});
 const final=await page.evaluate(()=>window.__PP_STOP_DEBUG__?.());
 assert.equal(final.running,false);
 assert.equal(apiPosts.length,observedBefore);
 console.log("GA_RELOAD_REAL_BROWSER_END_TO_END_PASS",JSON.stringify({
  initiallyRunning:true,recovered:true,stopWorked:true,secondRunStarted:false,
  errors:errors.slice(0,3)
 }));
} catch(err){
 console.log("GA_RELOAD_LIVE_FAILURE",String(err?.stack||err).slice(0,1200));
 process.exitCode=1;
} finally{
 if(accountCreated&&jobRunning){
  try{await api("/api/optimizer-stop","POST",{})}catch{}
 }
 await browser.close();
}
