import {chromium} from "playwright-core";
import assert from "node:assert/strict";
import {randomUUID,randomBytes} from "node:crypto";
const base="https://app.liftorbit.app";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1600,height:900}});
const errors=[];
page.on("pageerror",e=>errors.push(String(e).slice(0,180)));
const request=(path,method="GET",data)=>page.evaluate(async({path,method,data})=>{
 const init={method,cache:"no-store",credentials:"same-origin",headers:{accept:"application/json"}};
 if(data!==undefined){init.headers["content-type"]="application/json";init.body=JSON.stringify(data)}
 const r=await fetch(path,init);let body={};try{body=await r.json()}catch{}
 return {status:r.status,body};
},{path,method,data});
try{
 const first=await page.goto(base,{waitUntil:"domcontentloaded",timeout:60000});
 assert.equal(first.status(),200);
 const registered=await request("/api/auth/register","POST",{
  email:"ga-meta-qa-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid",
  password:randomBytes(26).toString("base64url"),company:"Disposable technical label QA"
 });
 assert.equal(registered.status,200);
 await page.goto(base,{waitUntil:"domcontentloaded",timeout:60000});
 await page.waitForFunction(()=>window.__PP_HIDE_GA_TECHNICAL_LABELS_V1__?.installed===true&&
  window.__PP_STOP_RESTORE_PREVIOUS_V1__?.installed===true&&
  window.__PP_OPTIMIZER_DEPTH__?.installed===true&&
  !!document.getElementById("ppOptimizerDepthSelect"),null,{timeout:40000});
 await page.evaluate(()=>window.__PP_HIDE_GA_TECHNICAL_LABELS_V1__.refresh());
 const observed=await page.evaluate(()=>{
  const hidden=el=>!el||getComputedStyle(el).display==="none";
  const cssSelectors=["meta","valid","ppOptimizerDepthDetail","ppOptimizerDepthHelp"];
  const css=Object.fromEntries(cssSelectors.map(id=>{
   const el=document.getElementById(id);
   return [id,{exists:!!el,hidden:hidden(el),text:(el?.textContent||"").trim().slice(0,140)}];
  }));
  const nodes=[...document.querySelectorAll("#planView span,#planView small,#planView output,#planView div")]
   .filter(el=>el.children.length===0&&/^\s*GA\s*core\s*:/i.test(el.textContent||""))
   .slice(0,10)
   .map(el=>({tag:el.tagName,id:el.id,cls:String(el.className||"").slice(0,100),
     text:el.textContent.trim().slice(0,100),
     hidden:getComputedStyle(el).display==="none",
     ownHidden:el.getAttribute("data-pp-ga-tech-hidden"),
     parent:el.parentElement?.id||el.parentElement?.className||""}));
  const select=document.getElementById("ppOptimizerDepthSelect");
  const objective=document.querySelector("#planView .toolbar select:not(#ppOptimizerDepthSelect)");
  const start=document.getElementById("opt");
  const stop=document.getElementById("ppStopOptimizer");
  const root=document.getElementById("planView");
  return {
   installed:window.__PP_HIDE_GA_TECHNICAL_LABELS_V1__.installed,
   countHidden:window.__PP_HIDE_GA_TECHNICAL_LABELS_V1__.hiddenPills,
   css,nodes,
   select:{exists:!!select,visible:select?getComputedStyle(select).display!=="none":false,value:select?.value},
   objective:{exists:!!objective,visible:objective?getComputedStyle(objective).display!=="none":false},
   opt:{exists:!!start,visible:start?getComputedStyle(start).display!=="none":false},
   stop:{exists:!!stop},
   gantt:{exists:!!root?.querySelector("#gantt"),existsRows:!!root?.querySelector("#equipGantt")},
   autoPreview:window.__PP_AUTO_INTERMEDIATE_PREVIEW_V1__?.installed===true
  };
 });
 console.log("GA_LABELS_LIVE_BROWSER_DOM",JSON.stringify(observed));
 assert.equal(observed.installed,true);
 for(const id of ["meta","valid","ppOptimizerDepthDetail","ppOptimizerDepthHelp"]){
  assert.equal(observed.css[id].exists,true,id+" exists");
  assert.equal(observed.css[id].hidden,true,id+" is not visible");
 }
 assert(observed.nodes.length>=1,"GA core/version pill must be found");
 assert(observed.nodes.every(n=>n.hidden===true),"GA core/version pill must be hidden");
 assert.equal(observed.select.exists,true);
 assert.equal(observed.select.visible,true);
 assert.equal(observed.objective.exists,true);
 assert.equal(observed.objective.visible,true);
 assert.equal(observed.opt.exists,true);
 assert.equal(observed.autoPreview,true);
 const progress=await request("/api/plan-progress");
 assert.equal(progress.status,200);
 assert.equal(progress.body.running,false,"QA must not start any worker");
 assert.deepEqual(errors,[],"no JS exceptions");
 console.log("GA_LABELS_LIVE_CHROME_CLEANUP_ACCEPTANCE_PASS");
}catch(error){
 console.log("GA_LABELS_LIVE_CHROME_CLEANUP_FAIL",String(error?.stack||error).slice(0,1450));
 console.log("GA_LABELS_LIVE_BROWSER_ERRORS",JSON.stringify(errors.slice(-5)));
 process.exitCode=1;
}finally{await browser.close()}
