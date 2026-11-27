import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {patchPreview} from "./patch_app.mjs";
import {ppShipByReport} from "./shared.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-order-ship-by-test/node_modules/playwright-core");
const live=process.env.PP_SHIP_BY_LIVE==="1";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
let page;
try{
 page=await browser.newPage({viewport:{width:1440,height:900}});
 const request=(path,method="GET",body)=>page.evaluate(async({path,method,body})=>{
  const r=await fetch(path,{method,credentials:"same-origin",cache:"no-store",...(body?{headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{})});
  return {status:r.status,data:await r.json().catch(()=>({}))};
 },{path,method,body});
 await page.goto("https://app.liftorbit.app/",{waitUntil:"domcontentloaded",timeout:45000});
 assert.equal((await request("/api/auth/register","POST",{email:"ship-by-qa-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(25).toString("base64url"),company:"Synthetic deadline QA"})).status,200);
 const id="prj_ship_"+randomUUID().replaceAll("-","").slice(0,13);
 const m={scheduler_mode:"resource",quantity_unit:"m2",start:"2026-11-25T08:00:00",
  equipment:[{id:"M1",__ppid:"M1",name:"QA press",kind:"pressing",capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"fixed",duration_min:60}}],
  orders:[{id:"2601",quantity:200,area:200,unit:"m2",technical_process_id:"P",process_hours:1,parameters:{color:"A"}},{id:"2602",quantity:200,area:200,unit:"m2",technical_process_id:"P",process_hours:1,parameters:{color:"A"}}],
  employees:[{id:"E1",name:"QA operator",role:"operator",shift:"day"}],materials:[{id:"M",name:"QA material",unit:"kg",initial_stock:1000,deliveries:[]}],shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},constraints:[],setup_rules:[],
  technical_processes:[{id:"P",name:"QA process",operations:[{id:"OP",name:"Press",sequence:1,duration_min:60,resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"M1",resource_refs:["M1"],quantity:1,unit:"pcs"},{resource_type:"employee",match_mode:"specific",resource_ref:"E1",resource_refs:["E1"],quantity:1,unit:"pcs",consumption_rule:"during_operation"}]}]}]};
 m.autoclaves=structuredClone(m.equipment);
 const record={id,name:"Synthetic deadline QA",model:m,revision:1,lastPlan:null};
 assert.equal((await request("/api/db-storage","POST",{storage:{"prodplan.projects.v2":JSON.stringify([record,{...record,id:id+"_other",model:structuredClone(m)}]),"prodplan.project.active.v2":id}})).status,200);
 if(!live)await page.route("**/",async route=>{
  if(!route.request().isNavigationRequest()||new URL(route.request().url()).pathname!=="/")return route.continue();
  const response=await route.fetch(),old=await response.text(),out=patchPreview(old);
  assert.notEqual(out,old,"Native order script must be patched");assert.equal(patchPreview(out),out);
  await route.fulfill({response,body:out,headers:{...response.headers(),"content-type":"text/html; charset=utf-8"}});
 });
 const errors=[];page.on("pageerror",e=>errors.push(e.message.slice(0,200)));
 const ready=async()=>{
  await page.reload({waitUntil:"domcontentloaded",timeout:45000});
  await page.waitForFunction(()=>window.__PP_ORDER_SHIP_BY_V1__&&typeof model==="object"&&model?.orders?.length===2,null,{timeout:30000});
  await page.locator("#ppLanguageSelect").selectOption("en");
  if(await page.evaluate(()=>document.body.classList.contains("projects-mode")))await page.locator(".top .nav > span").filter({hasText:/^(Planning|Планирование)$/}).click();
  await page.locator(".side .item").filter({hasText:/^(Orders|Заказы)$/}).click();
  await page.locator('#ppOrderBody input[data-f="ship_by"]').first().waitFor();
 };
 const db=async()=>{
  const r=await request("/api/db-storage");assert.equal(r.status,200);
  const records=JSON.parse(r.data.storage["prodplan.projects.v2"]);return records;
 };
 const save=async()=>{
  const p=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/project/model/import"&&r.request().method()==="POST");
  await page.locator("[data-order-save]").click();
  assert.equal((await p).status(),200);
  await page.waitForTimeout(600);
 };
 await ready();
 const dates=()=>page.locator('#ppOrderBody input[data-f="ship_by"]');
 assert.equal(await dates().count(),2);
 assert.ok((await page.locator("#ppOrderBody").locator("xpath=../..").locator("thead").innerText()).includes("Ship by"));
 assert.deepEqual(await dates().evaluateAll(xs=>xs.map(x=>x.value)),["",""]);
 await dates().nth(0).fill("2026-11-25T08:00");await dates().nth(1).fill("2026-11-25T09:15");
 await save();await ready();
 assert.deepEqual(await dates().evaluateAll(xs=>xs.map(x=>x.value)),["2026-11-25T08:00","2026-11-25T09:15"]);
 let stored=await db();assert.equal(stored.find(p=>p.id===id).model.orders[1].ship_by,"2026-11-25T09:15");assert.equal(stored.find(p=>p.id===id+"_other").model.orders[0].ship_by,undefined);
 assert.ok((await page.locator("[data-pp-ship-status]").nth(1).innerText()).includes("Not planned"));
 await dates().nth(0).fill("");await save();await ready();assert.equal(await dates().nth(0).inputValue(),"");
 await dates().nth(0).fill("2026-11-25T08:00");await save();await ready();
 await page.locator("#ppLanguageSelect").selectOption("ru");
 await page.waitForFunction(()=>[...document.querySelectorAll("#ppOrderBody").item(0)?.parentElement.querySelectorAll("th")||[]].some(x=>x.textContent==="Отгрузить до"));
 await page.locator("#ppLanguageSelect").selectOption("en");
 if(live){
  await page.locator(".side .item").filter({hasText:/^(Plan|План)$/}).click();
  await page.waitForFunction(()=>!document.getElementById("opt")?.disabled,null,{timeout:20000});
  const posted=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/plan"&&r.request().method()==="POST",{timeout:30000});
  await page.locator("#opt").click();
  const res=await posted;assert.ok(res.status()<400,"optimization request accepted");
  let final=null;
  for(let i=0;i<90;i++){
   const p=await request("/api/plan-progress");if(p.data?.result?.valid===true&&p.data?.running!==true){final=p.data.result;break}
   await page.waitForTimeout(1000);
  }
  assert.ok(final,"Native deadline optimization must finish");
  const actual=ppShipByReport({...m,orders:[{...m.orders[0],ship_by:"2026-11-25T08:00"},{...m.orders[1],ship_by:"2026-11-25T09:15"}]},final);
  assert.equal(actual[0].status,"late","impossible deadline is soft");
  assert.equal(actual[1].status,"on_time","urgent feasible order is prioritized");
  await page.waitForTimeout(1000);
  await page.locator(".side .item").filter({hasText:/^(Orders|Заказы)$/}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll("[data-pp-ship-status]")].some(x=>x.dataset.status==="late"));
  assert.equal(await page.locator("[data-pp-ship-status]").nth(1).getAttribute("data-status"),"on_time");
  await page.locator(".side .item").filter({hasText:/^(Analytics|Аналитика)$/}).click();
  await page.locator("[data-pp-ship-analytics]").waitFor();
  assert.ok((await page.locator("[data-pp-ship-analytics]").innerText()).includes("2601"));
 }
 await page.screenshot({path:"/tmp/ship-by-"+(live?"live":"candidate")+".png"});
 assert.deepEqual(errors,[],"No uncaught browser errors");
 console.log("SHIP_BY_BROWSER_"+(live?"LIVE":"CANDIDATE")+"_PASS");
}finally{await browser.close()}
