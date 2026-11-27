import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {patchPreview} from "./patch.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-plan-default-navigation-test/node_modules/playwright-core");
const live=process.env.PP_PLAN_DEFAULT_NAV_LIVE==="1";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900},timezoneId:"Europe/Ljubljana"});
 const request=(path,method="GET",body)=>page.evaluate(async({path,method,body})=>{
  const r=await fetch(path,{method,credentials:"same-origin",cache:"no-store",...(body?{headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{})});
  return {status:r.status,data:await r.json().catch(()=>({}))};
 },{path,method,body});
 await page.goto("https://app.liftorbit.app/",{waitUntil:"domcontentloaded",timeout:45000});
 assert.equal((await request("/api/auth/register","POST",{email:"plan-default-nav-qa-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(25).toString("base64url"),company:"Synthetic navigation QA"})).status,200);
 const id="prj_start_"+randomUUID().replaceAll("-","").slice(0,13);
 const m={scheduler_mode:"resource",quantity_unit:"m2",start:"2026-10-05T08:00:00",
  equipment:[{id:"M1",__ppid:"M1",name:"QA press",kind:"pressing",capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"fixed",duration_min:30}}],
  orders:[{id:"2601",quantity:200,area:200,unit:"m2",technical_process_id:"P",process_hours:1,parameters:{color:"A"},ship_by:"2099-12-01T08:00"},{id:"2602",quantity:200,area:200,unit:"m2",technical_process_id:"P",process_hours:1,parameters:{color:"A"}}],
  employees:[{id:"E1",name:"QA operator",role:"operator",shift:"day"}],materials:[{id:"M",name:"QA material",unit:"kg",initial_stock:1000,deliveries:[]}],shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},constraints:[],setup_rules:[],
  technical_processes:[{id:"P",name:"QA process",operations:[{id:"OP",name:"Press",sequence:1,duration_min:30,resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"M1",resource_refs:["M1"],quantity:1,unit:"pcs"},{resource_type:"employee",match_mode:"specific",resource_ref:"E1",resource_refs:["E1"],quantity:1,unit:"pcs",consumption_rule:"during_operation"}]}]}]};
 m.autoclaves=structuredClone(m.equipment);
 const record={id,name:"Synthetic navigation QA",model:m,revision:1,lastPlan:null,messages:[{role:'user',text:'First project QA message'},{role:'assistant',text:'First project QA response'}]};
 assert.equal((await request("/api/db-storage","POST",{storage:{"prodplan.projects.v2":JSON.stringify([record,{...record,id:id+"_other",name:"Second navigation QA",model:structuredClone(m),messages:[{role:"user",text:"Second project QA message"}]}]),"prodplan.project.active.v2":id}})).status,200);
 if(!live)await page.route("**/",async route=>{
  if(!route.request().isNavigationRequest()||new URL(route.request().url()).pathname!=="/")return route.continue();
  const response=await route.fetch(),old=await response.text(),out=patchPreview(old);
  assert.notEqual(out,old,"authenticated page must receive revised navigation");assert.equal(patchPreview(out),out);
  await route.fulfill({response,body:out,headers:{...response.headers(),"content-type":"text/html; charset=utf-8"}});
 });
 const errors=[];page.on("pageerror",e=>errors.push(e.message.slice(0,200)));
 const nav=key=>page.locator('.side .item').filter({has:page.locator('[data-pp-solar-holder="'+key+'"]')});
 const expected=["production","orders","materials","equipment","employees","plan","analytics"];
 const waitPlan=async(projectId)=>{
  await page.waitForFunction(projectId=>localStorage.getItem("prodplan.project.active.v2")===projectId&&!document.body.classList.contains("projects-mode")&&document.querySelector('.side .item.active [data-pp-solar-holder="plan"]')&&document.getElementById("planView")?.getClientRects().length>0,projectId,{timeout:30000});
  assert.equal(await page.locator(".side .item.active").count(),1);
  assert.equal(await nav("chat").isVisible(),false);
  assert.equal(await nav("chat").getAttribute("aria-hidden"),"true");
  assert.equal(await page.locator("#chatInput").isVisible(),true);
 };
 const visibleKeys=()=>page.evaluate(()=>[...document.querySelectorAll(".side .item")].filter(e=>e.getClientRects().length&&getComputedStyle(e).display!=="none").map(e=>e.querySelector("[data-pp-solar-holder]")?.dataset.ppSolarHolder));
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>window.__PP_PLAN_DEFAULT_NAV_V1__&&window.__PP_LANGUAGE__?.installed&&typeof model==="object"&&model?.orders?.length===2,null,{timeout:30000});
 await page.locator("#ppLanguageSelect").selectOption("en");
 if(await page.evaluate(()=>document.body.classList.contains("projects-mode")))await page.locator(".top .nav > span").filter({hasText:/^(Planning|Планирование)$/}).click();
 await waitPlan(id);
 assert.deepEqual(await visibleKeys(),expected);
 assert.ok((await page.locator("#messages").innerText()).includes("First project QA response"));
 await page.locator("#chatInput").fill("Unsaved draft QA");
 for(const key of expected){
  await nav(key).click();
  await page.waitForFunction(key=>document.querySelector('.side .item.active [data-pp-solar-holder="'+key+'"]')!=null,key);
  assert.equal(await page.locator("#chatInput").isVisible(),true,"assistant on "+key);
  assert.equal(await page.locator("#chatInput").inputValue(),"Unsaved draft QA");
  assert.ok((await page.locator("#messages").innerText()).includes("First project QA response"));
 }
 await page.locator("#ppLanguageSelect").selectOption("ru");
 assert.deepEqual(await visibleKeys(),expected);
 assert.equal(await nav("chat").isVisible(),false);
 await nav("orders").click();
 await page.locator(".top .nav > span").filter({hasText:/^(Projects|Проекты)$/}).click();
 await page.locator('.pm-card[data-project="'+id+'_other"] [data-action="open"]').click();
 await waitPlan(id+"_other");
 assert.ok((await page.locator("#messages").innerText()).includes("Second project QA message"));
 await nav("equipment").click();
 await page.locator(".top .nav > span").filter({hasText:/^(Projects|Проекты)$/}).click();
 await page.locator('.pm-card[data-project="'+id+'"] [data-action="open"]').click();
 await waitPlan(id);
 assert.ok((await page.locator("#messages").innerText()).includes("First project QA response"));
 await page.locator("#ppLanguageSelect").selectOption("en");
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>window.__PP_PLAN_DEFAULT_NAV_V1__&&window.__PP_LANGUAGE__?.installed,null,{timeout:30000});
 await waitPlan(id);
 assert.deepEqual(await visibleKeys(),expected);
 assert.ok(await page.locator("#ppPlanningStartDate").isVisible());
 const stored=JSON.parse((await request("/api/db-storage")).data.storage["prodplan.projects.v2"]);
 assert.equal(stored.find(p=>p.id===id).revision,1);
 assert.equal(stored.find(p=>p.id===id).model.orders[0].ship_by,m.orders[0].ship_by);
 assert.equal(stored.find(p=>p.id===id).messages[1].text,"First project QA response");
 assert.deepEqual(errors,[],"No uncaught page errors");
 await page.screenshot({path:"/tmp/plan-default-nav-"+(live?"live":"candidate")+".png"});
 console.log("PLAN_DEFAULT_NAV_BROWSER_"+(live?"LIVE":"CANDIDATE")+"_PASS");
}finally{await browser.close()}
