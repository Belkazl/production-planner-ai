import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {css,script,transformAnalytics} from "./patch.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-launch-analytics-test/node_modules/playwright-core");
const base="https://app.liftorbit.app",live=process.env.PP_LAUNCH_ANALYTICS_LIVE==="1";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:45000});
 const register=await page.evaluate(async({email,password})=>(await fetch("/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,company:"Synthetic launch analytics QA"})})).status,{email:"launch-analytics-qa-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(25).toString("base64url")});
 assert.equal(register,200);
 // Open a valid synthetic project, since the empty-account Projects screen
 // hides the planner chat until a project is active.
 const id="prj_units_"+randomUUID().replaceAll("-","").slice(0,13);
 const seeded=await page.evaluate(async id=>{
  const model={scheduler_mode:"resource",quantity_unit:"m2",start:"2026-11-25T00:00:00",
   equipment:[{id:"M1",__ppid:"M1",name:"Тестовый пресс",kind:"press",capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"fixed",duration_min:10}},{id:"M2",__ppid:"M2",name:"Тестовая печь",kind:"oven",capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"fixed",duration_min:10}}],
   orders:[{id:"2601",quantity:600,area:600,unit:"m2",technical_process_id:"P",parameters:{color:"A"}}],
   employees:[{id:"E1",name:"Synthetic operator",role:"operator",shift:"day"}],materials:[{id:'M',name:'Synthetic powder',unit:'kg',initial_stock:1000,deliveries:[]}],shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},constraints:[],setup_rules:[],
   technical_processes:[{id:"P",name:"Synthetic process",operations:[{id:"OP",name:"Press",sequence:1,duration_min:10,resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"M1",resource_refs:["M1"],quantity:1,unit:"pcs"},{resource_type:"employee",match_mode:"specific",resource_ref:"E1",resource_refs:["E1"],quantity:1,unit:"pcs",consumption_rule:"during_operation"}]},{id:"OP2",name:"Fire",sequence:2,duration_min:10,resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"M2",resource_refs:["M2"],quantity:1,unit:"pcs"}]}]}]};
  const storage={"prodplan.projects.v2":JSON.stringify([{id,name:"Synthetic launch analytics QA",model,revision:1,lastPlan:null}]),"prodplan.project.active.v2":id};
  return (await fetch("/api/db-storage",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({storage})})).status;
 },id);
 assert.equal(seeded,200);
 const errors=[];page.on("pageerror",e=>errors.push(String(e).slice(0,180)));
 const ready=async()=>{await page.reload({waitUntil:"domcontentloaded",timeout:45000});await page.waitForFunction(()=>window.__PP_LANGUAGE__?.installed&&model?.orders?.length===1&&document.querySelectorAll(".side .item").length===10,{},{timeout:30000});await page.locator("#ppLanguageSelect").selectOption("en")};
 const analytics=()=>page.locator(".side .item").filter({hasText:/^(Analytics|Аналитика)$/});
 const scenarios=()=>page.locator(".side .item").filter({hasText:/^(Scenarios|Сценарии)$/});
 if(!live){await ready();assert(await scenarios().isVisible());await page.route("**/",async route=>{if(!route.request().isNavigationRequest()||new URL(route.request().url()).pathname!=="/")return route.continue();const response=await route.fetch(),old=await response.text(),out=transformAnalytics(old,css,script);assert.notEqual(out,old,"exact localization and analytics anchors");assert.equal(transformAnalytics(out,css,script),out);await route.fulfill({response,body:out,headers:{...response.headers(),"content-type":"text/html; charset=utf-8"}})})}
 await ready();
 const dash=page.locator("[data-pp-analytics-dashboard]");
 assert.equal(await scenarios().count(),1);assert(!(await scenarios().isVisible()));
 assert.equal(await page.locator(".side .item:visible").count(),9);
 await analytics().click();await dash.waitFor({state:"visible"});
 assert((await dash.innerText()).includes("No current calculated plan"));
 // Add a complete synthetic plan to the isolated active project, using the
 // existing storage schema. No data belonging to a real customer is touched.
 const plan={valid:true,duration_minutes:1440,generic_schedule:true,batch_count:3,operator_wait_minutes:73,machine_idle_minutes:120,generic_operations:[
  {operation_id:"OP",order:"2601",start_min:480,end_min:720,equipment_ids:["M1"],employee_ids:["E1"],batch_quantity:200,materials:[{id:"M",quantity:100}]},
  {operation_id:"OP",order:"2601",start_min:780,end_min:900,equipment_ids:["M1"],employee_ids:["E1"],batch_quantity:200,materials:[{id:"M",quantity:80}]},
  {operation_id:"OP2",order:"2601",start_min:0,end_min:1080,equipment_ids:["M2"],employee_ids:[],batch_quantity:200}
 ]};
 const setPlan=async stale=>page.evaluate(({plan,stale})=>{const key="prodplan.projects.v2",id=localStorage.getItem("prodplan.project.active.v2"),list=JSON.parse(localStorage.getItem(key)),p=list.find(x=>x.id===id);p.lastPlan={...plan,_revision:Number(p.revision)+(stale?1:0)};localStorage.setItem(key,JSON.stringify(list));return JSON.stringify(p.model)},{plan,stale});
 const original=await setPlan(false);
 await page.locator(".side .item").filter({hasText:/^(Orders|Заказы)$/}).click();await analytics().click();
 await dash.locator('[data-pp-kpi="duration"]').waitFor({state:"visible"});
 assert.equal(await dash.locator('[data-util-group="equipment"] .ppr').count(),2);
 assert.equal(await dash.locator('[data-util-group="employees"] .ppr').count(),1);
 assert.equal(await dash.locator('[data-pp-kpi="equipment-load"] strong').innerText(),"75.0%");
 assert.equal(await dash.locator('[data-pp-kpi="staff-load"] strong').innerText(),"75.0%");
 assert((await dash.innerText()).includes("180 kg"));assert(!(await dash.innerText()).includes("Autoclaves"));
 const chatRequests=[];page.on("request",r=>{if(new URL(r.url()).pathname==="/api/assistant"&&r.method()==="POST")chatRequests.push(1)});
 await dash.locator("[data-pp-ana-ai]").click();assert((await page.locator("#chatInput").inputValue()).includes("available working time"));assert.equal(chatRequests.length,0);
 await page.locator("#ppLanguageSelect").selectOption("ru");await page.waitForFunction(()=>document.querySelector("[data-pp-analytics-dashboard] h2")?.textContent==="Аналитика");assert(!(await scenarios().isVisible()));
 await page.locator("#ppLanguageSelect").selectOption("en");await page.waitForFunction(()=>document.querySelector("[data-pp-analytics-dashboard] h2")?.textContent==="Analytics");
 await page.locator(".side .item").filter({hasText:/^(Settings|Настройки)$/}).click();assert(!(await dash.isVisible()));assert(await page.locator("#sectionView").isVisible());
 await analytics().click();await dash.locator('[data-pp-kpi="duration"]').waitFor({state:"visible"});
 assert.equal(await page.evaluate(()=>{const id=localStorage.getItem("prodplan.project.active.v2");return JSON.stringify(JSON.parse(localStorage.getItem("prodplan.projects.v2")).find(p=>p.id===id).model)}),original);
 await page.screenshot({path:"/tmp/liftorbit-launch-analytics-"+(live?"live":"candidate")+".png"});
 await setPlan(true);await page.locator(".side .item").filter({hasText:/^(Orders|Заказы)$/}).click();await analytics().click();await page.waitForFunction(()=>document.querySelector("[data-pp-analytics-dashboard]")?.innerText.includes("No current calculated plan"));
 assert.deepEqual(errors,[],"no page errors");
 console.log("LAUNCH_ANALYTICS_BROWSER_PASS",JSON.stringify({live,scenariosHidden:true,sidebarCount:9,calendarMetrics:true,recordedMaterials:true,aiDraftOnly:true,bothLanguages:true,stalePlanRejected:true,modelUnchanged:true}));
}finally{await browser.close()}
