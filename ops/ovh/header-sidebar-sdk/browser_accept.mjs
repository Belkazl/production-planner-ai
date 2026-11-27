import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {patchPreview} from "./patch.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-equipment-sdk-toolbar-test/node_modules/playwright-core");
const live=process.env.PP_HEADER_SIDEBAR_SDK_LIVE==="1";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900},timezoneId:"Europe/Ljubljana"});
 const request=(path,method="GET",body)=>page.evaluate(async({path,method,body})=>{
  const r=await fetch(path,{method,credentials:"same-origin",cache:"no-store",...(body?{headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{})});
  return {status:r.status,data:await r.json().catch(()=>({}))};
 },{path,method,body});
 await page.goto("https://app.liftorbit.app/",{waitUntil:"domcontentloaded",timeout:45000});
 assert.equal((await request("/api/auth/register","POST",{email:"shell-sdk-qa-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(25).toString("base64url"),company:"Synthetic navigation QA"})).status,200);
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
 await page.waitForFunction(()=>window.__PP_HEADER_SIDEBAR_SDK_V1__&&window.__PP_PLAN_DEFAULT_NAV_V1__&&window.__PP_LANGUAGE__?.installed&&typeof model==="object"&&model?.orders?.length===2,null,{timeout:30000});
 await page.locator("#ppLanguageSelect").selectOption("en");
 if(await page.evaluate(()=>document.body.classList.contains("projects-mode")))await page.locator(".top .nav > span").filter({hasText:/^(Planning|Планирование)$/}).click();
 await waitPlan(id);

 const verifyShell=async label=>{
  await page.waitForFunction(()=>document.querySelector(".top.pp-sdk-header .nav>[data-pp-sdk-current]")&&document.querySelector("#ppProtectedAccount.pp-sdk-header-account #ppProtectedLogout .pp-sdk-ButtonInner"),null,{timeout:12000});
  await page.mouse.move(0,0);await page.waitForTimeout(200);
  const d=JSON.parse(await page.evaluate(()=>{
   const style=e=>getComputedStyle(e),rect=e=>e.getBoundingClientRect(),visible=e=>rect(e).width>0&&rect(e).height>0;
   const pack=e=>({text:e.textContent.trim().slice(0,80),id:e.id,cls:String(e.className),bg:style(e).backgroundColor,color:style(e).color,border:style(e).borderTopColor,radius:style(e).borderRadius,font:style(e).fontFamily,size:style(e).fontSize,weight:style(e).fontWeight,h:rect(e).height,w:rect(e).width,x:rect(e).left,right:rect(e).right,scroll:e.scrollWidth,client:e.clientWidth});
   const top=document.querySelector(".top"),side=document.querySelector(".side"),account=document.getElementById("ppProtectedAccount");
   const lang=document.getElementById("ppLanguageSelect"),logout=document.getElementById("ppProtectedLogout");
   return JSON.stringify({top:pack(top),side:pack(side),account:pack(account),language:pack(lang),logout:pack(logout),projectMode:document.body.classList.contains("projects-mode"),
   tabs:[...top.querySelectorAll(".nav>span")].filter(visible).map(e=>({...pack(e),active:e.hasAttribute("data-pp-sdk-current")})),
   items:[...side.querySelectorAll(".item")].filter(visible).map(e=>({...pack(e),active:e.classList.contains("active"),key:e.querySelector("[data-pp-solar-holder]")?.dataset.ppSolarHolder,icon:e.querySelector("svg[data-pp-solar-icon]")?.getAttribute("data-pp-solar-icon")}))});
  }));
  console.log("HEADER_SIDEBAR_SDK_LAYOUT_"+label,JSON.stringify(d));
  assert.equal(d.top.bg,"rgb(255, 255, 255)");assert.equal(d.side.bg,"rgb(249, 249, 249)");
  assert.ok(d.top.font.includes("system-ui")&&d.side.font.includes("system-ui"));
  assert.equal(d.language.size,"14px");assert.equal(d.language.weight,"400");assert.ok(Math.abs(d.language.h-40)<1&&parseFloat(d.language.radius)>=20);
  assert.ok(Math.abs(d.logout.h-40)<1&&parseFloat(d.logout.radius)>=20);
  assert.equal(d.tabs.filter(t=>t.active).length,1);for(const t of d.tabs){assert.ok(t.h>=39&&parseFloat(t.radius)>=20&&t.size==="14px",JSON.stringify(t));assert.equal(t.bg,t.active?"rgb(237, 237, 237)":"rgba(0, 0, 0, 0)")}
  if(!d.projectMode){assert.equal(d.items.length,expected.length);assert.equal(d.items.filter(i=>i.active).length,1);for(const i of d.items){assert.ok(i.h>=39&&parseFloat(i.radius)>=8&&i.icon&&i.size==="14px",JSON.stringify(i));assert.equal(i.bg,i.active?"rgb(237, 237, 237)":"rgba(0, 0, 0, 0)")}}
  assert.ok(d.account.right<=d.top.right+2,"Account controls remain inside viewport");
  for(const t of d.tabs)assert.ok(t.right<=d.account.x+2,"Navigation must not overlap account controls");
  return d;
 };
 await verifyShell("EN");
 assert.deepEqual(await visibleKeys(),expected);
 assert.ok((await page.locator("#messages").innerText()).includes("First project QA response"));
 await page.locator("#chatInput").fill("Unsaved draft QA");
 for(const key of expected){
  await nav(key).click();
  await page.waitForFunction(key=>document.querySelector('.side .item.active [data-pp-solar-holder="'+key+'"]')!=null,key);
  assert.equal(await page.locator("#chatInput").isVisible(),true,"assistant on "+key);
  assert.equal(await page.locator("#chatInput").inputValue(),"Unsaved draft QA");
  assert.ok((await page.locator("#messages").innerText()).includes("First project QA response"));
  await verifyShell(key.toUpperCase());
 }
 await page.locator("#ppLanguageSelect").selectOption("ru");await verifyShell("RU");
 assert.deepEqual(await visibleKeys(),expected);
 assert.equal(await nav("chat").isVisible(),false);
 await nav("orders").click();
 await page.locator(".top .nav > span").filter({hasText:/^(Projects|Проекты)$/}).click();await verifyShell("PROJECTS");
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
 await page.waitForFunction(()=>window.__PP_HEADER_SIDEBAR_SDK_V1__&&window.__PP_PLAN_DEFAULT_NAV_V1__&&window.__PP_LANGUAGE__?.installed,null,{timeout:30000});
 await waitPlan(id);
 assert.deepEqual(await visibleKeys(),expected);
 assert.ok(await page.locator("#ppPlanningStartDate").isVisible());
 const stored=JSON.parse((await request("/api/db-storage")).data.storage["prodplan.projects.v2"]);
 assert.equal(stored.find(p=>p.id===id).revision,1);
 assert.equal(stored.find(p=>p.id===id).model.orders[0].ship_by,m.orders[0].ship_by);
 assert.equal(stored.find(p=>p.id===id).messages[1].text,"First project QA response");
 await verifyShell("RELOAD");
 await page.setViewportSize({width:1120,height:900});await verifyShell("NARROW");
 await page.setViewportSize({width:1440,height:900});
 assert.deepEqual(errors,[],"No uncaught page errors");
 await page.screenshot({path:"/tmp/plan-default-nav-"+(live?"live":"candidate")+".png"});
 const logout=page.locator("#ppProtectedLogout");
 const loggedOut=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/auth/logout"&&r.request().method()==="POST",{timeout:15000});
 await logout.click();assert.ok((await loggedOut).ok());await page.locator("#loginTab").waitFor({state:"visible",timeout:20000});
 console.log("HEADER_SIDEBAR_SDK_BROWSER_"+(live?"LIVE":"CANDIDATE")+"_PASS");
}finally{await browser.close()}
