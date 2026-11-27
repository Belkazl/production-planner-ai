import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-ga-status-test/node_modules/playwright-core");
const base="https://app.liftorbit.app",live=process.env.PP_CALCULATION_MODES_LIVE==="1";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:45000});
 const register=await page.evaluate(async({email,password})=>(await fetch("/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,company:"Synthetic GA status QA"})})).status,{email:"ga-status-qa-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(25).toString("base64url")});
 assert.equal(register,200);
 // Open a valid synthetic project, since the empty-account Projects screen
 // hides the planner chat until a project is active.
 const id="prj_units_"+randomUUID().replaceAll("-","").slice(0,13);
 const seeded=await page.evaluate(async id=>{
  const model={scheduler_mode:"resource",quantity_unit:"m2",start:"2026-11-25T00:00:00",
   equipment:[{id:"M1",__ppid:"M1",name:"Тестовый пресс",kind:"pressing",process_multiplier:0.8,capabilities:{allowed_parameters:{color:["A"]}},capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"throughput",throughput_per_hour:900}},{id:"M2",__ppid:"M2",name:"Тестовая печь",kind:"firing",process_multiplier:1.2,capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"fixed",duration_min:10}},{id:"M3",__ppid:"M3",name:"Synthetic flow oven",kind:"drying",capacity:200,capacity_unit:"m2",process_multiplier:0.8,timing_profile:{timing_mode:"flow",throughput_per_hour:600,residence_min:5}},{id:"M4",__ppid:"M4",name:"Synthetic legacy",kind:"pressing",capacity:200,capacity_unit:"m2",process_multiplier:1.3}],
   orders:[{id:"2601",quantity:200,area:200,unit:"m2",technical_process_id:"P",parameters:{color:"A"}}],
   employees:[{id:"E1",name:"Synthetic operator",role:"operator",shift:"day"}],materials:[{id:'M',name:'Synthetic powder',unit:'kg',initial_stock:1000,deliveries:[]}],shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},constraints:[],setup_rules:[],
   technical_processes:[{id:"P",name:"Synthetic process",operations:[{id:"OP",name:"Press",sequence:1,duration_min:10,resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"M1",resource_refs:["M1"],quantity:1,unit:"pcs"},{resource_type:"employee",match_mode:"specific",resource_ref:"E1",resource_refs:["E1"],quantity:1,unit:"pcs",consumption_rule:"during_operation"}]},{id:"OP2",name:"Fire",sequence:2,duration_min:10,resource_requirements:[{resource_type:"equipment",match_mode:"any",resource_ref:"kind:firing",resource_refs:["kind:firing"],quantity:1,unit:"pcs"}]}]}]};
  model.autoclaves=structuredClone(model.equipment);
  const plan=null;
  const storage={"prodplan.projects.v2":JSON.stringify([{id,name:"Тестовый проект",model,revision:1,lastPlan:plan,updatedAt:"2026-11-27T10:00:00Z",createdAt:"2026-11-27T09:00:00Z"},{id:id+"_second",name:"Копия",model:structuredClone(model),revision:1,lastPlan:plan,updatedAt:"2026-11-27T10:00:00Z"} ]),"prodplan.project.active.v2":id};
  return (await fetch("/api/db-storage",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({storage})})).status;
 },id);
 assert.equal(seeded,200);
 const requests=[],errors=[];
 const watched=new Set(["/api/plan-progress","/api/plan","/api/plan-events","/api/model","/api/db-storage"]);
 page.on("response",r=>{const p=new URL(r.url()).pathname;if(watched.has(p))requests.push({path:p,method:r.request().method(),status:r.status()})});
 page.on("requestfailed",r=>{const p=new URL(r.url()).pathname;if(watched.has(p))requests.push({path:p,method:r.method(),failure:r.failure()?.errorText})});
 page.on("pageerror",e=>errors.push(String(e.message).slice(0,150)));
 const probe=()=>page.evaluate(async()=>{
  const r=await fetch("/api/plan-progress",{credentials:"same-origin",cache:"no-store",signal:AbortSignal.timeout(12000)});
  let d={};try{d=await r.json()}catch{}
  return {status:r.status,phase:d.phase??null,ok:d.ok??null,running:d.running??null,percent:d.percent??null,error:typeof d.error==="string"&&/^[a-z0-9_-]{1,100}$/i.test(d.error)?d.error:null}
 });
 const view=()=>page.evaluate(()=>({opt:document.querySelector("#opt")?.textContent?.trim(),disabled:document.querySelector("#opt")?.disabled,unavailable:document.body.innerText.includes("Could not check GA status"),reconnecting:window.__PP_STOP_DEBUG__?.()?.reconnecting??null,active:window.__PP_SSE_PROGRESS_V1__?.state?.active??null}));
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>typeof model==="object"&&model?.orders?.length===1&&document.getElementById("opt"),null,{timeout:30000});
 if(await page.evaluate(()=>document.body.classList.contains("projects-mode")))await page.locator(".top .nav > span").filter({hasText:/^(Planning|Планирование)$/}).click();
 await page.locator(".side .item").filter({hasText:/^(Plan|План)$/}).click();
 await page.waitForTimeout(1500);
 const before=await probe().catch(e=>({error:e.name}));
 console.log("GA_STATUS_PROBE_INITIAL",JSON.stringify({before,view:await view(),requests,errors}));
 if(before.status!==200||before.ok===false||before.running===true)throw Error("GA_STATUS_INITIAL_NOT_HEALTHY");
 await page.waitForFunction(()=>!document.getElementById("opt")?.disabled,null,{timeout:20000});
 await page.locator("#opt").click({timeout:10000});
 let done=false;
 const deadline=Date.now()+95000;
 while(Date.now()<deadline){
  const v=await page.evaluate(()=>({s:window.__PP_SSE_PROGRESS_V1__?.state?.completed??false,p:window.__PP_SSE_PROGRESS_V1__?.state?.percent??null}));
  if(v.s){done=true;break}
  if(requests.some(r=>r.path==="/api/plan"&&r.status>=400))break;
  await page.waitForTimeout(700);
 }
 const after=await probe().catch(e=>({error:e.name}));
 console.log("GA_STATUS_PROBE_FINISH",JSON.stringify({done,after,view:await view(),requests,errors}));
 assert(done,"test optimization did not complete");
 assert.equal(after.status,200);
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>typeof model==="object"&&model?.orders?.length===1,null,{timeout:30000});
 const reopened=await probe().catch(e=>({error:e.name}));
 console.log("GA_STATUS_PROBE_REOPEN",JSON.stringify({reopened,view:await view(),errors}));
 assert.equal(reopened.status,200);
 console.log("GA_STATUS_LIVE_PASS");
}finally{await browser.close()}
