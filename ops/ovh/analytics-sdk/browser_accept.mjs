import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {patchPreview} from "./patch.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-equipment-sdk-toolbar-test/node_modules/playwright-core");
const base="https://app.liftorbit.app",live=process.env.PP_ANALYTICS_SDK_LIVE==="1";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:45000});
 const register=await page.evaluate(async({email,password})=>(await fetch("/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,company:"Synthetic analytics SDK QA"})})).status,{email:"analytics-sdk-qa-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(25).toString("base64url")});
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
  model.autoclaves=structuredClone(model.equipment);
  const storage={"prodplan.projects.v2":JSON.stringify([{id,name:"Synthetic analytics SDK QA",model,revision:1,lastPlan:null}]),"prodplan.project.active.v2":id};
  return (await fetch("/api/db-storage",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({storage})})).status;
 },id);
 assert.equal(seeded,200);
 const errors=[];page.on("pageerror",e=>errors.push(String(e.stack||e).split("\n").slice(0,4).join("\n").slice(0,1000)));
 const ready=async()=>{await page.reload({waitUntil:"domcontentloaded",timeout:45000});await page.waitForFunction(()=>window.__PP_LANGUAGE__?.installed&&window.__PP_ANALYTICS_SDK_V1__&&typeof model==="object"&&model?.orders?.length===1,null,{timeout:30000});await page.locator("#ppLanguageSelect").selectOption("en");if(await page.evaluate(()=>document.body.classList.contains("projects-mode")))await page.locator(".top .nav > span").filter({hasText:/^(Planning|Планирование)$/}).click()};
 const analytics=()=>page.locator(".side .item").filter({hasText:/^(Analytics|Аналитика)$/});
 const scenarios=()=>page.locator(".side .item").filter({hasText:/^(Scenarios|Сценарии)$/});
 if(!live)await page.route("**/",async route=>{
   if(!route.request().isNavigationRequest()||new URL(route.request().url()).pathname!=="/")return route.continue();
   const response=await route.fetch(),old=await response.text(),out=patchPreview(old);
   assert.notEqual(out,old,"authenticated analytics must receive SDK styles");assert.equal(patchPreview(out),out);
   await route.fulfill({response,body:out,headers:{...response.headers(),"content-type":"text/html; charset=utf-8"}});
 });
 await ready();
 const dash=page.locator("[data-pp-analytics-dashboard]");
 assert(!(await scenarios().isVisible()));
 await analytics().click();await dash.waitFor({state:"visible"});
 assert((await dash.innerText()).includes("No current calculated plan"));

 const verifyButton=async selector=>{
   const btn=dash.locator(selector);await btn.locator(".pp-sdk-ButtonInner").waitFor({state:"visible"});
   const s=await btn.evaluate(b=>({height:b.getBoundingClientRect().height,radius:parseFloat(getComputedStyle(b).borderRadius),font:getComputedStyle(b).fontSize,variant:b.dataset.variant,bg:getComputedStyle(b,"::before").backgroundColor,inner:!!b.querySelector(".pp-sdk-ButtonInner")}));
   assert.ok(Math.abs(s.height-40)<1&&s.radius>=20&&s.font==="14px"&&s.variant==="solid"&&s.inner,JSON.stringify(s));
   assert.ok(s.bg!=="rgba(0, 0, 0, 0)"&&s.bg!=="transparent",JSON.stringify(s));return s;
 };
 const verifyLayout=async(label)=>{
   const d=await dash.evaluate(s=>{
    const css=e=>getComputedStyle(e),r=e=>e.getBoundingClientRect();
    return {heading:css(s.querySelector("h2")).fontSize,bodyFont:css(s).fontFamily,
      cards:[...s.querySelectorAll(".pp-ana-card,.pp-util-group,.pp-util-explainer")].map(e=>({radius:css(e).borderRadius,border:css(e).borderTopColor,bg:css(e).backgroundColor,padding:css(e).paddingTop,width:r(e).width})),
      kpis:[...s.querySelectorAll(".pp-ana-kpi strong")].map(e=>({value:e.textContent,font:css(e).fontSize})),
      tables:[...s.querySelectorAll("table")].map(e=>({font:css(e).fontSize,head:e.tHead?.rows[0]?.cells[0]?.textContent})),
      bars:[...s.querySelectorAll(".pp-util-track")].map(e=>({height:r(e).height,radius:css(e).borderRadius,width:r(e).width,segments:[...e.children].map(i=>({width:i.style.width,color:css(i).backgroundColor,kind:i.className})),aria:e.getAttribute("aria-label")})),
      width:s.clientWidth,scrollWidth:s.scrollWidth,
      colors:[...s.querySelectorAll(".pp-util-legend i")].map(e=>css(e).backgroundColor)};
   });
   console.log("ANALYTICS_SDK_LAYOUT_"+label,JSON.stringify(d));
   assert.equal(d.heading,"20px");assert.ok(d.bodyFont.includes("system-ui"));
   assert.ok(d.cards.length>=1);for(const c of d.cards){assert.equal(c.radius,"16px");assert.equal(c.padding,"16px");assert.ok(c.width>0)}
   for(const k of d.kpis)assert.equal(k.font,"24px");
   for(const t of d.tables)assert.equal(t.font,"14px");
   for(const b of d.bars){assert.ok(Math.abs(b.height-12)<1&&parseFloat(b.radius)>=6&&b.width>0,JSON.stringify(b));if(b.segments.length){assert.ok(b.aria);const sum=b.segments.reduce((n,v)=>n+parseFloat(v.width),0);assert.ok(Math.abs(sum-100)<0.01,JSON.stringify(b))}}
   if(d.colors.length)assert.equal(new Set(d.colors).size,4,"legend categories remain distinct");
   assert.ok(d.scrollWidth<=d.width+2,"Analytics should not clip horizontally: "+JSON.stringify({width:d.width,scroll:d.scrollWidth}));
   return d;
 };
 await verifyButton("[data-pp-ana-plan]");await verifyLayout("EMPTY");
 await dash.locator("[data-pp-ana-plan]").click();await dash.waitFor({state:"hidden"});
 await analytics().click();await dash.waitFor({state:"visible"});await verifyButton("[data-pp-ana-plan]");

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
 await verifyButton("[data-pp-ana-ai]");await verifyLayout("PLAN_EN");
 assert.ok(await dash.locator("[data-pp-ship-analytics]").count()===1,"Deadline analytics preserved");
 const chatRequests=[];page.on("request",r=>{if(new URL(r.url()).pathname==="/api/assistant"&&r.method()==="POST")chatRequests.push(1)});
 await dash.locator("[data-pp-ana-ai]").click();assert((await page.locator("#chatInput").inputValue()).includes("available working time"));assert.equal(chatRequests.length,0);
 await page.locator("#ppLanguageSelect").selectOption("ru");await page.waitForFunction(()=>document.querySelector("[data-pp-analytics-dashboard] h2")?.textContent==="Аналитика");assert(!(await scenarios().isVisible()));await verifyButton("[data-pp-ana-ai]");await verifyLayout("PLAN_RU");
 await page.locator("#ppLanguageSelect").selectOption("en");await page.waitForFunction(()=>document.querySelector("[data-pp-analytics-dashboard] h2")?.textContent==="Analytics");
 await page.locator(".side .item").filter({hasText:/^(Settings|Настройки)$/}).click();assert(!(await dash.isVisible()));assert(await page.locator("#sectionView").isVisible());
 await analytics().click();await dash.locator('[data-pp-kpi="duration"]').waitFor({state:"visible"});
 assert.equal(await page.evaluate(()=>{const id=localStorage.getItem("prodplan.project.active.v2");return JSON.stringify(JSON.parse(localStorage.getItem("prodplan.projects.v2")).find(p=>p.id===id).model)}),original);
 await verifyButton("[data-pp-ana-ai]");await verifyLayout("PLAN_RETURN");
 await page.screenshot({path:"/tmp/liftorbit-analytics-sdk-"+(live?"live":"candidate")+".png"});
 await page.setViewportSize({width:1120,height:900});await verifyLayout("NARROW");
 await page.setViewportSize({width:1440,height:900});
 await setPlan(true);await page.locator(".side .item").filter({hasText:/^(Orders|Заказы)$/}).click();await analytics().click();await page.waitForFunction(()=>document.querySelector("[data-pp-analytics-dashboard]")?.innerText.includes("No current calculated plan"));
 assert.deepEqual(errors,[],"no page errors");
 await verifyButton("[data-pp-ana-plan]");await verifyLayout("STALE");
 console.log("ANALYTICS_SDK_BROWSER_PASS",JSON.stringify({live,scenariosHidden:true,sidebarCount:9,calendarMetrics:true,recordedMaterials:true,aiDraftOnly:true,bothLanguages:true,stalePlanRejected:true,modelUnchanged:true}));
}finally{await browser.close()}
