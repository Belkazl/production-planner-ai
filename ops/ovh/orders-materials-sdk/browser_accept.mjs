import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {patchPreview} from "./patch.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-equipment-sdk-toolbar-test/node_modules/playwright-core");
const live=process.env.PP_ORDERS_MATERIALS_SDK_LIVE==="1";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900},timezoneId:"Europe/Ljubljana",locale:"en-US"});
 const request=(path,method="GET",body)=>page.evaluate(async({path,method,body})=>{
  const r=await fetch(path,{method,credentials:"same-origin",cache:"no-store",...(body?{headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{})});
  return {status:r.status,data:await r.json().catch(()=>({}))};
 },{path,method,body});
 await page.goto("https://app.liftorbit.app/",{waitUntil:"domcontentloaded",timeout:45000});
 assert.equal((await request("/api/auth/register","POST",{email:"resource-editors-qa-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(25).toString("base64url"),company:"Synthetic resource editors QA"})).status,200);
 const id="prj_start_"+randomUUID().replaceAll("-","").slice(0,13);
 const m={scheduler_mode:"resource",quantity_unit:"m2",start:"2026-10-05T08:00:00",
  equipment:[{id:"M1",__ppid:"M1",name:"QA press",kind:"pressing",capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"fixed",duration_min:30}}],
  orders:[{id:"2601",quantity:200,area:200,unit:"m2",technical_process_id:"P",process_hours:1,parameters:{color:"A"},ship_by:"2099-12-01T08:00"},{id:"2602",quantity:200,area:200,unit:"m2",technical_process_id:"P",process_hours:1,parameters:{color:"A"}}],
  employees:[{id:"E1",name:"QA operator",role:"operator",shift:"day"}],materials:[{id:"M",name:"QA material",unit:"kg",initial_stock:1000,deliveries:[]}],shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},constraints:[],setup_rules:[],
  technical_processes:[{id:"P",name:"QA process",operations:[{id:"OP",name:"Press",sequence:1,duration_min:30,resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"M1",resource_refs:["M1"],quantity:1,unit:"pcs"},{resource_type:"employee",match_mode:"specific",resource_ref:"E1",resource_refs:["E1"],quantity:1,unit:"pcs",consumption_rule:"during_operation"}]}]}]};
 m.autoclaves=structuredClone(m.equipment);
 const record={id,name:"Synthetic resource editors QA",model:m,revision:1,lastPlan:null,messages:[{role:'user',text:'First project QA message'},{role:'assistant',text:'First project QA response'}]};
 assert.equal((await request("/api/db-storage","POST",{storage:{"prodplan.projects.v2":JSON.stringify([record,{...record,id:id+"_other",name:"Second navigation QA",model:structuredClone(m),messages:[{role:"user",text:"Second project QA message"}]}]),"prodplan.project.active.v2":id}})).status,200);
 if(!live)await page.route("**/",async route=>{
  if(!route.request().isNavigationRequest()||new URL(route.request().url()).pathname!=="/")return route.continue();
  const response=await route.fetch(),old=await response.text(),out=patchPreview(old);
  assert.notEqual(out,old,"authenticated page must receive toolbar patch");assert.equal(patchPreview(out),out);
  await route.fulfill({response,body:out,headers:{...response.headers(),"content-type":"text/html; charset=utf-8"}});
 });
 const errors=[];page.on("pageerror",e=>errors.push(e.message.slice(0,200)));
 const nav=key=>page.locator(".side .item").filter({has:page.locator('[data-pp-solar-holder="'+key+'"]')});
 const head=()=>page.locator("#sectionView .pp-sdk-equipment-toolbar");
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>window.__PP_EQUIPMENT_SDK_TOOLBAR_V1__&&window.__PP_LANGUAGE__?.installed&&typeof model==="object"&&model?.equipment?.length===1,null,{timeout:30000});
 await page.locator("#ppLanguageSelect").selectOption("en");
 if(await page.evaluate(()=>document.body.classList.contains("projects-mode")))await page.locator(".top .nav > span").filter({hasText:/^(Planning|Планирование)$/}).click();
 await nav("employees").click();

 const section=page.locator("#sectionView");
 const openTab=async key=>{
   await nav(key).click();
   await page.waitForFunction(()=>document.querySelector("#sectionView.pp-sdk-resource-editor .pp-sdk-equipment-table")&&document.querySelector("#sectionView.pp-sdk-resource-editor .pp-sdk-InputContainer"),null,{timeout:20000});
 };
 const inspect=async label=>{
   const d=await section.evaluate(s=>{
     const visible=e=>!!(e.getBoundingClientRect().width&&e.getBoundingClientRect().height)&&getComputedStyle(e).visibility!=="hidden";
     const buttons=[...s.querySelectorAll("button")].filter(visible).map(b=>({label:b.textContent.trim(),attrs:[...b.attributes].filter(a=>a.name.startsWith("data-")).map(a=>a.name),sdk:b.classList.contains("pp-sdk-Button"),height:b.getBoundingClientRect().height,variant:b.dataset.variant,html:b.outerHTML.slice(0,200)}));
     const controls=[...s.querySelectorAll("input,select,textarea")].map(i=>({tag:i.tagName,type:i.type,field:i.dataset.f,attributes:[...i.attributes].filter(a=>a.name.startsWith("data-")).map(a=>a.name),value:i.value,visible:visible(i),parent:i.parentElement.className,styled:i.matches(".pp-sdk-Input,.pp-sdk-native-select,.pp-sdk-Textarea"),height:i.getBoundingClientRect().height,width:i.getBoundingClientRect().width,html:i.outerHTML.slice(0,200)}));
     const selects=[...s.querySelectorAll(".pp-sdk-SelectControl")].filter(visible).map(i=>({height:i.getBoundingClientRect().height,width:i.getBoundingClientRect().width,weight:getComputedStyle(i).fontWeight}));
     return {title:s.querySelector("h1")?.textContent,buttons,controls,selects,headers:[...s.querySelectorAll("th")].map(h=>h.textContent.trim())};
   });
   console.log("RESOURCE_EDITOR_"+label,JSON.stringify(d));
   const inputs=d.controls.filter(x=>x.visible&&x.tag==="INPUT"&&!["checkbox","radio","hidden","button","submit","file"].includes(x.type));
   assert.ok(inputs.length>=3,label+" must contain editable fields");
   for(const i of inputs){assert.ok(i.styled&&Math.abs(i.height-40)<1,JSON.stringify(i));if(i.type==="datetime-local")assert.ok(i.width>=263,"date and time must fit");}
   for(const i of d.selects)assert.ok(Math.abs(i.height-40)<1&&i.weight==="400",JSON.stringify(i));
   for(const i of d.controls.filter(x=>x.visible&&x.tag==="TEXTAREA"))assert.ok(i.styled,JSON.stringify(i));
   const mainButtons=d.buttons.filter(b=>b.attrs.some(a=>["data-pp-add","data-pp-save","data-order-add","data-order-save"].includes(a)));
   assert.equal(mainButtons.length,2,JSON.stringify(d.buttons));
   for(const b of mainButtons){assert.ok(b.sdk&&Math.abs(b.height-40)<1,JSON.stringify(b));assert.equal(b.variant,b.attrs.some(a=>a.endsWith("save"))?"solid":"outline")}
   return d;
 };
 const waitModel=async predicate=>{
   for(let n=0;n<50;n++){const r=await request("/api/model");if(r.data?.model&&predicate(r.data.model))return r.data.model;await new Promise(resolve=>setTimeout(resolve,500))}
   throw Error("Persisted resource editor change not found");
 };
 await openTab("orders");
 await inspect("ORDERS_EN");
 assert.equal(await section.locator("#ppOrderBody tr").count(),2);
 const first=section.locator("#ppOrderBody tr").first();
 const deadline=first.locator('input[data-f="ship_by"]');
 assert.equal(await deadline.inputValue(),"2099-12-01T08:00");
 await deadline.fill("2099-12-02T19:15");
 const orderQuantity=first.locator('input[data-f="area"],input[data-f="quantity"]').first();await orderQuantity.fill("230");
 const process=first.locator(".pp-sdk-SelectControl").first();await process.focus();await process.press("Enter");await page.locator(".pp-sdk-MenuList:popover-open").getByRole("option",{name:"QA process",exact:true}).click();
 let p=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/project/model/import"&&r.request().method()==="POST",{timeout:30000});
 await section.locator("[data-order-save]").click();assert.ok((await p).ok());
 await waitModel(m=>m.orders?.[0]?.ship_by==="2099-12-02T19:15"&&Number(m.orders[0].quantity??m.orders[0].area)===230);
 await openTab("materials");const mat=await inspect("MATERIALS_EN");
 const materialName=section.locator('input[data-f="name"]').first();
 const materialStock=section.locator('input[data-f="initial_stock"]').first();
 await materialName.fill("Updated QA material");await materialStock.fill("1200");
 p=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/project/model/import"&&r.request().method()==="POST",{timeout:30000});
 await section.locator("[data-pp-save]").click();assert.ok((await p).ok());
 await waitModel(m=>m.materials?.[0]?.name==="Updated QA material"&&Number(m.materials[0].initial_stock)===1200);
 await openTab("materials");
 await section.locator("[data-pp-add]").click();
 await inspect("MATERIALS_NEW_ROW");
 await openTab("orders");
 await section.locator("[data-order-add]").click();
 await inspect("ORDERS_NEW_ROW");
 assert.equal(await section.locator("#ppOrderBody tr").count(),3);
 await page.locator("#ppLanguageSelect").selectOption("ru");
 await page.waitForFunction(()=>document.querySelector("#sectionView h1")?.textContent.trim()==="Заказы",null,{timeout:15000});
 await inspect("ORDERS_RU");
 await openTab("materials");await inspect("MATERIALS_RU");
 await nav("employees").click();await page.waitForFunction(()=>!document.querySelector("#sectionView.pp-sdk-resource-editor")&&document.querySelector("[data-pp-weekly-calendar]"),null,{timeout:15000});
 assert.ok(await section.locator("[data-pp-weekly-calendar] input[type=time]").first().evaluate(i=>i.getBoundingClientRect().width>=171));
 await nav("equipment").click();await page.waitForFunction(()=>!document.querySelector("#sectionView.pp-sdk-resource-editor")&&document.querySelector("#sectionView table.pp-sdk-equipment-table"),null,{timeout:15000});
 assert.deepEqual(errors,[],"No uncaught page errors");
 console.log("ORDERS_MATERIALS_SDK_BROWSER_"+(live?"LIVE":"CANDIDATE")+"_PASS");
}finally{await browser.close()}
