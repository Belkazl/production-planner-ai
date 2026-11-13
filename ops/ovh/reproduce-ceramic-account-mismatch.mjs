// Reproduce account_plan_mismatch with the original public ceramics demo.
// No customer's data is fetched. No plans or data are persisted outside this
// disposable synthetic test account. Log only counts and coarse classifications.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { randomUUID,randomBytes } from "node:crypto";
const BASE="https://app.liftorbit.app";
const FIXTURE="https://aps-setup-bridge-candidate-v2-production.up.railway.app/";
const pause=ms=>new Promise(ok=>setTimeout(ok,ms));
async function run(){
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 let model;
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.goto(FIXTURE,{waitUntil:"domcontentloaded",timeout:60000});
  await page.waitForFunction(()=>typeof window.model!=="undefined"&&Array.isArray(window.model?.orders)&&window.model.orders.length>=12,{timeout:60000});
  model=await page.evaluate(()=>structuredClone(window.model));
  console.log("CERAMIC_SOURCE_MODEL",JSON.stringify({
    orders:model.orders?.length,equipment:model.equipment?.length,
    employees:model.employees?.length,ops:model.technical_processes?.reduce((n,x)=>n+(x.operations?.length||0),0),
    quantity:model.orders?.reduce((n,o)=>n+(+o.quantity||+o.area||0),0),
    model_keys:Object.keys(model).sort().filter(x=>["orders","employees","equipment","materials","setup_rules","shifts","technical_processes"].includes(x))
  }));
 }finally{await browser.close();}
 assert(model?.orders?.length>=12,"public ceramic demo unavailable");
 let cookie="";
 const request=async(path,method="GET",data)=>{
  const h={accept:"application/json",origin:BASE,"sec-fetch-site":"same-origin"};
  if(cookie)h.cookie=cookie;
  if(data!==undefined)h["content-type"]="application/json";
  const response=await fetch(BASE+path,{method,headers:h,body:data===undefined?undefined:JSON.stringify(data),redirect:"manual",signal:AbortSignal.timeout(30000)});
  if(path==="/api/auth/register")cookie=(response.headers.get("set-cookie")||"").split(";")[0];
  let body={};
  try{body=await response.json()}catch{}
  return {status:response.status,body};
 };
 const email="ga-ceramic-qa-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid";
 const register=await request("/api/auth/register","POST",{email,password:randomBytes(30).toString("base64url"),company:"Isolated ceramic model QA"});
 assert.equal(register.status,200,"register");
 const active="ga-ceramic-"+randomUUID().replaceAll("-","");
 const stored=await request("/api/db-storage","POST",{storage:{
   "prodplan.projects.v2":JSON.stringify([{id:active,name:"Public ceramic fixture",model}]),
   "prodplan.project.active.v2":active
 }});
 assert.equal(stored.status,200,"storage");
 const readback=await request("/api/model");
 assert.equal(readback.status,200,"readback");
 console.log("CERAMIC_MODEL_STORED",JSON.stringify({orders:readback.body.model?.orders?.length,
   equipment:readback.body.model?.equipment?.length,employees:readback.body.model?.employees?.length}));
 const start=await request("/api/plan","POST",{generations:15000,population:80,seed:1729,objective:"duration",__pp_async_start:true});
 console.log("CERAMIC_GA_START",JSON.stringify({status:start.status,started:start.body.started===true,error:start.body.error||null}));
 assert.equal(start.status,202,"ga start");
 let last,errors=0,running=true;
 try{
  for(let i=0;i<65;i++){
   await pause(3100);
   const result=await request("/api/plan-progress");
   const data=result.body||{};
   const useful={sample:i,status:result.status,phase:data.phase||null,
      running:data.running,best_ops:data.best_preview?.operations?.length||0,
      candidate_ops:data.candidate_preview?.operations?.length||0,
      result_ops:data.result?.operations?.length||0,
      error:data.error||null,success:data.success||false};
   if(i<2||i%5===0||result.status!==200||data.running===false)console.log("CERAMIC_GA_PROGRESS",JSON.stringify(useful));
   last={result,useful};if(result.status===409){errors++;break;}
   if(data.running===false){running=false;break;}
  }
 }finally{
  if(running){
   const stop=await request("/api/optimizer-stop","POST",{});
   console.log("CERAMIC_GA_CLEANUP",stop.status);
  }
 }
 console.log("CERAMIC_GA_DIAGNOSIS",JSON.stringify({status:last?.result.status,
  error:last?.result.body?.error||null,stage:last?.useful.phase,
  mismatchReproduced:errors>0}));
 if(last?.result.status===409&&last?.result.body?.error==="account_plan_mismatch")process.exitCode=5;
}
run().catch(e=>{console.error("CERAMIC_DIAGNOSTIC_FAIL",e?.name||"Error",String(e?.message||"").slice(0,120));process.exitCode=1});
