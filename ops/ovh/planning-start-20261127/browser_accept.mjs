import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {patchPreview} from "./patch.mjs";
import {ppPlanningStartMinute} from "./shared.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-planning-start-test/node_modules/playwright-core");
const live=process.env.PP_PLANNING_START_LIVE==="1";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900},timezoneId:"Europe/Ljubljana"});
 const request=(path,method="GET",body)=>page.evaluate(async({path,method,body})=>{
  const r=await fetch(path,{method,credentials:"same-origin",cache:"no-store",...(body?{headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{})});
  return {status:r.status,data:await r.json().catch(()=>({}))};
 },{path,method,body});
 await page.goto("https://app.liftorbit.app/",{waitUntil:"domcontentloaded",timeout:45000});
 assert.equal((await request("/api/auth/register","POST",{email:"planning-start-qa-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(25).toString("base64url"),company:"Synthetic planning start QA"})).status,200);
 const id="prj_start_"+randomUUID().replaceAll("-","").slice(0,13);
 const m={scheduler_mode:"resource",quantity_unit:"m2",start:"2026-10-05T08:00:00",
  equipment:[{id:"M1",__ppid:"M1",name:"QA press",kind:"pressing",capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"fixed",duration_min:30}}],
  orders:[{id:"2601",quantity:200,area:200,unit:"m2",technical_process_id:"P",process_hours:1,parameters:{color:"A"},ship_by:"2099-12-01T08:00"},{id:"2602",quantity:200,area:200,unit:"m2",technical_process_id:"P",process_hours:1,parameters:{color:"A"}}],
  employees:[{id:"E1",name:"QA operator",role:"operator",shift:"day"}],materials:[{id:"M",name:"QA material",unit:"kg",initial_stock:1000,deliveries:[]}],shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},constraints:[],setup_rules:[],
  technical_processes:[{id:"P",name:"QA process",operations:[{id:"OP",name:"Press",sequence:1,duration_min:30,resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"M1",resource_refs:["M1"],quantity:1,unit:"pcs"},{resource_type:"employee",match_mode:"specific",resource_ref:"E1",resource_refs:["E1"],quantity:1,unit:"pcs",consumption_rule:"during_operation"}]}]}]};
 m.autoclaves=structuredClone(m.equipment);
 const record={id,name:"Synthetic planning start QA",model:m,revision:1,lastPlan:null};
 assert.equal((await request("/api/db-storage","POST",{storage:{"prodplan.projects.v2":JSON.stringify([record,{...record,id:id+"_other",model:structuredClone(m)}]),"prodplan.project.active.v2":id}})).status,200);
 if(!live)await page.route("**/",async route=>{
  if(!route.request().isNavigationRequest()||new URL(route.request().url()).pathname!=="/")return route.continue();
  const response=await route.fetch(),old=await response.text(),out=patchPreview(old);
  assert.notEqual(out,old,"authenticated page must receive start controls");assert.equal(patchPreview(out),out);
  await route.fulfill({response,body:out,headers:{...response.headers(),"content-type":"text/html; charset=utf-8"}});
 });
 const errors=[];page.on("pageerror",e=>errors.push(e.message.slice(0,200)));
 const ready=async()=>{
  await page.reload({waitUntil:"domcontentloaded",timeout:45000});
  await page.waitForFunction(()=>window.__PP_PLANNING_START_V1__&&typeof model==="object"&&model?.orders?.length===2,null,{timeout:30000});
  await page.locator("#ppLanguageSelect").selectOption("en");
  if(await page.evaluate(()=>document.body.classList.contains("projects-mode")))await page.locator(".top .nav > span").filter({hasText:/^(Planning|Планирование)$/}).click();
  await page.locator(".side .item").filter({hasText:/^(Plan|План)$/}).click();
  await page.locator("#ppPlanningStartDate").waitFor({state:"visible"});
 };
 const db=async()=>{
  const r=await request("/api/db-storage");assert.equal(r.status,200);
  return JSON.parse(r.data.storage["prodplan.projects.v2"]);
 };
 const field=async()=>await page.locator("#ppPlanningStartDate").inputValue()+"T"+await page.locator("#ppPlanningStartTime").inputValue();
 const current=()=>page.evaluate(()=>ppPlanningStartNow());
 const waitSaved=async()=>{await page.waitForFunction(()=>document.querySelector(".pp-planning-start-status")?.textContent.includes("Saved")&&!window.__ppPlanningStartSaving,null,{timeout:45000});};
 const persistDate=async(value)=>{
  await page.locator("#ppPlanningStartDate").fill(value.slice(0,10));
  await page.locator("#ppPlanningStartTime").fill(value.slice(11,16));
  await page.locator("#ppPlanningStartApply").click();
  await waitSaved();
  assert.equal(await field(),value);
  const rows=await db(),saved=rows.find(p=>p.id===id);
  assert.equal(ppPlanningStartMinute(saved.model.start),value);
  assert.equal(saved.model.planning_start_initialized,true);
  assert.equal(saved.model.orders[0].ship_by,m.orders[0].ship_by);
  assert.equal(rows.find(p=>p.id===id+"_other").model.start,m.start);
  return saved;
 };
 await ready();
 assert.equal(await field(),await current(),"initial start defaults to local wall clock");
 assert.equal((await db()).find(p=>p.id===id).model.start,m.start,"opening must not mutate the project");
 const future=await page.evaluate(()=>{const d=new Date();d.setDate(d.getDate()+1);while(d.getDay()===0||d.getDay()===6)d.setDate(d.getDate()+1);d.setHours(8,0,0,0);return ppPlanningStartNow(d)});
 let saved=await persistDate(future);assert.equal(saved.revision,2);
 await ready();assert.equal(await field(),future);
 await page.locator("#ppPlanningStartNow").click();await waitSaved();
 const nowValue=await field();
 assert.ok(Math.abs(Date.parse(nowValue+"Z")-Date.parse(await current()+"Z"))<=60000);
 saved=(await db()).find(p=>p.id===id);assert.equal(ppPlanningStartMinute(saved.model.start),nowValue);
 await ready();assert.equal(await field(),nowValue);
 saved=await persistDate(future);assert.equal(saved.lastPlan,null);
 await page.locator("#ppLanguageSelect").selectOption("ru");
 await page.waitForFunction(()=>document.querySelector(".pp-planning-start-label")?.textContent==="Начало планирования");
 await page.locator("#ppLanguageSelect").selectOption("en");
 if(live){
  await page.waitForFunction(()=>!document.getElementById("opt")?.disabled,null,{timeout:20000});
  const posted=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/plan"&&r.request().method()==="POST",{timeout:30000});
  await page.locator("#opt").click();
  const res=await posted;assert.ok(res.status()<400,"native optimizer accepted start");
  let final=null;
  for(let i=0;i<90;i++){
   const p=await request("/api/plan-progress");if(p.data?.result?.valid===true&&p.data?.running!==true){final=p.data.result;break}
   await page.waitForTimeout(1000);
  }
  assert.ok(final,"Native optimization must finish");
  assert.equal(ppPlanningStartMinute(final.start),future,"native schedule must begin at the selected planning start");
  await page.waitForTimeout(600);
  assert.equal(await field(),future);
  assert.equal(ppPlanningStartMinute((await db()).find(p=>p.id===id).model.start),future);
  await ready();assert.equal(await field(),future,"reopening a planned project preserves the start");
 }
 await page.screenshot({path:"/tmp/planning-start-"+(live?"live":"candidate")+".png"});
 assert.deepEqual(errors,[],"No uncaught browser errors");
 console.log("PLANNING_START_BROWSER_"+(live?"LIVE":"CANDIDATE")+"_PASS");
}finally{await browser.close()}
