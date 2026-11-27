import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {css,script,transformScroll} from "./patch.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-scroll-test/node_modules/playwright-core");
const base="https://app.liftorbit.app",live=process.env.PP_INDEPENDENT_SCROLL_LIVE==="1";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:45000});
 const register=await page.evaluate(async({email,password})=>(await fetch("/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,company:"Synthetic independent scroll QA"})})).status,{email:"independent-scroll-qa-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(25).toString("base64url")});
 assert.equal(register,200);
 // Open a valid synthetic project, since the empty-account Projects screen
 // hides the planner chat until a project is active.
 const id="prj_units_"+randomUUID().replaceAll("-","").slice(0,13);
 const seeded=await page.evaluate(async id=>{
  const model={scheduler_mode:"resource",quantity_unit:"m2",start:"2026-11-25T00:00:00",
   equipment:[{id:"M1",__ppid:"M1",name:"Synthetic machine",kind:"workstation",capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"fixed",duration_min:10}}],
   autoclaves:[{id:"M1",__ppid:"M1",name:"Synthetic machine",kind:"workstation",capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"fixed",duration_min:10}}],
   orders:[{id:"2601",quantity:600,area:600,unit:"m2",technical_process_id:"P",parameters:{color:"A"}}],
   employees:[{id:"E1",name:"Тестовый сотрудник",role:"Тестовая роль",shift:"day"}],materials:[{id:"MAT1",name:"Synthetic powder",unit:"kg",initial_stock:20000,deliveries:[]},{id:"MAT2",name:"Synthetic boxes",unit:"pcs",initial_stock:20000,deliveries:[]}],shifts:{day:[["08:00","12:00"],["13:00","19:00"]]},shift_calendars:{day:{name:"day",days:[1,2,3,4,5],start:"08:00",end:"19:00",breaks:[["12:00","13:00"]],full_day:true}},constraints:[],setup_rules:[],
   technical_processes:[{id:"P",name:"Synthetic process",operations:[{id:"OP",name:"Synthetic work",sequence:1,duration_min:10,resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"M1",resource_refs:["M1"],quantity:1,unit:"pcs",consumption_rule:"during_operation"},{id:"R2",resource_type:"employee",match_mode:"specific",resource_ref:"E1",resource_refs:["E1"],quantity:1,unit:"person",consumption_rule:"during_operation"},{id:"R3",resource_type:"material",match_mode:"specific",resource_ref:"MAT1",resource_refs:["MAT1"],quantity:18.5,unit:"kg",consumption_rule:"per_m2"}]}]},{id:"P2",name:"Synthetic second process",operations:[{id:"OP2",name:"Synthetic second work",sequence:1,duration_min:5,resource_requirements:[{id:"R4",resource_type:"material",match_mode:"specific",resource_ref:"MAT2",resource_refs:["MAT2"],quantity:2,unit:"pcs",consumption_rule:"per_m2"}]}]}]};
  const p=model.technical_processes[0],template=structuredClone(p.operations[0]);
  for(let i=2;i<=24;i++){const op=structuredClone(template);op.id="SCROLL_OP_"+i;op.sequence=i;op.name="Synthetic operation "+i;for(let j=0;j<op.resource_requirements.length;j++)op.resource_requirements[j].id="SCROLL_R_"+i+"_"+j;p.operations.push(op)}
  const storage={"prodplan.projects.v2":JSON.stringify([{id,name:"Synthetic independent scroll QA",model,revision:1,lastPlan:null}]),"prodplan.project.active.v2":id};
  return (await fetch("/api/db-storage",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({storage})})).status;
 },id);
 assert.equal(seeded,200);
 const pageErrors=[];page.on("pageerror",e=>pageErrors.push(String(e).slice(0,220)));
 const ready=async()=>{
  await page.reload({waitUntil:"domcontentloaded",timeout:45000});
  await page.waitForFunction(()=>window.__PP_LANGUAGE__?.installed&&typeof model==="object"&&model?.technical_processes?.[0]?.operations?.length===24,{},{timeout:30000});
  await page.locator("#ppLanguageSelect").selectOption("en");
  await page.locator(".side .item").filter({hasText:/^(Production|Производство)$/}).click();
  await page.waitForFunction(()=>document.querySelectorAll("#sectionView .pp-rr-table").length>=24,{},{timeout:15000});
 };
 const inspect=()=>page.evaluate(()=>{
  const measure=e=>{
   if(!e)return null;const b=e.getBoundingClientRect(),s=getComputedStyle(e);
   return {top:b.top,bottom:b.bottom,left:b.left,right:b.right,width:b.width,height:b.height,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,scrollTop:e.scrollTop,display:s.display,position:s.position,overflowY:s.overflowY,overflowX:s.overflowX,className:e.className};
  };
  const q=s=>document.querySelector(s);
  return {viewport:{w:innerWidth,h:innerHeight},root:measure(document.scrollingElement),body:measure(document.body),
   top:measure(q(".top")),shell:measure(q(".shell")),side:measure(q(".shell>.side")),assist:measure(q(".shell>.assist")),main:measure(q(".shell>.main")),messages:measure(q(".assist #messages")),compose:measure(q(".assist .compose")),
   items:[...document.querySelectorAll(".side .item")].map(e=>({label:e.textContent.trim(),...measure(e)})),fixed:document.body.hasAttribute("data-pp-fixed-shell")};
 });
 const mobileState=async()=>{
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>innerWidth===390);
  const r=await inspect();return {root:r.root.overflowY,body:r.body.overflowY,shell:r.shell.overflowY,main:r.main.overflowY,side:r.side.overflowY,assist:r.assist.overflowY};
 };
 let mobileBaseline;
 if(!live){
  await ready();const baseline=await inspect();
  console.log("SCROLL_BASELINE",JSON.stringify({root:baseline.root,top:baseline.top,shell:baseline.shell,side:baseline.side,assist:baseline.assist,main:baseline.main,messages:baseline.messages,compose:baseline.compose}));
  assert.equal(baseline.items.length,10);
  mobileBaseline=await mobileState();
  await page.setViewportSize({width:1440,height:900});
  await page.route("**/",async route=>{
   if(!route.request().isNavigationRequest()||new URL(route.request().url()).pathname!=="/")return route.continue();
   const response=await route.fetch(),old=await response.text(),out=transformScroll(old,css,script);
   assert.notEqual(out,old,"exact authenticated HTML");assert.equal(transformScroll(out,css,script),out);
   await route.fulfill({response,body:out,headers:{...response.headers(),"content-type":"text/html; charset=utf-8"}});
  });
 }
 await ready();
 const original=await page.evaluate(()=>JSON.stringify(model));
 const approx=(a,b,tol=2)=>assert(Math.abs(a-b)<=tol,JSON.stringify({a,b,tol}));
 const check=async({width,height})=>{
  await page.setViewportSize({width,height});
  await page.waitForFunction(()=>document.body.hasAttribute("data-pp-fixed-shell")&&document.querySelector(".shell>.main")?.scrollHeight>document.querySelector(".shell>.main")?.clientHeight+100,{},{timeout:15000});
  await page.evaluate(()=>{document.querySelector(".shell>.main").scrollTop=0;document.querySelector(".shell>.side").scrollTop=0;document.querySelector("#messages").scrollTop=0;});
  const initial=await inspect();
  console.log("SCROLL_LAYOUT",JSON.stringify({viewport:initial.viewport,top:initial.top,shell:initial.shell,side:initial.side,main:initial.main,assist:initial.assist,messages:initial.messages,compose:initial.compose}));
  assert.equal(initial.items.length,10);assert.equal(initial.root.overflowY,"hidden");
  assert.equal(initial.main.overflowY,"auto");assert.equal(initial.side.overflowY,"auto");
  assert.equal(initial.messages.overflowY,"auto");
  approx(initial.top.top,0,3);approx(initial.shell.top,initial.top.bottom,3);
  for(const name of ["side","assist","main"]){approx(initial[name].top,initial.shell.top,3);approx(initial[name].bottom,height,3)}
  assert(initial.compose.bottom<=height+1&&initial.compose.height>20,"composer remains in viewport");
  // All ten items fit on standard desktop screens; on shorter ones the rail
  // itself may scroll, but the work area's scroll never moves it.
  if(height>=720)for(const item of initial.items)assert(item.top>=initial.side.top-1&&item.bottom<=initial.side.bottom+1,JSON.stringify(item));
  await page.mouse.move(initial.main.left+Math.min(200,initial.main.width/2),initial.main.top+Math.min(180,initial.main.height/2));
  await page.mouse.wheel(0,1300);
  await page.waitForFunction(()=>document.querySelector(".shell>.main").scrollTop>200,{},{timeout:6000});
  const moved=await inspect();
  for(const key of ["top","shell","side","assist","compose"]){approx(moved[key].top,initial[key].top);approx(moved[key].bottom,initial[key].bottom)}
  approx(moved.root.scrollTop,0);approx(moved.side.scrollTop,initial.side.scrollTop);approx(moved.messages.scrollTop,initial.messages.scrollTop);
  for(let i=0;i<10;i++)approx(moved.items[i].top,initial.items[i].top);
  // Reach the last operation using the actual native scroll container.
  await page.evaluate(()=>{const el=document.querySelector(".shell>.main");el.scrollTop=el.scrollHeight});
  const end=await inspect();assert(end.main.scrollTop>200);approx(end.main.scrollHeight-end.main.clientHeight,end.main.scrollTop,3);approx(end.compose.bottom,initial.compose.bottom);
  console.log("SCROLL_WORK_AREA_PASS",JSON.stringify({width,height,mainScroll:end.main.scrollTop,rootScroll:end.root.scrollTop,navFixed:true}));
 };
 await check({width:1440,height:900});await check({width:1280,height:720});await check({width:1024,height:600});
 await page.setViewportSize({width:1440,height:900});
 // Independent chat scrolling, with no message requests or production-data changes.
 await page.evaluate(()=>{
  const m=document.querySelector("#messages");m.querySelectorAll("[data-scroll-fixture]").forEach(e=>e.remove());
  for(let i=0;i<60;i++){const e=document.createElement("div");e.className="bubble";e.dataset.scrollFixture="";e.textContent="Synthetic chat history "+i+" — "+("Long test message. ".repeat(6));m.append(e)}
  m.scrollTop=0;document.querySelector(".shell>.main").scrollTop=300;
 });
 const chatStart=await inspect();assert(chatStart.messages.scrollHeight>chatStart.messages.clientHeight+300);
 await page.mouse.move(chatStart.messages.left+Math.min(100,chatStart.messages.width/2),chatStart.messages.top+Math.min(100,chatStart.messages.height/2));
 await page.mouse.wheel(0,1100);
 await page.waitForFunction(()=>document.querySelector("#messages").scrollTop>200,{},{timeout:6000});
 const chatEnd=await inspect();approx(chatEnd.main.scrollTop,chatStart.main.scrollTop);approx(chatEnd.top.top,chatStart.top.top);approx(chatEnd.compose.bottom,chatStart.compose.bottom);approx(chatEnd.side.top,chatStart.side.top);
 // Native sidebar remains clickable while the working area is scrolled.
 await page.locator(".side .item").filter({hasText:/^(Orders|Заказы)$/}).click();
 try{await page.waitForFunction(()=>[...document.querySelectorAll(".side .item.active")].some(x=>/^(Orders|Заказы)$/.test(x.textContent.trim())),{},{timeout:10000})}catch(e){const state=await inspect();console.log("SCROLL_NAV_DIAGNOSTIC",JSON.stringify({items:state.items.map(x=>({label:x.label,top:x.top,bottom:x.bottom})),section:await page.locator("#sectionView").innerText().catch(()=>""),active:await page.locator(".side .item.active").allTextContents()}));throw e}
 await page.waitForFunction(()=>document.querySelector(".shell>.main").scrollTop<2,{},{timeout:6000});
 await page.locator(".side .item").filter({hasText:/^(Production|Производство)$/}).click();
 await page.waitForFunction(()=>document.querySelectorAll("#sectionView .pp-rr-table").length>=24,{},{timeout:15000});
 await page.locator(".side .item").filter({hasText:/^(Plan|План)$/}).click();
 await page.waitForFunction(()=>[...document.querySelectorAll(".side .item.active")].some(x=>/^(Plan|План)$/.test(x.textContent.trim()))&&document.querySelector("#planView")?.getClientRects().length>0,{},{timeout:10000});
 assert((await inspect()).main.clientHeight>0);
 await page.locator(".side .item").filter({hasText:/^(Production|Производство)$/}).click();
 await page.waitForFunction(()=>document.querySelectorAll("#sectionView .pp-rr-table").length>=24,{},{timeout:15000});
 if(mobileBaseline){const mobile=await mobileState();assert.deepEqual(mobile,mobileBaseline,"mobile responsive scroll styles unchanged");await page.setViewportSize({width:1440,height:900})}
 // Preserve the existing Projects layout and its own scrolling rules.
 await page.locator(".top .nav span").filter({hasText:/^(Projects|Проекты)$/}).click();
 await page.waitForFunction(()=>document.body.classList.contains("projects-mode"),{},{timeout:10000});
 assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).overflowY)!=="hidden",true,"Projects keeps normal document scrolling");
 await page.locator(".top .nav span").filter({hasText:/^(Planning|Планирование)$/}).click();
 await page.waitForFunction(()=>!document.body.classList.contains("projects-mode"),{},{timeout:10000});
 assert.equal(await page.evaluate(()=>JSON.stringify(model)),original,"layout must not change project data");
 assert.deepEqual(pageErrors,[],"no uncaught page errors");
 await page.locator(".side .item").filter({hasText:/^(Production|Производство)$/}).click();
 await page.screenshot({path:"/tmp/liftorbit-independent-scroll-"+(live?"live":"candidate")+".png"});
 console.log("SCROLL_BROWSER_PASS",JSON.stringify({live,desktopWidths:[1440,1280,1024],workAreaIndependent:true,chatIndependent:true,navigation:true,projectDataUnchanged:true}));
}finally{await browser.close()}
