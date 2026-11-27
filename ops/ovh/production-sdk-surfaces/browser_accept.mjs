import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {patchPreview} from "./patch.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-equipment-sdk-toolbar-test/node_modules/playwright-core");
const base="https://app.liftorbit.app",live=process.env.PP_PRODUCTION_SDK_SURFACES_LIVE==="1";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:45000});
 const register=await page.evaluate(async({email,password})=>(await fetch("/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,company:"Synthetic production surfaces QA"})})).status,{email:"production-surfaces-qa-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(25).toString("base64url")});
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
  const storage={"prodplan.projects.v2":JSON.stringify([{id,name:"Synthetic production surfaces QA",model,revision:1,lastPlan:null}]),"prodplan.project.active.v2":id};
  return (await fetch("/api/db-storage",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({storage})})).status;
 },id);
 assert.equal(seeded,200);
 const errors=[];page.on("pageerror",e=>errors.push(String(e.stack||e).split("\n").slice(0,4).join("\n").slice(0,1000)));
 const ready=async()=>{await page.reload({waitUntil:"domcontentloaded",timeout:45000});await page.waitForFunction(()=>window.__PP_LANGUAGE__?.installed&&window.__PP_PRODUCTION_SDK_SURFACES_V1__&&typeof model==="object"&&model?.orders?.length>=1,null,{timeout:30000});await page.locator("#ppLanguageSelect").selectOption("en");if(await page.evaluate(()=>document.body.classList.contains("projects-mode")))await page.locator(".top .nav > span").filter({hasText:/^(Planning|Планирование)$/}).click()};
 const analytics=()=>page.locator(".side .item").filter({hasText:/^(Analytics|Аналитика)$/});
 const scenarios=()=>page.locator(".side .item").filter({hasText:/^(Scenarios|Сценарии)$/});
 if(!live)await page.route("**/",async route=>{
   if(!route.request().isNavigationRequest()||new URL(route.request().url()).pathname!=="/")return route.continue();
   const response=await route.fetch(),old=await response.text(),out=patchPreview(old);
   assert.notEqual(out,old,"authenticated Production must receive SDK styles");assert.equal(patchPreview(out),out);
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

 const verifySurfaces=async label=>{
  await page.waitForFunction(()=>{
   const s=document.querySelector("#sectionView.pp-sdk-production-editor");if(!s)return false;
   const n=s.querySelectorAll('[data-of="sequence"]').length;
   return n>=2&&s.querySelectorAll(".pp-sdk-production-op-card").length===n&&s.querySelectorAll(".pp-sdk-production-op-head").length===n&&s.querySelectorAll(".pp-sdk-production-op-body").length>=n;
  },null,{timeout:15000});
  const colors=JSON.parse(await section.evaluate(s=>{
   const style=e=>getComputedStyle(e),rect=e=>e.getBoundingClientRect();
   const info=e=>({tag:e.tagName,id:e.id,cls:String(e.className),bg:style(e).backgroundColor,border:style(e).borderTopColor,display:style(e).display});
   const nodes=[...s.querySelectorAll(".pp-sdk-production-main-surface,.pp-sdk-production-op-card,.pp-sdk-production-op-head,.pp-sdk-production-op-body,.pp-sdk-production-neutral-wrap,.pp-rr-table,.pp-rr-table th,.pp-rr-table td")].filter(e=>rect(e).width&&rect(e).height).map(info);
   const ancestry=[];for(const table of s.querySelectorAll(".pp-rr-table")){const chain=[];for(let n=table;n&&n!==s;n=n.parentElement)chain.push(info(n));ancestry.push(chain)}
   const buttons=[...s.querySelectorAll("button[data-save],button[data-pt],button[data-radd],button[data-pdel]")].map(b=>({label:b.textContent.trim(),variant:b.dataset.variant,color:b.dataset.color,bg:style(b,"::before").backgroundColor,height:rect(b).height}));
   const nativeBg=[...s.querySelectorAll("div,section,article,header,table,thead,tbody,tr,td,th")].filter(e=>rect(e).width&&rect(e).height&&!e.closest(".pp-sdk-InputContainer,.pp-sdk-TextareaContainer,.pp-sdk-SelectControl,.pp-sdk-Button")).map(info);
   return JSON.stringify({page:info(s),parent:info(s.parentElement),nodes,ancestry,buttons,nativeBg});
  }));
  console.log("PRODUCTION_SDK_SURFACES_"+label,JSON.stringify(colors));
  const rgb=s=>{if(s.startsWith("oklab(")){const a=s.slice(6).match(/-?[\d.]+(?:e[+-]?\d+)?/gi)?.map(Number)||[];if(Math.abs(a[1])<.0001&&Math.abs(a[2])<.0001){const v=a[0]**3,x=(v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055)*255;return [x,x,x]}}const a=s.match(/[\d.]+/g)?.map(Number)||[];if(s.startsWith("color(srgb"))return a.slice(0,3).map(x=>x*255);return a.slice(0,3)};
  const neutral=s=>{const a=rgb(s);return a.length===3&&Math.max(...a)-Math.min(...a)<=1};
  const equals=(s,expected)=>{const a=rgb(s);return a.length===3&&a.every((x,i)=>Math.abs(x-expected[i])<1)};
  assert.ok(equals(colors.page.bg,[249,249,249]),JSON.stringify(colors.page));
  assert.ok(equals(colors.parent.bg,[249,249,249]),JSON.stringify(colors.parent));
  assert.ok(colors.nodes.some(n=>n.cls.includes("pp-sdk-production-main-surface")),"Main editor surface must be styled");
  for(const n of colors.nodes){
   assert.ok(neutral(n.bg)&&neutral(n.border),JSON.stringify(n));
   if(n.cls.includes("pp-sdk-production-op-head"))assert.ok(equals(n.bg,[249,249,249]),JSON.stringify(n));
   else if(/pp-sdk-production-(op-card|op-body|main-surface)/.test(n.cls))assert.ok(equals(n.bg,[255,255,255]),JSON.stringify(n));
  }
  for(const chain of colors.ancestry)for(const n of chain)assert.ok(neutral(n.bg),"Legacy tinted ancestor: "+JSON.stringify(n));
  const tinted=colors.nativeBg.filter(n=>!neutral(n.bg));
  assert.deepEqual(tinted,[],"No tinted structural background in Production");
  const save=colors.buttons.find(b=>b.variant==="solid");assert.ok(save&&Math.abs(save.height-40)<1,JSON.stringify(colors.buttons));
  const selected=colors.buttons.find(b=>b.variant==="soft");assert.ok(selected,JSON.stringify(colors.buttons));
 };
 await nav(/^(Production|Производство)$/).click();await inspectProduction("PRODUCTION_EN");
 await verifySurfaces("EN");
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
 await inspectProduction("PRODUCTION_SAVED");await verifySurfaces("SAVED");
 const original=await page.evaluate(()=>JSON.stringify(model));
 const rowCount=await section.locator(".pp-rr-table [data-r]").count();
 await section.locator("[data-radd]").first().click();
 await page.waitForFunction(n=>document.querySelectorAll("#sectionView .pp-rr-table [data-r]").length===n+1,rowCount);
 await inspectProduction("PRODUCTION_NEW_ROW");await verifySurfaces("NEW_ROW");
 assert.equal(await page.evaluate(()=>JSON.stringify(model)),original,"unsaved production edits do not change model");
 await page.locator("#ppLanguageSelect").selectOption("ru");await page.waitForFunction(()=>document.querySelector("#sectionView h1")?.textContent.trim()==="Производство");await inspectProduction("PRODUCTION_RU");await verifySurfaces("RU");
 await page.locator("#ppLanguageSelect").selectOption("en");

 await page.screenshot({path:"/tmp/production-sdk-surfaces-"+(live?"live":"candidate")+".png"});
 await nav(/^(Orders|Заказы)$/).click();
 await page.waitForFunction(()=>!document.querySelector("#sectionView.pp-sdk-production-editor")&&document.querySelector("#sectionView.pp-sdk-resource-editor .pp-sdk-InputContainer"),null,{timeout:15000});
 assert.equal(await page.locator("#sectionView .pp-sdk-production-op-card").count(),0);
 await nav(/^(Production|Производство)$/).click();await inspectProduction("RETURN");await verifySurfaces("RETURN");

 // Exercise the native assistant UI with deterministic replies on an isolated QA project.
 await nav(/^(Plan|План)$/).click();
 const panel=page.locator(".assist.pp-sdk-assistant"),input=panel.locator("#chatInput"),send=panel.locator("#chatSend");
 await panel.waitFor({state:"visible"});await input.waitFor({state:"visible"});await send.locator(".pp-sdk-ButtonInner").waitFor({state:"visible"});
 const ask=async(message,proposal=false)=>{
   await page.route("**/api/assistant",async route=>{
     const body=route.request().postDataJSON();assert.equal(body.message,message);assert.equal(body.allowActions,true);
     let action;
     if(proposal)action=await page.evaluate(()=>{
       const snapshot=ppGroqLocalEntry(),args={kind:"add_order",quantity:600};
       const {change}=ppGroqPrepareEdit(snapshot.model,args);
       return {projectId:snapshot.id,revision:snapshot.revision,args,change};
     });
     await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ok:true,reply:proposal?"Confirm the proposed change.":"Synthetic SDK assistant reply. "+("Long production parameter ".repeat(10)),...(proposal?{mode:"edit_proposal",action}:{mode:"answer"})})});
   },{times:1});
   const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/assistant"&&r.request().method()==="POST",{timeout:15000});
   await input.fill(message);await send.click();assert.ok((await response).ok());
   await page.waitForFunction(()=>!document.getElementById("chatSend").disabled,null,{timeout:15000});
   await panel.locator('[data-groq-message="assistant"]').last().waitFor({state:"visible"});
 };
 await ask("QA production question");
 const verifyChat=async label=>{
   const d=JSON.parse(await panel.evaluate(s=>{
     const style=(e,p)=>getComputedStyle(e,p),rect=e=>e.getBoundingClientRect(),prop=(e,p)=>style(e).getPropertyValue(p).trim();
     const pack=e=>({tag:e.tagName,cls:e.className,text:e.textContent.trim().slice(0,80),bg:style(e).backgroundColor,color:style(e).color,border:style(e).borderTopColor,radius:style(e).borderRadius,font:style(e).fontFamily,size:style(e).fontSize,h:rect(e).height,w:rect(e).width,scroll:e.scrollWidth,client:e.clientWidth});
     const b=s.querySelector("#chatSend"),i=s.querySelector("#chatInput");
     const canvas=document.createElement("canvas");canvas.width=canvas.height=1;const ctx=canvas.getContext("2d");ctx.fillStyle=style(b,"::before").backgroundColor;ctx.fillRect(0,0,1,1);const fillRgb=Array.from(ctx.getImageData(0,0,1,1).data);
     return JSON.stringify({panel:pack(s),messages:pack(s.querySelector("#messages")),user:pack([...s.querySelectorAll('[data-groq-message="user"]')].at(-1)),assistant:pack([...s.querySelectorAll('[data-groq-message="assistant"]')].at(-1)),composer:pack(i.parentElement),field:pack(i),send:{...pack(b),fill:style(b,"::before").backgroundColor,fillRgb,variant:b.dataset.variant,solid:prop(b,"--color-background-primary-solid"),inner:!!b.querySelector(".pp-sdk-ButtonInner")},notice:pack(s.querySelector("#ppGroqNotice")),actions:[...s.querySelectorAll("[data-groq-apply],[data-groq-cancel]")].map(b=>({...pack(b),variant:b.dataset.variant,inner:!!b.querySelector(".pp-sdk-ButtonInner")}))});
   }));
   console.log("ASSISTANT_SDK_LAYOUT_"+label,JSON.stringify(d));
   assert.equal(d.panel.bg,"rgb(255, 255, 255)");assert.equal(d.user.bg,"rgb(237, 237, 237)");assert.equal(d.assistant.bg,"rgba(0, 0, 0, 0)");
   for(const e of [d.user,d.assistant]){assert.equal(e.color,"rgb(13, 13, 13)");assert.equal(e.size,"14px");assert.ok(e.scroll<=e.client+2)}
   assert.equal(d.field.size,"16px");assert.ok(d.field.h>=59&&d.composer.radius==="16px");assert.equal(d.send.variant,"solid");assert.ok(d.send.inner&&Math.abs(d.send.h-40)<1&&Math.abs(d.send.w-40)<1&&parseFloat(d.send.radius)>=20);
   assert.ok(d.send.fillRgb.every((v,i)=>i===3?v===255:v>=23&&v<=49)&&Math.max(...d.send.fillRgb.slice(0,3))-Math.min(...d.send.fillRgb.slice(0,3))<=1,JSON.stringify(d.send));
   assert.equal(d.notice.size,"12px");assert.equal(d.notice.color,"rgb(93, 93, 93)");
   for(const a of d.actions)assert.ok(a.inner&&Math.abs(a.h-32)<1&&parseFloat(a.radius)>=16,JSON.stringify(a));
   return d;
 };
 await verifyChat("REPLY");
 const beforeChat=await page.evaluate(()=>JSON.stringify(model));
 await ask("QA add another order",true);
 const proposal=panel.locator('[data-groq-action="pending"]').last();await proposal.waitFor({state:"visible"});
 await proposal.locator('[data-groq-apply] .pp-sdk-ButtonInner').waitFor({state:"visible"});
 const layout=await verifyChat("PROPOSAL");
 assert.equal(layout.actions.length,2);assert.equal(layout.actions[0].variant,"solid");assert.equal(layout.actions[1].variant,"outline");
 assert.equal(await page.evaluate(()=>JSON.stringify(model)),beforeChat,"AI proposal must not change the project before confirmation");
 await proposal.locator("[data-groq-cancel]").click();assert.equal(await proposal.getAttribute("data-groq-action"),"cancelled");
 assert.equal(await page.evaluate(()=>JSON.stringify(model)),beforeChat,"Cancel must not change project");
 await page.locator("#ppLanguageSelect").selectOption("ru");await verifyChat("RU");
 await page.locator("#ppLanguageSelect").selectOption("en");
 await page.screenshot({path:"/tmp/assistant-sdk-"+(live?"live":"candidate")+".png"});
 console.log("ASSISTANT_SDK_BROWSER_"+(live?"LIVE":"CANDIDATE")+"_PASS");
 assert.deepEqual(errors,[],"No uncaught page errors");
 console.log("PRODUCTION_SDK_SURFACES_BROWSER_"+(live?"LIVE":"CANDIDATE")+"_PASS");
}finally{await browser.close()}
