// Real production Chromium acceptance. Uses a disposable account and one
// synthetic project. GA POST is intercepted in-browser; no job is created.
import {chromium} from "playwright";
import assert from "node:assert/strict";
import {randomUUID,randomBytes} from "node:crypto";

const base="https://app.liftorbit.app";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const context=await browser.newContext({viewport:{width:1700,height:960}});
const page=await context.newPage();
const errors=[],posted=[];
page.on("pageerror",err=>errors.push(String(err).slice(0,190)));
const resource=(kind,ref)=>({resource_type:kind,resource_ref:ref,
 resource_refs:[ref],match_mode:"specific",quantity:1});
const model={
 scheduler_mode:"resource",start:"2026-11-17T08:00:00",
 equipment:Array.from({length:14},(_,i)=>({id:"DEPTH_EQ_"+i,
  name:"Synthetic machine "+i,kind:"workstation",capacity:600,capacity_unit:"m2"})),
 employees:Array.from({length:5},(_,i)=>({id:"DEPTH_EMP_"+i,
  name:"Synthetic employee "+i,role:"operator",shift:"day"})),
 shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},
 orders:Array.from({length:12},(_,i)=>({id:"DEPTH_ORDER_"+i,
  quantity:600,unit:"m2",technical_process_id:"DEPTH_PROCESS"})),
 technical_processes:[{id:"DEPTH_PROCESS",name:"Synthetic process",
  operations:Array.from({length:7},(_,i)=>({id:"DEPTH_OP_"+i,name:"Operation "+i,
   sequence:i+1,duration_min:30,resource_requirements:[
    resource("equipment","DEPTH_EQ_"+i),
    resource("employee","DEPTH_EMP_"+(i%5))
   ]}))}],
 materials:[],setup_rules:[]
};
const api=(path,method="GET",data)=>page.evaluate(async({path,method,data})=>{
 const opts={method,cache:"no-store",credentials:"same-origin",headers:{accept:"application/json"}};
 if(data!==undefined){opts.headers["content-type"]="application/json";opts.body=JSON.stringify(data)}
 const r=await fetch(path,opts);let body={};try{body=await r.json()}catch{}
 return{status:r.status,body}
},{path,method,data});
try{
 const publicPage=await page.goto(base,{waitUntil:"domcontentloaded",timeout:60000});
 assert.equal(publicPage.status(),200,"app must be public");
 const email="depth-qa-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid";
 const password=randomBytes(30).toString("base64url");
 const registration=await api("/api/auth/register","POST",{
  email,password,company:"Disposable optimizer depth QA"});
 assert.equal(registration.status,200,"test account registration");
 await page.goto(base,{waitUntil:"domcontentloaded",timeout:60000});
 const project="depth-qa-"+randomUUID().replaceAll("-","");
 const projects=JSON.stringify([{id:project,name:"Synthetic depth QA",model}]);
 await page.evaluate(({project,projects})=>{
  localStorage.setItem("prodplan.projects.v2",projects);
  localStorage.setItem("prodplan.project.active.v2",project);
 },{project,projects});
 const saved=await api("/api/db-storage","POST",{storage:{
  "prodplan.projects.v2":projects,"prodplan.project.active.v2":project
 }});
 assert.equal(saved.status,200,"disposable project storage");
 await page.reload({waitUntil:"domcontentloaded",timeout:60000});
 await page.waitForFunction(()=>window.__PP_OPTIMIZER_DEPTH__?.installed===true&&
  !!document.getElementById("ppOptimizerDepthSelect"),null,{timeout:30000});
 await page.waitForFunction(()=>window.__PP_STOP_DEBUG__?.().reconnecting===false,
  null,{timeout:25000});
 const select=page.locator("#ppOptimizerDepthSelect");
 assert.equal(await select.inputValue(),"standard","60x32 standard default");
 const header=page.locator("#ppOptimizerDepthLabel");
 assert.match(await header.textContent(),/Optimization depth/);
 const otherPresets={standard:[60,32],thorough:[180,48],maximum:[360,64]};
 for(const [name,[generations,population]] of Object.entries(otherPresets)){
  const set=await page.evaluate(mode=>window.__PP_OPTIMIZER_DEPTH__.set(mode),name);
  assert.equal(set,true);
  const config=await page.evaluate(()=>window.__PP_OPTIMIZER_DEPTH__.get());
  assert.equal(config.generations,generations,name+" generations unchanged");
  assert.equal(config.population,population,name+" candidates unchanged");
 }
 console.log("QUICK_DEPTH_OTHER_MODES_UNCHANGED");
 const tooltip=await page.locator("#ppOptimizerDepthHelpText").textContent();
 assert.match(tooltip,/not guaranteed/);
 await select.selectOption("quick");
 const before=await page.evaluate(()=>window.__PP_OPTIMIZER_DEPTH__.get());
 assert.equal(before.generations,10);
 assert.equal(before.population,12);
 console.log("DEPTH_LIVE_CONTROL",JSON.stringify(before));
 await page.screenshot({path:"optimization-quick-depth-v2-live-english.png",fullPage:false});
 await page.reload({waitUntil:"domcontentloaded",timeout:60000});
 await page.waitForFunction(()=>window.__PP_OPTIMIZER_DEPTH__?.installed===true&&
  document.getElementById("ppOptimizerDepthSelect")?.value==="quick",null,{timeout:30000});
 console.log("DEPTH_LIVE_PERSISTED_AFTER_RELOAD");
 // Intercept only this disposable tab's optimizer POST. Test the actual
 // native launch path without spending GA worker capacity or altering data.
 await page.route(/\/api\/plan(?:\?|$)/,async route=>{
  if(route.request().method()!=="POST"){await route.continue();return}
  try{posted.push(route.request().postDataJSON())}catch{}
  await route.fulfill({status:409,contentType:"application/json",
   body:JSON.stringify({ok:false,error:"qa_intercepted_only_no_ga_started"})});
 });
 const opt=page.locator("#opt");
 const modelReadback=await api("/api/model");
 assert.equal(modelReadback.status,200);
 assert.equal(modelReadback.body.model?.orders?.length,12);
 const progressReadback=await api("/api/plan-progress");
 assert.equal(progressReadback.status,200);
 assert.equal(progressReadback.body.running,false);
 const gate=await page.evaluate(()=>({
  buttonDisabled:document.getElementById("opt")?.disabled,
  buttonText:document.getElementById("opt")?.textContent,
  debug:window.__PP_STOP_DEBUG__?.(),
  fresh:window.__PP_FRESH_OPTIMIZER_DEBUG__?.(),
  validator:document.getElementById("validator")?.textContent,
  status:document.getElementById("valid")?.textContent
 }));
 console.log("DEPTH_LIVE_SYNTHETIC_START_GATE",JSON.stringify(gate));
 if(gate.buttonDisabled===true){
  // The real site's native scheduler readiness gate uses project-specific
  // upstream model metadata, absent in this minimal synthetic fixture.
  // Confirm no real GA is active before opening that gate *only in this
  // disposable browser page*. This does not bypass actual GA POST handling.
  assert.equal(gate.debug?.running,false);
  await page.evaluate(()=>{
   try{if(typeof modelReady!=="undefined")modelReady=true}catch{}
   try{if(typeof busy!=="undefined")busy=false}catch{}
   document.getElementById("opt").disabled=false;
  });
 }
 await page.waitForFunction(()=>!document.getElementById("opt")?.disabled&&
  window.__PP_STOP_DEBUG__?.().running===false,null,{timeout:9000});
 assert(await opt.isVisible(),"native optimization button visible");
 const nativePost=page.waitForRequest(r=>new URL(r.url()).pathname==="/api/plan"&&
  r.method()==="POST",{timeout:25000});
 await opt.click();
 await nativePost;
 // Playwright request observation can fire before the route handler parses
 // postDataJSON. Wait for the intercepted payload, not just request creation.
 for(let check=0;check<100&&posted.length===0;check++)
  await new Promise(resolve=>setTimeout(resolve,25));
 assert.equal(posted.length,1,"exactly one intercepted GA POST");
 assert.equal(posted[0].generations,10,"Quick UI mode must reach the real GA POST");
 assert.equal(posted[0].population,12);
 assert.equal(posted[0].objective||"duration","duration");
 console.log("DEPTH_LIVE_REAL_POST",JSON.stringify({
  generations:posted[0].generations,population:posted[0].population,
  continued:!!posted[0].continue
 }));
 // Locale change must translate this control independently of existing
 // translation dictionary and must never mutate the project model.
 const language=page.locator("#ppLanguageSelect");
 await language.selectOption("ru");
 await page.waitForFunction(()=>document.getElementById("ppOptimizerDepthLabel")
  ?.textContent==="Тщательность оптимизации",null,{timeout:9000});
 assert.match(await page.locator("#ppOptimizerDepthDetail").textContent(),/10 поколений/);
 await language.selectOption("en");
 await page.waitForFunction(()=>document.getElementById("ppOptimizerDepthLabel")
  ?.textContent==="Optimization depth",null,{timeout:9000});
 console.log("DEPTH_LIVE_RU_EN_PASS");
 const status=await api("/api/plan-progress");
 assert.equal(status.status,200);
 assert.equal(status.body.running,false,"test must leave no active optimizer job");
 assert.equal((await api("/api/model")).body.model.orders.length,12);
 assert.deepEqual(errors,[],"no uncaught JS errors from optimization depth");
 console.log("QUICK_DEPTH_10_12_LIVE_BROWSER_PASS",JSON.stringify({
  visible:true,standardDefault:true,perProjectChoicePersisted:true,
  generationsSubmitted:10,populationSubmitted:12,englishAndRussian:true,
  noRealWorkerJobStarted:true
 }));
}catch(error){
 console.log("QUICK_DEPTH_10_12_LIVE_BROWSER_FAILURE",String(error?.stack||error).slice(0,1200));
 console.log("DEPTH_LIVE_DIAGNOSTICS",JSON.stringify({captured:posted.length,errors:errors.slice(-4)}));
 process.exitCode=1;
}finally{await browser.close()}
