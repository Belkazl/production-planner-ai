import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {css,script,ppFindTopNav,transformTopNav} from "./patch.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-top-nav-test/node_modules/playwright-core");
const base="https://app.liftorbit.app",live=process.env.PP_TOP_NAV_LIVE==="1";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:45000});
 const register=await page.evaluate(async({email,password})=>(await fetch("/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,company:"Synthetic primary navigation QA"})})).status,{email:"primary-nav-qa-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(25).toString("base64url")});
 assert.equal(register,200);
 // Open a valid synthetic project, since the empty-account Projects screen
 // hides the planner chat until a project is active.
 const id="prj_units_"+randomUUID().replaceAll("-","").slice(0,13);
 const seeded=await page.evaluate(async id=>{
  const model={scheduler_mode:"resource",quantity_unit:"m2",start:"2026-11-25T00:00:00",
   equipment:[{id:"M1",name:"Synthetic machine",kind:"workstation",capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"fixed",duration_min:10}}],
   orders:[{id:"2601",quantity:600,area:600,unit:"m2",technical_process_id:"P",parameters:{color:"A"}}],
   employees:[{id:"E1",name:"Тестовый сотрудник",role:"Тестовая роль",shift:"day"}],materials:[],shifts:{day:[["08:00","12:00"],["13:00","19:00"]]},shift_calendars:{day:{name:"day",days:[1,2,3,4,5],start:"08:00",end:"19:00",breaks:[["12:00","13:00"]],full_day:true}},constraints:[],setup_rules:[],
   technical_processes:[{id:"P",name:"Synthetic process",operations:[{id:"OP",name:"Synthetic work",sequence:1,duration_min:10,resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"M1",resource_refs:["M1"],quantity:1,unit:"pcs"}]}]}]};
  const storage={"prodplan.projects.v2":JSON.stringify([{id,name:"Synthetic primary navigation QA",model,revision:1,lastPlan:null}]),"prodplan.project.active.v2":id};
  return (await fetch("/api/db-storage",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({storage})})).status;
 },id);
 assert.equal(seeded,200);
 const pageErrors=[];page.on("pageerror",e=>pageErrors.push(String(e).slice(0,180)));
 const ready=async()=>{
  await page.reload({waitUntil:"domcontentloaded",timeout:45000});
  await page.waitForFunction(()=>window.__PP_LANGUAGE__?.installed&&typeof model==="object"&&model?.employees?.length===1&&document.querySelectorAll(".side .item").length===10,{},{timeout:30000});
 };
 const inspect=()=>page.evaluate(findSource=>{
  const find=Function("return ("+findSource+")")(),group=find(document);
  const visible=item=>item.getClientRects().length>0&&getComputedStyle(item).display!=="none";
  const text=item=>item.textContent.replace(/\s+/g," ").trim();
  return {top:group?group.rows.map(({item,key})=>({key,label:text(item),visible:visible(item),aria:item.getAttribute("aria-hidden")})):null,
   group:group?{tag:group.node.tagName,className:group.node.className,id:group.node.id}:null,
   side:[...document.querySelectorAll(".side .item")].map(item=>({label:text(item),visible:visible(item),active:item.classList.contains("active")})),
   model:JSON.stringify(model)};
 },ppFindTopNav.toString());
 let baseline;
 if(!live){
  await ready();baseline=await inspect();
  console.log("TOP_NAV_BASELINE",JSON.stringify({group:baseline.group,top:baseline.top,side:baseline.side}));
  assert(baseline.top&&baseline.top.length===5,"native five-item top navigation found");
  assert(baseline.top.every(r=>r.visible),"original menu visible");
  await page.route("**/",async route=>{
   if(!route.request().isNavigationRequest()||new URL(route.request().url()).pathname!=="/")return route.continue();
   const response=await route.fetch(),old=await response.text(),out=transformTopNav(old,css,script);
   assert.notEqual(out,old,"authenticated HTML transform");
   assert.equal(transformTopNav(out,css,script),out,"idempotent patch");
   await route.fulfill({response,body:out,headers:{...response.headers(),"content-type":"text/html; charset=utf-8"}});
  });
 }
 await ready();
 const verify=async()=>{
  const r=await inspect();
  assert(r.top&&r.top.length===5,"same native navigation items");
  assert.deepEqual(r.top.filter(x=>x.visible).map(x=>x.key),["projects","planning","documents"]);
  assert(r.top.filter(x=>!x.visible).every(x=>x.aria==="true"));
  assert.equal(r.side.length,10);
  assert(r.side.every(x=>x.visible));
  assert(r.side.some(x=>/^(Analytics|Аналитика)$/.test(x.label)));
  assert(r.side.some(x=>/^(Scenarios|Сценарии)$/.test(x.label)));
  return r;
 };
 await page.locator("#ppLanguageSelect").selectOption("en");
 const initial=await verify();
 for(const key of ["analytics","scenarios"]){
  const target=page.locator(".side .item").filter({hasText:key==="analytics"?/^(Analytics|Аналитика)$/:/^(Scenarios|Сценарии)$/});
  assert.equal(await target.count(),1);await target.click();
  await page.waitForFunction(key=>[...document.querySelectorAll(".side .item.active")].some(x=>(key==="analytics"?/^(Analytics|Аналитика)$/:/^(Scenarios|Сценарии)$/).test(x.textContent.trim())),key,{timeout:10000});
  await verify();
 }
 await page.locator("#ppLanguageSelect").selectOption("ru");await verify();
 await page.locator("#ppLanguageSelect").selectOption("en");const final=await verify();
 assert.equal(final.model,initial.model,"navigation does not alter production model");
 assert.deepEqual(pageErrors,[],"no page errors");
 await page.screenshot({path:"/tmp/liftorbit-top-nav-"+(live?"live":"candidate")+".png"});
 console.log("TOP_NAV_BROWSER_PASS",JSON.stringify({live,visible:final.top.filter(x=>x.visible).map(x=>x.key),sideItems:final.side.length,bothLanguages:true,modelUnchanged:true}));
}finally{await browser.close()}
