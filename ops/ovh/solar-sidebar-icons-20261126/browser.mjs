import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {css,script,transformSolarNav} from "./patch.mjs";
import {icons} from "./icons.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-solar-test/node_modules/playwright-core");
const base="https://app.liftorbit.app",live=process.env.PP_SOLAR_LIVE==="1";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:45000});
 const register=await page.evaluate(async({email,password})=>(await fetch("/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,company:"Synthetic Solar sidebar QA"})})).status,{email:"solar-sidebar-qa-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(25).toString("base64url")});
 assert.equal(register,200);
 // Open a valid synthetic project, since the empty-account Projects screen
 // hides the planner chat until a project is active.
 const id="prj_units_"+randomUUID().replaceAll("-","").slice(0,13);
 const seeded=await page.evaluate(async id=>{
  const model={scheduler_mode:"resource",quantity_unit:"m2",start:"2026-11-25T00:00:00",
   equipment:[{id:"M1",name:"Synthetic machine",kind:"workstation",capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"fixed",duration_min:10}}],
   orders:[{id:"2601",quantity:600,area:600,unit:"m2",technical_process_id:"P",parameters:{color:"A"}}],
   employees:[],materials:[],shifts:{},constraints:[],setup_rules:[],
   technical_processes:[{id:"P",name:"Synthetic process",operations:[{id:"OP",name:"Synthetic work",sequence:1,duration_min:10,resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"M1",resource_refs:["M1"],quantity:1,unit:"pcs"}]}]}]};
  const storage={"prodplan.projects.v2":JSON.stringify([{id,name:"Synthetic Solar sidebar QA",model,revision:1,lastPlan:null}]),"prodplan.project.active.v2":id};
  return (await fetch("/api/db-storage",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({storage})})).status;
 },id);
 assert.equal(seeded,200);
 const inspect=()=>page.evaluate(()=>{
  const rail=document.querySelector(".side");
  return [...(rail?.querySelectorAll(".item")||[])].map(item=>{
   const box=item.getBoundingClientRect();
   const svg=item.querySelector("svg[data-pp-solar-icon]");
   const holder=item.querySelector("[data-pp-solar-holder]");
   const iconBox=svg?.getBoundingClientRect();
   return {label:item.textContent.trim(),active:item.classList.contains("active"),itemWidth:box.width,itemHeight:box.height,
    icon:svg?.getAttribute("data-pp-solar-icon")||null,key:holder?.getAttribute("data-pp-solar-holder")||null,iconWidth:iconBox?.width??0,iconHeight:iconBox?.height??0,
    paths:svg?.querySelectorAll("path,circle,rect,ellipse,line,polyline,polygon").length||0,viewBox:svg?.getAttribute("viewBox")||null,
    pseudo:["before","after"].map(which=>{const c=getComputedStyle(item,"::"+which);return {which,content:c.content,display:c.display,width:c.width,height:c.height,position:c.position,margin:c.margin,boxSizing:c.boxSizing}}),color:svg?getComputedStyle(svg).color:null,itemColor:getComputedStyle(item).color,children:[...item.children].map(e=>({tag:e.tagName,className:typeof e.className==="string"?e.className:"svg",text:e.textContent.trim().slice(0,70),w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}))};
  });
 });
 const ready=async()=>{await page.reload({waitUntil:"domcontentloaded",timeout:45000});await page.waitForFunction(()=>document.querySelectorAll(".side .item").length>=10&&typeof model==="object"&&model?.orders?.length===1,{},{timeout:30000});};
 let baseline;
 if(!live){
  await ready();baseline=await inspect();
  console.log("SOLAR_NAV_BASELINE",JSON.stringify(baseline.map(x=>({label:x.label,children:x.children,pseudo:x.pseudo}))));
  await page.route("**/",async route=>{
   if(!route.request().isNavigationRequest()||new URL(route.request().url()).pathname!=="/")return route.continue();
   const response=await route.fetch(),html=await response.text();
   const out=transformSolarNav(html,css,script);assert.notEqual(out,html,"authenticated HTML transform");
   await route.fulfill({response,body:out,headers:{...response.headers(),"content-type":"text/html; charset=utf-8"}});
  });
 }
 await ready();
 await page.waitForFunction(()=>document.querySelectorAll(".side .item svg[data-pp-solar-icon]").length===10,{},{timeout:15000});
 const result=await inspect();
 const replaced=result.filter(x=>x.icon);
 assert.equal(replaced.length,10);
 assert.equal(new Set(replaced.map(x=>x.icon)).size,10);
 for(const expected of icons){
  const actual=replaced.find(x=>x.key===expected.key);
  assert(actual,expected.key);
  assert.equal(actual.icon,expected.icon);
  assert.equal(actual.viewBox,"0 0 24 24");
  assert(actual.paths>0,expected.icon);
  assert(actual.iconWidth>=10&&actual.iconWidth<=60&&actual.iconHeight>=10&&actual.iconHeight<=60,expected.icon+" size");
  assert.equal(actual.color,actual.itemColor,expected.icon+" inherited color");
  if(baseline){
   const before=baseline.find(x=>x.label===actual.label);
   assert(before,actual.label+" unchanged");
   assert(Math.abs(actual.itemWidth-before.itemWidth)<2,actual.label+" item width");
   assert(Math.abs(actual.itemHeight-before.itemHeight)<2,actual.label+" item height");
  }
 }
 // Click native navigation, then switch the interface language where present.
 for(const key of ["orders","chat"]){
  const item=page.locator('.side .item').filter({has:page.locator('[data-pp-solar-holder="'+key+'"]')});
  if(await item.isVisible()){await item.click();await page.waitForFunction(key=>document.querySelector('[data-pp-solar-holder="'+key+'"]')?.closest(".item")?.classList.contains("active"),key,{timeout:10000});}
 }
 const language=page.locator("#ppLanguageSelect");
 if(await language.count()&&await language.isVisible()){
  for(const code of ["ru","en"]){
   await language.selectOption(code);
   await page.waitForFunction(()=>document.querySelectorAll(".side .item svg[data-pp-solar-icon]").length===10,{},{timeout:10000});
  }
 }
 await page.screenshot({path:"/tmp/liftorbit-solar-sidebar-"+(live?"live":"candidate")+".png"});
 console.log("SOLAR_NAV_BROWSER_PASS",JSON.stringify({live,icons:replaced.map(x=>({key:x.key,icon:x.icon,w:x.iconWidth,h:x.iconHeight}))}));
}finally{await browser.close()}
