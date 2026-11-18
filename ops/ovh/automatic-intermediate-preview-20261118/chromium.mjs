import {chromium} from "playwright";
import assert from "node:assert/strict";
import {randomUUID,randomBytes} from "node:crypto";
const base="https://app.liftorbit.app";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1600,height:900}});
const errors=[];
page.on("pageerror",e=>errors.push(String(e).slice(0,200)));
const api=(path,method="GET",body)=>page.evaluate(async({path,method,body})=>{
 const init={method,cache:"no-store",credentials:"same-origin",headers:{accept:"application/json"}};
 if(body!==undefined){init.headers["content-type"]="application/json";init.body=JSON.stringify(body)}
 const r=await fetch(path,init);let value={};try{value=await r.json()}catch{}
 return {status:r.status,body:value};
},{path,method,body});
try{
 const publicPage=await page.goto(base,{waitUntil:"domcontentloaded",timeout:60000});
 assert.equal(publicPage.status(),200);
 const created=await api("/api/auth/register","POST",{
  email:"automatic-preview-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid",
  password:randomBytes(24).toString("base64url"),company:"Disposable preview selector QA"
 });
 assert.equal(created.status,200,"disposable account");
 await page.goto(base,{waitUntil:"domcontentloaded",timeout:60000});
 await page.waitForFunction(()=>window.__PP_AUTO_INTERMEDIATE_PREVIEW_V1__?.installed===true&&
  window.__PP_OPTIMIZER_DEPTH__?.installed===true&&
  window.__PP_GA_OBJECTIVE_FLOOR_V1__?.installed===true&&
  window.__PP_CONTINUATION_SEED_V2__?.installed===true&&
  !!document.querySelector('#ppLivePreview button[data-mode="candidate"]'),null,{timeout:40000});
 const initial=await page.evaluate(()=>{
  const selector=document.getElementById("ppLivePreview");
  return {
   hidden:getComputedStyle(selector).display==="none",
   buttons:selector.querySelectorAll('button[data-mode]').length,
   styleId:!!document.getElementById("ppAutoIntermediatePreviewCss"),
   auto:window.__PP_AUTO_INTERMEDIATE_PREVIEW_V1__?.installed===true,
   candidateMode:window.__PP_AUTO_INTERMEDIATE_PREVIEW_V1__?.selected,
   depth:document.getElementById("ppOptimizerDepthSelect")?.value,
   depthVisible:!!document.getElementById("ppOptimizerDepth")&&
    getComputedStyle(document.getElementById("ppOptimizerDepth")).display!=="none",
   pollEvery2s:document.documentElement.outerHTML.includes("setTimeout(()=>tick(my),2000)"),
   qualityGuard:window.__PP_GA_OBJECTIVE_FLOOR_V1__?.installed===true,
   resumeGuard:window.__PP_CONTINUATION_SEED_V2__?.installed===true,
   stopButton:!!document.getElementById("ppOptimizerStop"),
   optButton:!!document.getElementById("opt")
  }
 });
 console.log("AUTO_PREVIEW_LIVE_INITIAL",JSON.stringify(initial));
 assert.equal(initial.hidden,true,"preview mode buttons must be invisible and take no space");
 assert.equal(initial.buttons,2,"native mode buttons kept internally for renderer compatibility");
 assert.equal(initial.styleId,true);
 assert.equal(initial.auto,true);
 assert.equal(initial.candidateMode,"candidate");
 assert.equal(initial.depthVisible,true,"Optimization depth setting must remain");
 assert.equal(initial.pollEvery2s,true,"two-second intermediate polling must remain");
 assert.equal(initial.qualityGuard,true);
 assert.equal(initial.resumeGuard,true);
 assert.equal(initial.optButton,true);
 const before=await page.evaluate(()=>{
  const auto=window.__PP_AUTO_INTERMEDIATE_PREVIEW_V1__;
  const wrap=document.getElementById("ppLivePreview");
  const candidate=wrap.querySelector('button[data-mode="candidate"]');
  const best=wrap.querySelector('button[data-mode="best"]');
  window.__ppOptimizationInFlight=true;
  window.__ppStopUiLocked=false;
  candidate.disabled=true;
  candidate.classList.remove("a");
  best.classList.add("a");
  auto.refresh();
  return {switches:auto.switches,stillBest:best.classList.contains("a")};
 });
 assert.equal(before.stillBest,true,"without a new candidate, do not force empty preview");
 await page.evaluate(()=>{
  const candidate=document.querySelector('#ppLivePreview button[data-mode="candidate"]');
  candidate.disabled=false;
 });
 await page.waitForFunction(({baseline})=>{
  const auto=window.__PP_AUTO_INTERMEDIATE_PREVIEW_V1__;
  const candidate=document.querySelector('#ppLivePreview button[data-mode="candidate"]');
  const best=document.querySelector('#ppLivePreview button[data-mode="best"]');
  return auto.switches>baseline&&candidate.classList.contains("a")&&
   !best.classList.contains("a")&&window.__ppLiveMode==="candidate";
 },{baseline:before.switches},{timeout:12000});
 const active=await page.evaluate(()=>({
  selected:window.__ppLiveMode,
  clickCount:window.__PP_AUTO_INTERMEDIATE_PREVIEW_V1__?.switches,
  invisible:getComputedStyle(document.getElementById("ppLivePreview")).display==="none"
 }));
 console.log("AUTO_PREVIEW_LIVE_CANDIDATE_SELECTED",JSON.stringify(active));
 assert.equal(active.selected,"candidate");
 assert.equal(active.invisible,true);
 const stopped=await page.evaluate(()=>{
  const auto=window.__PP_AUTO_INTERMEDIATE_PREVIEW_V1__;
  window.__ppOptimizationInFlight=false;
  const selector=document.getElementById("ppLivePreview");
  const candidate=selector.querySelector('button[data-mode="candidate"]');
  const best=selector.querySelector('button[data-mode="best"]');
  candidate.classList.remove("a");
  best.classList.add("a");
  auto.refresh();
  return {switches:auto.switches,chosenBest:best.classList.contains("a")};
 });
 assert.equal(stopped.switches,active.clickCount,"do not repaint saved plan after GA completes");
 const progress=await api("/api/plan-progress");
 assert.equal(progress.status,200);
 assert.equal(progress.body.running,false,"test must not start a live worker");
 assert.deepEqual(errors,[],"automatic live preview should not cause JS exceptions");
 console.log("AUTO_INTERMEDIATE_PREVIEW_REAL_CHROMIUM_ACCEPTANCE_PASS");
}catch(e){
 console.log("AUTO_INTERMEDIATE_PREVIEW_REAL_CHROMIUM_FAIL",String(e?.stack||e).slice(0,1400));
 console.log("AUTO_INTERMEDIATE_PREVIEW_ERRORS",JSON.stringify(errors.slice(-5)));
 process.exitCode=1;
}finally{await browser.close()}
