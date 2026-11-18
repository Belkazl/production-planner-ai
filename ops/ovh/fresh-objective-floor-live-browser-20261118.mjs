import {chromium} from "playwright";
import assert from "node:assert/strict";
import {randomUUID,randomBytes} from "node:crypto";

const base="https://app.liftorbit.app";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const ctx=await browser.newContext({viewport:{width:1620,height:920}});
const page=await ctx.newPage();
const errors=[],posted=[];
page.on("pageerror",e=>errors.push(String(e).slice(0,240)));
const resource=(kind,id)=>({resource_type:kind,resource_ref:id,resource_refs:[id],match_mode:"specific",quantity:1});
const model={
 scheduler_mode:"resource",start:"2026-11-18T08:00:00",
 equipment:Array.from({length:14},(_,i)=>({id:"TEST_EQ_"+i,name:"Fixture equipment "+i,
  kind:"workstation",capacity:600,capacity_unit:"m2"})),
 employees:Array.from({length:5},(_,i)=>({id:"TEST_EMP_"+i,name:"Fixture operator "+i,
  role:"operator",shift:"day"})),
 shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},
 orders:Array.from({length:12},(_,i)=>({id:"TEST_ORDER_"+i,
  quantity:600,unit:"m2",technical_process_id:"TEST_PROCESS"})),
 technical_processes:[{id:"TEST_PROCESS",name:"Fixture process",
  operations:Array.from({length:7},(_,i)=>({id:"TEST_OP_"+i,
    name:"Operation "+i,sequence:i+1,duration_min:30,
    resource_requirements:[resource("equipment","TEST_EQ_"+i),
      resource("employee","TEST_EMP_"+(i%5))]}))}],
 materials:[],setup_rules:[]
};
const operations=Array.from({length:84},(_,i)=>({
 order:"TEST_ORDER_"+Math.floor(i/7),operation_id:"TEST_OP_"+(i%7),
 operation_name:"Operation "+(i%7),
 equipment_ids:["TEST_EQ_"+(i%7)],employee_ids:["TEST_EMP_"+((i%7)%5)],
 resources:[{resource_type:"equipment",id:"TEST_EQ_"+(i%7)}],
 start_min:i*45,end_min:i*45+30,duration_min:30,sequence:(i%7)+1,
 quantity:600,is_setup:false,phase:"process",batch:Math.floor(i/7)+1
}));
const prior={
 ok:true,valid:true,partial:false,_revision:7,
 duration_minutes:4355,batch_count:118,operator_wait_minutes:412575,
 machine_idle_minutes:17461,operations,generic_operations:operations,
 order_sequence:model.orders.map(x=>x.id),objective:"duration"
};
const worse={...prior,duration_minutes:9080,operator_wait_minutes:420868,
 machine_idle_minutes:69048,optimization_run:2,total_generations:40,
 _revision:7};
const api=(path,method="GET",data)=>page.evaluate(async({path,method,data})=>{
 const opts={method,cache:"no-store",credentials:"same-origin",headers:{accept:"application/json"}};
 if(data!==undefined){opts.headers["content-type"]="application/json";opts.body=JSON.stringify(data)}
 const r=await fetch(path,opts);let body={};try{body=await r.json()}catch{}
 return {status:r.status,body};
},{path,method,data});
let project="";
try {
 const first=await page.goto(base,{waitUntil:"domcontentloaded",timeout:60000});
 assert.equal(first.status(),200);
 const registered=await api("/api/auth/register","POST",{email:"floor-qa-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid",
   password:randomBytes(27).toString("base64url"),company:"Disposable GA objective floor acceptance"});
 assert.equal(registered.status,200,"disposable account registration");
 await page.goto(base,{waitUntil:"domcontentloaded",timeout:60000});
 project="floor-qa-"+randomUUID().replaceAll("-","");
 const list=JSON.stringify([{id:project,name:"Disposable objective floor fixture",
  revision:7,model,lastPlan:prior}]);
 await page.evaluate(({project,list})=>{
  localStorage.setItem("prodplan.project.active.v2",project);
  localStorage.setItem("prodplan.projects.v2",list);
 },{project,list});
 const stored=await api("/api/db-storage","POST",{storage:{
  "prodplan.projects.v2":list,"prodplan.project.active.v2":project
 }});
 assert.equal(stored.status,200,"fixture storage");
 await page.reload({waitUntil:"domcontentloaded",timeout:60000});
 await page.waitForFunction(()=>window.__ppFreshOptimizerUiInstalled===true&&
   !!document.getElementById("ppOptimizerStartOver"),null,{timeout:35000});
 await page.waitForFunction(()=>window.__PP_STOP_DEBUG__?.().reconnecting===false,null,{timeout:20000});
 const frontDiag=await page.evaluate(()=>({
  scriptCount:document.scripts.length,
  rootContains:document.documentElement.outerHTML.includes("ppFreshFloor"),
  scriptContains:[...document.scripts].some(s=>s.textContent.includes("ppFreshFloor")),
  incumbentDecision:document.documentElement.outerHTML.includes("ppIncumbentDecision"),
  gaScript:document.documentElement.outerHTML.includes("ppFreshObjectiveFloor"),
  title:document.title
 }));
 console.log("FLOOR_LIVE_SCRIPT_DIAGNOSTICS",JSON.stringify(frontDiag));
 assert(frontDiag.scriptContains,"fresh objective floor must be installed on public HTML");
 const baseline=await api("/api/model");
 assert.equal(baseline.status,200);assert.equal(baseline.body.model?.orders?.length,12);
 const running=await api("/api/plan-progress");
 assert.equal(running.status,200);assert.equal(running.body.running,false);
 await page.route(/\/api\/plan(?:\?|$)/,async route=>{
  if(route.request().method()!=="POST"){await route.continue();return;}
  try{posted.push(route.request().postDataJSON())}catch{}
  await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(worse)});
 });
 // Set the exact restart flags created by the real Start over button.
 // Avoid a real worker job; the native optimizer click still runs its
 // actual completion logic and accepts a mocked synthetic candidate.
 await page.evaluate(({project,prior})=>{
   window.__ppFreshRestartMode=true;
   window.__ppFreshRestartPending=true;
   window.__ppFreshRestartProject=project;
   window.__ppFreshDisplayBaseline=prior;
   window.__ppOptimizerCommittedPlan=null;
   window.__ppTabPlan=null;
   window.__ppGenericPlan=null;
   try{if(typeof hasResult!=="undefined")hasResult=false}catch{}
   try{if(typeof modelReady!=="undefined")modelReady=true}catch{}
   try{if(typeof busy!=="undefined")busy=false}catch{}
   const b=document.getElementById("opt");if(b)b.disabled=false;
 },{project,prior});
 const opt=page.locator("#opt");
 const request=page.waitForRequest(r=>new URL(r.url()).pathname==="/api/plan"&&r.method()==="POST",{timeout:25000});
 await opt.click();
 await request;
 await page.waitForFunction(()=>!window.__ppOptimizationInFlight,null,{timeout:30000});
 const finished=await page.evaluate(()=>({
  committed:window.__ppOptimizerCommittedPlan?.duration_minutes,
  shown:window.__ppTabPlan?.duration_minutes,
  validator:document.getElementById("validator")?.textContent||"",
  metric:document.getElementById("makespan")?.textContent||"",
  freshPending:window.__ppFreshRestartPending
 }));
 console.log("FLOOR_GA_NATIVE_POST",JSON.stringify({count:posted.length,continued:!!posted[0]?.continue,
  resume:!!posted[0]?.resume_plan}));
 console.log("FLOOR_GA_RESULT",JSON.stringify(finished));
 assert.equal(posted.length,1,"one native optimization call");
 assert.equal(posted[0]?.continue||false,false,"fresh optimization must not continue");
 assert.equal(finished.committed,4355,"worse 9080-minute candidate must never become committed");
 assert.notEqual(finished.shown,9080,"visible plan must never regress to 9080");
 assert.equal((await api("/api/plan-progress")).body.running,false);
 assert.deepEqual(errors,[],"no JavaScript errors from fresh optimizer");
 console.log("FRESH_OBJECTIVE_FLOOR_REAL_CHROMIUM_PASS");
}catch(e){
 console.log("FRESH_OBJECTIVE_FLOOR_REAL_CHROMIUM_FAIL",String(e?.stack||e).slice(0,1550));
 console.log("FRESH_OBJECTIVE_FLOOR_DIAGNOSTICS",JSON.stringify({posted:posted.length,errors:errors.slice(-7),project}));
 process.exitCode=1;
}finally{await browser.close()}
