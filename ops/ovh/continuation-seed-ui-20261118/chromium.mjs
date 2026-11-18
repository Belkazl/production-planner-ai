import {chromium} from "playwright";
import assert from "node:assert/strict";
import {randomUUID,randomBytes} from "node:crypto";

const base="https://app.liftorbit.app";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1680,height:940}});
const posted=[],errors=[];
page.on("pageerror",e=>errors.push(String(e).slice(0,160)));
const ids=Array.from({length:12},(_,i)=>"CONT_QA_ORDER_"+i);
const resource=(kind,id)=>({resource_type:kind,resource_ref:id,
 resource_refs:[id],match_mode:"specific",quantity:1});
const model={
 scheduler_mode:"resource",start:"2026-11-18T08:00:00",
 equipment:Array.from({length:14},(_,i)=>({id:"CONT_QA_EQ_"+i,name:"QA equipment "+i,
  kind:"workstation",capacity:600,capacity_unit:"m2"})),
 employees:Array.from({length:4},(_,i)=>({id:"CONT_QA_EMP_"+i,name:"QA operator "+i,role:"operator",shift:"day"})),
 shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},
 orders:ids.map(id=>({id,quantity:80,unit:"m2",technical_process_id:"CONT_QA_PROCESS"})),
 technical_processes:[{id:"CONT_QA_PROCESS",name:"Test workflow",
  operations:Array.from({length:5},(_,i)=>({id:"CONT_QA_OP_"+i,name:"Step "+i,
   sequence:i+1,duration_min:30,resource_requirements:[
    resource("equipment","CONT_QA_EQ_"+i),resource("employee","CONT_QA_EMP_"+(i%4))
   ]}))}],
 materials:[],setup_rules:[]
};
const operations=Array.from({length:120},(_,i)=>({
 order:ids[i%12],operation_id:"CONT_QA_OP_"+(i%5),
 equipment_ids:["CONT_QA_EQ_"+(i%14)],
 employee_ids:["CONT_QA_EMP_"+(i%4)],
 start_min:i*40,end_min:i*40+30,
 is_setup:i<10,phase:i<10?"setup":"process"
}));
const plan={ok:true,valid:true,partial:false,_revision:7,
 operations,duration_minutes:4376,batch_count:118,
 machine_idle_minutes:17688,operator_wait_minutes:419554};
const api=(path,method="GET",payload)=>page.evaluate(async({path,method,payload})=>{
 const init={method,credentials:"same-origin",cache:"no-store",headers:{accept:"application/json"}};
 if(payload!==undefined){init.headers["content-type"]="application/json";init.body=JSON.stringify(payload)}
 const r=await fetch(path,init);let body={};try{body=await r.json()}catch{}
 return {status:r.status,body}
},{path,method,payload});
try{
 await page.goto(base,{waitUntil:"domcontentloaded",timeout:60000});
 const register=await api("/api/auth/register","POST",{
  email:"continue-qa-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid",
  password:randomBytes(27).toString("base64url"),
  company:"Disposable continuation seed diagnostic"
 });
 assert.equal(register.status,200);
 await page.goto(base,{waitUntil:"domcontentloaded",timeout:60000});
 const project="continue-qa-"+randomUUID().replaceAll("-","");
 const projects=JSON.stringify([{id:project,name:"Disposable continuation QA",model,
  revision:7,lastPlan:plan}]);
 await page.evaluate(({projects,project})=>{
  localStorage.setItem("prodplan.projects.v2",projects);
  localStorage.setItem("prodplan.project.active.v2",project);
 },{projects,project});
 const saved=await api("/api/db-storage","POST",{storage:{
  "prodplan.projects.v2":projects,"prodplan.project.active.v2":project
 }});
 assert.equal(saved.status,200);
 await page.reload({waitUntil:"domcontentloaded",timeout:60000});
 await page.waitForFunction(()=>window.__PP_CONTINUATION_SEED_V2__?.installed===true&&
  window.__PP_OPTIMIZER_DEPTH__?.installed===true&&
  window.__PP_STOP_DEBUG__?.().reconnecting===false,
  null,{timeout:40000});
 assert.equal(await page.evaluate(()=>window.__PP_OPTIMIZER_DEPTH__.set("quick")),true);
 const status=await api("/api/plan-progress");
 assert.equal(status.status,200);
 assert.equal(status.body.running,false);
 await page.route(/\/api\/plan(?:\?|$)/,async route=>{
  if(route.request().method()!=="POST"){await route.continue();return}
  try{posted.push(route.request().postDataJSON())}catch{}
  await route.fulfill({status:409,contentType:"application/json",
   body:JSON.stringify({ok:false,error:"qa_intercepted_no_worker_started"})});
 });
 const opt=page.locator("#opt");
 await page.evaluate(plan=>{
  try{if(typeof modelReady!=="undefined")modelReady=true}catch{}
  try{if(typeof busy!=="undefined")busy=false}catch{}
  try{if(typeof hasResult!=="undefined")hasResult=true}catch{}
  window.__ppTabPlan=plan;
  window.__ppOptimizerCommittedPlan=plan;
  const button=document.getElementById("opt");
  if(button)button.disabled=false;
 },plan);
 const gaReq=page.waitForRequest(req=>new URL(req.url()).pathname==="/api/plan"&&
  req.method()==="POST",{timeout:26000});
 await opt.click();
 await gaReq;
 for(let i=0;i<160&&!posted.length;i++)await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal(posted.length,1,"native Continue should issue exactly one GA POST");
 const payload=posted[0];
 console.log("CONTINUE_LIVE_NATIVE_POST",JSON.stringify({
  continued:payload.continue,continueRun:payload.continue_run,
  generations:payload.generations,population:payload.population,
  orderCount:payload.resume_plan?.order_sequence?.length,
  hasTrustedScore:Object.hasOwn(payload.resume_plan||{},"duration_minutes")
 }));
 assert.equal(Boolean(payload.continue||payload.continue_run),true);
 assert.equal(payload.generations,10);
 assert.equal(payload.population,12);
 assert.deepEqual(new Set(payload.resume_plan?.order_sequence||[]),new Set(ids));
 assert.equal(Object.hasOwn(payload.resume_plan,"duration_minutes"),false);
 assert.equal(await page.evaluate(()=>window.__PP_CONTINUATION_SEED_V2__?.lastSeedLength),12);
 const after=await api("/api/plan-progress");
 assert.equal(after.body.running,false,"browser interception must never start a GA worker");
 assert.equal((await api("/api/model")).body.model.orders.length,12);
 assert.deepEqual(errors,[]);
 console.log("CONTINUE_SEED_REAL_CHROMIUM_RELOAD_AND_NATIVE_POST_PASS");
}catch(err){
 console.log("CONTINUE_SEED_REAL_CHROMIUM_FAIL",String(err?.stack||err).slice(0,1350));
 console.log("CONTINUE_SEED_DIAGNOSTIC",JSON.stringify({posted:posted.length,errors:errors.slice(-5)}));
 process.exitCode=1;
}finally{await browser.close()}
