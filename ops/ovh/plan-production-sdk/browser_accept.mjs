import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {patchPreview} from "./patch.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-equipment-sdk-toolbar-test/node_modules/playwright-core");
const base="https://app.liftorbit.app",live=process.env.PP_PLAN_PRODUCTION_SDK_LIVE==="1";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:45000});
 const register=await page.evaluate(async({email,password})=>(await fetch("/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,company:"Synthetic plan production SDK QA"})})).status,{email:"plan-production-sdk-qa-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(25).toString("base64url")});
 assert.equal(register,200);
 // Open a valid synthetic project, since the empty-account Projects screen
 // hides the planner chat until a project is active.
 const id="prj_units_"+randomUUID().replaceAll("-","").slice(0,13);
 const seeded=await page.evaluate(async id=>{
  const model={scheduler_mode:"resource",quantity_unit:"m2",start:"2026-11-25T00:00:00",
   equipment:[{id:"M1",__ppid:"M1",name:"Тестовый пресс",kind:"press",capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"fixed",duration_min:10}},{id:"M2",__ppid:"M2",name:"Тестовая печь",kind:"oven",capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"fixed",duration_min:10}}],
   orders:[{id:"2601",quantity:600,area:600,unit:"m2",technical_process_id:"P",parameters:{color:"A"}}],
   employees:[{id:"E1",name:"Synthetic operator",role:"operator",shift:"day"}],materials:[{id:"M",name:"Synthetic powder",unit:"kg",initial_stock:10000,deliveries:[]},{id:"MAT2",name:"Synthetic boxes",unit:"pcs",initial_stock:10000,deliveries:[]}],shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},constraints:[],setup_rules:[],
   technical_processes:[{id:"P",name:"Synthetic process",operations:[{id:"OP",name:"Press",sequence:1,duration_min:10,resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"M1",resource_refs:["M1"],quantity:1,unit:"pcs"},{resource_type:"employee",match_mode:"specific",resource_ref:"E1",resource_refs:["E1"],quantity:1,unit:"pcs",consumption_rule:"during_operation"},{id:"R3",resource_type:"material",match_mode:"specific",resource_ref:"M",resource_refs:["M"],quantity:1,unit:"kg",consumption_rule:"per_m2"}]},{id:"OP2",name:"Fire",sequence:2,duration_min:10,resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"M2",resource_refs:["M2"],quantity:1,unit:"pcs"}]}]}]};
  model.autoclaves=structuredClone(model.equipment);
  const storage={"prodplan.projects.v2":JSON.stringify([{id,name:"Synthetic plan production SDK QA",model,revision:1,lastPlan:null}]),"prodplan.project.active.v2":id};
  return (await fetch("/api/db-storage",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({storage})})).status;
 },id);
 assert.equal(seeded,200);
 const errors=[];page.on("pageerror",e=>errors.push(String(e.stack||e).split("\n").slice(0,4).join("\n").slice(0,1000)));
 const ready=async()=>{await page.reload({waitUntil:"domcontentloaded",timeout:45000});await page.waitForFunction(()=>window.__PP_LANGUAGE__?.installed&&window.__PP_PLAN_PRODUCTION_SDK_V1__&&typeof model==="object"&&model?.orders?.length>=1,null,{timeout:30000});await page.locator("#ppLanguageSelect").selectOption("en");if(await page.evaluate(()=>document.body.classList.contains("projects-mode")))await page.locator(".top .nav > span").filter({hasText:/^(Planning|Планирование)$/}).click()};
 const analytics=()=>page.locator(".side .item").filter({hasText:/^(Analytics|Аналитика)$/});
 const scenarios=()=>page.locator(".side .item").filter({hasText:/^(Scenarios|Сценарии)$/});
 if(!live)await page.route("**/",async route=>{
   if(!route.request().isNavigationRequest()||new URL(route.request().url()).pathname!=="/")return route.continue();
   const response=await route.fetch(),old=await response.text(),out=patchPreview(old);
   assert.notEqual(out,old,"authenticated Plan and Production must receive SDK styles");assert.equal(patchPreview(out),out);
   await route.fulfill({response,body:out,headers:{...response.headers(),"content-type":"text/html; charset=utf-8"}});
 });
 await ready();

 const request=(path,method="GET",body)=>page.evaluate(async({path,method,body})=>{
  const r=await fetch(path,{method,credentials:"same-origin",cache:"no-store",...(body?{headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{})});
  return {status:r.status,data:await r.json().catch(()=>({}))};
 },{path,method,body});
 const nav=label=>page.locator(".side .item").filter({hasText:label});
 const section=page.locator("#sectionView");
 const inspectProduction=async label=>{
  await page.waitForFunction(()=>{const s=document.querySelector("#sectionView.pp-sdk-production-editor");if(!s)return false;const fields=[...s.querySelectorAll("input:not([hidden]):not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=button]):not([type=submit])")].filter(i=>i.getBoundingClientRect().width>0);const selects=[...s.querySelectorAll("select:not([hidden]):not([multiple])")];return fields.length>0&&fields.every(i=>i.classList.contains("pp-sdk-Input"))&&selects.every(i=>i.classList.contains("pp-sdk-native-select"))&&[...s.querySelectorAll("input[type=checkbox]")].every(i=>i.nextElementSibling?.classList.contains("pp-sdk-calendar-Checkbox"))&&[...s.querySelectorAll("button[data-radd],button[data-save],button[data-pdel]")].every(b=>b.classList.contains("pp-sdk-Button"))&&[...s.querySelectorAll("button[data-pdel]")].every(b=>!b.hasAttribute("data-uniform"));},null,{timeout:18000});
  const d=await section.evaluate(s=>{
   const visible=e=>!!(e.getBoundingClientRect().width&&e.getBoundingClientRect().height)&&getComputedStyle(e).visibility!=="hidden";
   return {title:s.querySelector("h1")?.textContent,
   tables:[...s.querySelectorAll("table")].map(e=>({cls:e.className,width:e.getBoundingClientRect().width,parent:e.parentElement.className,headers:[...e.querySelectorAll("th")].map(h=>h.textContent.trim())})),
   inputs:[...s.querySelectorAll("input,select,textarea")].filter(visible).map(i=>({type:i.type,tag:i.tagName,field:i.getAttribute("data-rf")||i.getAttribute("data-f"),value:i.value,cls:i.className,wrap:i.parentElement.className,h:i.getBoundingClientRect().height,w:i.getBoundingClientRect().width,html:i.outerHTML.slice(0,180)})),
   selects:[...s.querySelectorAll(".pp-sdk-SelectControl")].filter(visible).map(i=>({label:i.textContent.trim(),h:i.getBoundingClientRect().height,w:i.getBoundingClientRect().width,weight:getComputedStyle(i).fontWeight})),
   buttons:[...s.querySelectorAll("button")].filter(visible).map(b=>({label:b.textContent.trim(),attrs:[...b.attributes].filter(a=>a.name.startsWith("data-")).map(a=>a.name),sdk:b.classList.contains("pp-sdk-Button"),h:b.getBoundingClientRect().height,variant:b.dataset.variant,html:b.outerHTML.slice(0,160)}))};
  });
  console.log("PLAN_PRODUCTION_SDK_"+label,JSON.stringify(d));
  assert.ok(d.tables.some(t=>t.cls.includes("pp-rr-table")));assert.ok(d.selects.length>=3);
  for(const i of d.inputs.filter(i=>i.tag==="INPUT"&&!["checkbox","radio","hidden","range","button","submit","file"].includes(i.type)))assert.ok(i.cls.includes("pp-sdk-Input")&&Math.abs(i.h-40)<1,JSON.stringify(i));
  for(const i of d.selects)assert.ok(Math.abs(i.h-40)<1&&i.weight==="400",JSON.stringify(i));
  for(const b of d.buttons.filter(b=>b.attrs.includes("data-radd")||b.attrs.some(a=>a.endsWith("save"))))assert.ok(b.sdk&&Math.abs(b.h-40)<1,JSON.stringify(b));
  return d;
 };
 await nav(/^(Production|Производство)$/).click();await inspectProduction("PRODUCTION_EN");
 const materialRow=section.locator('.pp-rr-table [data-r]:has([data-rf=resource_type] option[value=material]:checked)').first();
 await materialRow.waitFor();
 const resource=materialRow.locator('[data-rf=resource_ref]');
 const trigger=resource.locator("xpath=following-sibling::*[contains(@class,'pp-sdk-SelectControl')][1]");
 await trigger.click();await page.locator(".pp-sdk-MenuList:popover-open").getByRole("option",{name:"Synthetic boxes",exact:true}).click();
 assert.equal(await resource.inputValue(),"MAT2");assert.match(await materialRow.locator('[data-rf=unit]').evaluate(e=>e.value),/^(pcs|шт\.?)/);
 await trigger.click();await page.locator(".pp-sdk-MenuList:popover-open").getByRole("option",{name:"Synthetic powder",exact:true}).click();
 assert.equal(await resource.inputValue(),"M");
 const originalName=await section.locator("#procName").inputValue();
 await section.locator("#procName").fill(originalName+" QA");
 const saved=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/project/model/import"&&r.request().method()==="POST",{timeout:30000});
 await section.locator("[data-save]").click();assert.ok((await saved).ok());
 let savedModel=null;
 for(let n=0;n<40;n++){const r=await request("/api/model");if(r.data?.model?.technical_processes?.[0]?.name===originalName+" QA"){savedModel=r.data.model;break}await page.waitForTimeout(500)}
 assert.ok(savedModel,"production process changes persist");
 await inspectProduction("PRODUCTION_SAVED");
 const original=await page.evaluate(()=>JSON.stringify(model));
 const rowCount=await section.locator(".pp-rr-table [data-r]").count();
 await section.locator("[data-radd]").first().click();
 await page.waitForFunction(n=>document.querySelectorAll("#sectionView .pp-rr-table [data-r]").length===n+1,rowCount);
 await inspectProduction("PRODUCTION_NEW_ROW");
 assert.equal(await page.evaluate(()=>JSON.stringify(model)),original,"unsaved production edits do not change model");
 await page.locator("#ppLanguageSelect").selectOption("ru");await page.waitForFunction(()=>document.querySelector("#sectionView h1")?.textContent.trim()==="Производство");await inspectProduction("PRODUCTION_RU");
 await page.locator("#ppLanguageSelect").selectOption("en");
 // Switch to an independent, previously proven native optimizer fixture.
 // The production editor fixture deliberately exercises material/unit mutations.
 const planId="prj_plan_"+randomUUID().replaceAll("-","").slice(0,13);
 const planModel={scheduler_mode:"resource",quantity_unit:"m2",start:"2026-10-05T08:00:00",
  equipment:[{id:"M1",__ppid:"M1",name:"QA press",kind:"pressing",capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"fixed",duration_min:30}}],
  orders:[{id:"2601",quantity:200,area:200,unit:"m2",technical_process_id:"P",process_hours:1,parameters:{color:"A"},ship_by:"2099-12-01T08:00"},{id:"2602",quantity:200,area:200,unit:"m2",technical_process_id:"P",process_hours:1,parameters:{color:"A"}}],
  employees:[{id:"E1",name:"QA operator",role:"operator",shift:"day"}],materials:[{id:"M",name:"QA material",unit:"kg",initial_stock:1000,deliveries:[]}],shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},constraints:[],setup_rules:[],
  technical_processes:[{id:"P",name:"QA process",operations:[{id:"OP",name:"Press",sequence:1,duration_min:30,resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"M1",resource_refs:["M1"],quantity:1,unit:"pcs"},{resource_type:"employee",match_mode:"specific",resource_ref:"E1",resource_refs:["E1"],quantity:1,unit:"pcs",consumption_rule:"during_operation"}]}]}]};
 planModel.autoclaves=structuredClone(planModel.equipment);
 const records=JSON.parse((await request("/api/db-storage")).data.storage["prodplan.projects.v2"]);
 records.push({id:planId,name:"Synthetic Plan SDK QA",model:planModel,revision:1,lastPlan:null});
 assert.equal((await request("/api/db-storage","POST",{storage:{"prodplan.projects.v2":JSON.stringify(records),"prodplan.project.active.v2":planId}})).status,200);
 await ready();
 await page.waitForFunction(id=>localStorage.getItem("prodplan.project.active.v2")===id&&model?.orders?.length===2,planId,{timeout:30000});
 await nav(/^(Plan|План)$/).click();
 const plan=page.locator("#planView"),opt=page.locator("#opt");
 await plan.waitFor({state:"visible"});await opt.waitFor({state:"visible"});
 const inspectPlan=async label=>{
  const d=await page.evaluate(()=>{
   const p=document.getElementById("planView"),opt=document.getElementById("opt"),cs=e=>getComputedStyle(e),rect=e=>e.getBoundingClientRect(),visible=e=>!!(rect(e).width&&rect(e).height)&&cs(e).visibility!=="hidden";
   return {opt:{text:opt.textContent.trim(),height:rect(opt).height,radius:cs(opt).borderRadius,background:cs(opt).backgroundColor,disabled:opt.disabled},
    tabs:[...p.querySelectorAll(".tabs>div,.tabs>button")].filter(visible).map(e=>({text:e.textContent.trim(),active:e.classList.contains("a"),height:rect(e).height,radius:cs(e).borderRadius})),
    cards:[...p.querySelectorAll(".card,.ppt,.pp3-card")].filter(visible).map(e=>({cls:e.className,radius:cs(e).borderRadius})),
    buttons:[...p.querySelectorAll("button,[role=button],#zoomIn,#zoomOut,#zoomLabel")].filter(e=>visible(e)&&!e.closest(".pg2-bar,.pp3-bar")).map(e=>({id:e.id,label:e.textContent.trim(),h:rect(e).height,r:cs(e).borderRadius,cls:e.className})),
    bars:p.querySelectorAll("#ppGanttToolV2 .pg2-bar").length,rows:p.querySelectorAll("#ppGanttToolV2 .pg2-row").length,
    mode:window.__PP_UNIFIED_GANTT_V2__?.activeMode,zoom:window.__PP_GANTT_TOOL_V2__?.zoom};
  });
  console.log("PLAN_PRODUCTION_SDK_"+label,JSON.stringify(d));
  assert.ok(Math.abs(d.opt.height-40)<1&&parseFloat(d.opt.radius)>=20,JSON.stringify(d.opt));
  assert.ok(d.tabs.length>=3);for(const t of d.tabs)assert.ok(t.height>=39&&parseFloat(t.radius)>=20,JSON.stringify(t));
  for(const c of d.cards)assert.equal(c.radius,"16px",JSON.stringify(c));
  return d;
 };
 await inspectPlan("PLAN_EMPTY");
 const future=await page.evaluate(()=>{const d=new Date();d.setDate(d.getDate()+1);while(d.getDay()===0||d.getDay()===6)d.setDate(d.getDate()+1);d.setHours(8,0,0,0);return ppPlanningStartNow(d)});
 const date=page.locator("#ppPlanningStartDate"),time=page.locator("#ppPlanningStartTime");
 for(const [field,minWidth] of [[date,176],[time,172]]){
   const d=await field.evaluate(e=>({height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width,radius:parseFloat(getComputedStyle(e).borderRadius)}));
   assert.ok(Math.abs(d.height-40)<1&&d.width>=minWidth-1&&d.radius>=20,JSON.stringify(d));
 }
 await date.fill(future.slice(0,10));await time.fill(future.slice(11,16));await page.locator("#ppPlanningStartApply").click();
 await page.waitForFunction(()=>document.querySelector(".pp-planning-start-status")?.textContent.includes("Saved")&&!window.__ppPlanningStartSaving,null,{timeout:45000});
 const state=await request("/api/model");console.log("PLAN_PRODUCTION_SDK_MODEL_READY",JSON.stringify({ready:state.data.model_ready,orders:state.data.model?.orders?.length,start:state.data.model?.start,button:await opt.isDisabled()}));
 // Exercise the actual optimizer on the isolated small QA model, not the user's project.
 await page.waitForFunction(()=>!document.getElementById("opt")?.disabled,null,{timeout:20000});
 const posted=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/plan"&&r.request().method()==="POST",{timeout:30000});
 await opt.click();const response=await posted;assert.ok(response.status()<400,"optimizer request accepted");
 let final=null;
 for(let i=0;i<100;i++){const p=await request("/api/plan-progress");if(p.data?.result?.valid===true&&p.data?.running!==true){final=p.data.result;break}await page.waitForTimeout(1000)}
 assert.ok(final,"native optimization must finish");
 await page.waitForFunction(()=>document.querySelector("#ppGanttToolV2 .pg2-bar"),null,{timeout:30000});
 await inspectPlan("PLAN_CALCULATED");
 const tabs=plan.locator(".tabs>div");
 for(const [mode,pattern] of [[1,/Employee|Сотрудник/i],[3,/Order|Заказ/i],[0,/Equipment|Оборудован/i]]){
   const target=tabs.nth(mode);assert.ok(await target.isVisible(),"Gantt mode "+mode+" remains accessible");
   await target.click();await page.waitForFunction(({mode,pattern})=>window.__PP_UNIFIED_GANTT_V2__?.activeMode===mode&&document.getElementById("planView")?.dataset.ppUnifiedGantt===String(mode)&&document.querySelector("#ppGanttToolV2 .pg2-bar")&&new RegExp(pattern,"i").test(document.querySelector("#planView .gantt-head b")?.textContent||""),{mode,pattern:pattern.source},{timeout:15000});
   assert.match(await plan.locator(".gantt-head b").textContent(),pattern);
   const data=await inspectPlan("GANTT_"+mode);assert.ok(data.rows>0&&data.bars>0);
   const before=await page.evaluate(()=>window.__PP_GANTT_TOOL_V2__?.zoom);
   if(mode===1){await page.evaluate(()=>document.getElementById("zoomIn").click());await page.waitForFunction(z=>window.__PP_GANTT_TOOL_V2__?.zoom>z,before,{timeout:10000});assert.equal(await page.evaluate(()=>window.__PP_UNIFIED_GANTT_V2__?.activeMode),1)}
 }
 await page.locator("#ppLanguageSelect").selectOption("ru");await inspectPlan("PLAN_RU");
 await page.locator("#ppLanguageSelect").selectOption("en");
 await page.screenshot({path:"/tmp/plan-production-sdk-"+(live?"live":"candidate")+".png"});
 await nav(/^(Orders|Заказы)$/).click();await page.waitForFunction(()=>!document.querySelector("#sectionView.pp-sdk-production-editor")&&document.querySelector("#sectionView.pp-sdk-resource-editor .pp-sdk-InputContainer"));
 assert.deepEqual(errors,[],"no uncaught page errors");
 console.log("PLAN_PRODUCTION_SDK_BROWSER_"+(live?"LIVE":"CANDIDATE")+"_PASS");
}finally{await browser.close()}
