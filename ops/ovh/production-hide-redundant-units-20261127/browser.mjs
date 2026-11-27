import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {transformProductionUnits} from "./patch.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-production-units-test/node_modules/playwright-core");
const base="https://app.liftorbit.app",live=process.env.PP_PRODUCTION_UNITS_LIVE==="1";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:45000});
 const register=await page.evaluate(async({email,password})=>(await fetch("/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,company:"Synthetic production units QA"})})).status,{email:"production-units-qa-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(25).toString("base64url")});
 assert.equal(register,200);
 // Open a valid synthetic project, since the empty-account Projects screen
 // hides the planner chat until a project is active.
 const id="prj_units_"+randomUUID().replaceAll("-","").slice(0,13);
 const seeded=await page.evaluate(async id=>{
  const model={scheduler_mode:"resource",quantity_unit:"m2",start:"2026-11-25T00:00:00",
   equipment:[{id:"M1",name:"Synthetic machine",kind:"workstation",capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"fixed",duration_min:10}}],
   orders:[{id:"2601",quantity:600,area:600,unit:"m2",technical_process_id:"P",parameters:{color:"A"}}],
   employees:[{id:"E1",name:"Тестовый сотрудник",role:"Тестовая роль",shift:"day"}],materials:[{id:"MAT1",name:"Synthetic powder",unit:"kg",initial_stock:20000,deliveries:[]},{id:"MAT2",name:"Synthetic boxes",unit:"pcs",initial_stock:20000,deliveries:[]}],shifts:{day:[["08:00","12:00"],["13:00","19:00"]]},shift_calendars:{day:{name:"day",days:[1,2,3,4,5],start:"08:00",end:"19:00",breaks:[["12:00","13:00"]],full_day:true}},constraints:[],setup_rules:[],
   technical_processes:[{id:"P",name:"Synthetic process",operations:[{id:"OP",name:"Synthetic work",sequence:1,duration_min:10,resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"M1",resource_refs:["M1"],quantity:1,unit:"pcs",consumption_rule:"during_operation"},{id:"R2",resource_type:"employee",match_mode:"specific",resource_ref:"E1",resource_refs:["E1"],quantity:1,unit:"person",consumption_rule:"during_operation"},{id:"R3",resource_type:"material",match_mode:"specific",resource_ref:"MAT1",resource_refs:["MAT1"],quantity:18.5,unit:"kg",consumption_rule:"per_m2"}]}]}]};
  const storage={"prodplan.projects.v2":JSON.stringify([{id,name:"Synthetic production units QA",model,revision:1,lastPlan:null}]),"prodplan.project.active.v2":id};
  return (await fetch("/api/db-storage",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({storage})})).status;
 },id);
 assert.equal(seeded,200);
 const errors=[];page.on("pageerror",e=>errors.push(String(e)));
 const ready=async()=>{
  await page.reload({waitUntil:"domcontentloaded",timeout:45000});
  await page.waitForFunction(()=>window.__PP_LANGUAGE__?.installed&&typeof model==="object"&&model?.materials?.length===2&&model?.employees?.length===1,{},{timeout:30000});
  await page.locator(".side .item").filter({hasText:/^(Production|Производство)$/}).click();
  await page.waitForFunction(()=>document.querySelectorAll("#sectionView .pp-rr-table [data-rf=unit]").length===3,{},{timeout:15000});
 };
 const inspect=()=>page.evaluate(()=>[...document.querySelectorAll("#sectionView .pp-rr-table [data-r]")].map(row=>{
  const unit=row.querySelector("[data-rf=unit]"),quantity=row.querySelector("[data-rf=quantity]"),wrapper=quantity.parentElement;
  return {type:row.querySelector("[data-rf=resource_type]").value,unit:unit.value,hidden:unit.hidden,display:getComputedStyle(unit).display,visible:unit.getClientRects().length>0,quantity:quantity.value,cells:row.cells.length,quantityWidth:quantity.getBoundingClientRect().width,wrapperWidth:wrapper.getBoundingClientRect().width};
 }));
 if(!live){
  await ready();const baseline=await inspect();assert.equal(baseline.length,3);assert(baseline.every(r=>r.visible));console.log("PRODUCTION_UNITS_BASELINE",JSON.stringify(baseline));
  await page.route("**/",async route=>{
   if(!route.request().isNavigationRequest()||new URL(route.request().url()).pathname!=="/")return route.continue();
   const response=await route.fetch(),old=await response.text(),out=transformProductionUnits(old);
   assert.notEqual(out,old,"exact native requirement renderer");assert.equal(transformProductionUnits(out),out);
   await route.fulfill({response,body:out,headers:{...response.headers(),"content-type":"text/html; charset=utf-8"}});
  });
 }
 await ready();
 const verify=async count=>{
  const rows=await inspect();assert.equal(rows.length,count);
  for(const row of rows){assert(row.hidden&&!row.visible&&row.display==="none",JSON.stringify(row));assert.equal(row.cells,6);assert(Math.abs(row.wrapperWidth-row.quantityWidth)<2,JSON.stringify(row))}
  return rows;
 };
 const source=await page.evaluate(()=>JSON.stringify(model));
 await page.locator("#ppLanguageSelect").selectOption("en");
 const rows=await verify(3);
 const materialRow=page.locator("#sectionView .pp-rr-table [data-r]").nth(2);
 assert.equal(rows[2].type,"material");
 assert.match(rows[2].unit,/^(kg|кг)$/);
 await materialRow.locator("[data-rf=resource_ref]").selectOption("MAT2");
 let changed=await verify(3);assert.match(changed[2].unit,/^(pcs|шт\.?)$/);
 assert.equal(changed[2].quantity,"18.5");
 await materialRow.locator("[data-rf=resource_ref]").selectOption("MAT1");
 changed=await verify(3);assert.match(changed[2].unit,/^(kg|кг)$/);
 await page.locator("#sectionView [data-radd]").first().click();
 await verify(4);
 await page.locator("#ppLanguageSelect").selectOption("ru");await verify(4);
 await page.locator("#ppLanguageSelect").selectOption("en");await verify(4);
 assert.equal(await page.evaluate(()=>JSON.stringify(model)),source,"unsaved UI edits do not mutate model");
 await page.locator(".side .item").filter({hasText:/^(Materials|Материалы)$/}).click();
 const units=await page.locator("#sectionView [data-f=unit]").evaluateAll(es=>es.map(e=>e.value));
 assert.equal(units.length,2);assert.match(units[0],/^(kg|кг)$/);assert.match(units[1],/^(pcs|шт\.?)$/);
 assert.deepEqual(errors,[],"no page errors");
 console.log("PRODUCTION_UNITS_BROWSER_PASS",JSON.stringify({live,hiddenRows:4,materialsUnitsPreserved:units,canonicalSelection:true,modelUnchanged:true}));
}finally{await browser.close()}
