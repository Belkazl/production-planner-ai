import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {transformConsumption} from "./patch.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-consumption-test/node_modules/playwright-core");
const base="https://app.liftorbit.app",live=process.env.PP_CONSUMPTION_LIVE==="1";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:45000});
 const register=await page.evaluate(async({email,password})=>(await fetch("/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,company:"Synthetic consumption QA"})})).status,{email:"consumption-qa-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(25).toString("base64url")});
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
  const storage={"prodplan.projects.v2":JSON.stringify([{id,name:"Synthetic consumption QA",model,revision:1,lastPlan:null}]),"prodplan.project.active.v2":id};
  return (await fetch("/api/db-storage",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({storage})})).status;
 },id);
 assert.equal(seeded,200);
 const errors=[];page.on("pageerror",e=>errors.push(String(e)));
 const ready=async()=>{
  await page.reload({waitUntil:"domcontentloaded",timeout:45000});
  await page.waitForFunction(()=>window.__PP_LANGUAGE__?.installed&&typeof model==="object"&&model?.materials?.length===2&&model?.technical_processes?.length===2,{},{timeout:30000});
  await page.locator(".side .item").filter({hasText:/^(Production|Производство)$/}).click();
  await page.waitForFunction(()=>document.querySelectorAll("#sectionView .pp-rr-table [data-rf=consumption_rule]").length===3,{},{timeout:15000});
 };
 const inspect=()=>page.evaluate(()=>[...document.querySelectorAll("#sectionView .pp-rr-table [data-r]")].map(r=>{const c=r.querySelector("[data-rf=consumption_rule]");return {type:r.querySelector("[data-rf=resource_type]").value,ref:r.querySelector("[data-rf=resource_ref]").value,quantity:r.querySelector("[data-rf=quantity]").value,rule:c.value,options:[...c.options].map(o=>({value:o.value,text:o.textContent})),unit:r.querySelector("[data-rf=unit]")?.value,unitHidden:r.querySelector("[data-rf=unit]")?.hidden}}));
 if(!live){
  await ready();const initial=await inspect();assert(initial[2].options.some(x=>x.value==="per_m2"));assert.equal(initial[2].rule,"per_m2");
  console.log("CONSUMPTION_BASELINE",JSON.stringify(initial));
  assert.equal(initial[0].ref,"M1","baseline valid equipment selection");
  await page.route("**/",async route=>{
   if(!route.request().isNavigationRequest()||new URL(route.request().url()).pathname!=="/")return route.continue();
   const response=await route.fetch(),old=await response.text(),out=transformConsumption(old);
   assert.notEqual(out,old,"exact native editor");assert.equal(transformConsumption(out),out);
   await route.fulfill({response,body:out,headers:{...response.headers(),"content-type":"text/html; charset=utf-8"}});
  });
 }
 await ready();
 const verify=async()=>{
  const rows=await inspect();assert.equal(rows.length,3);
  for(const r of rows){assert(!r.options.some(o=>o.value==="per_m2"));assert.deepEqual(new Set(r.options.map(o=>o.value)),new Set(["per_operation","per_unit","during_operation"]));assert.equal(r.unitHidden,true)}
  assert.equal(rows[0].ref,"M1");assert.equal(rows[0].rule,"during_operation");assert.equal(rows[1].rule,"during_operation");assert.equal(rows[2].rule,"per_unit");assert.equal(rows[2].quantity,"18.5");assert.match(rows[2].unit,/^(kg|кг)$/);
  return rows;
 };
 await page.locator("#ppLanguageSelect").selectOption("en");await verify();
 await page.locator("#ppLanguageSelect").selectOption("ru");await verify();
 await page.locator("#ppLanguageSelect").selectOption("en");await verify();
 const old=await page.evaluate(()=>structuredClone(model));
 const captured=[];
 await page.route("**/api/project/model/import",async route=>{
  const body=JSON.parse(route.request().postData()||"{}");captured.push(body.model);
  if(!live)return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ok:true,model:body.model,model_ready:true})});
  await route.continue();
 });
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/project/model/import"&&r.request().method()==="POST",{timeout:45000});
 await page.locator("#sectionView [data-save]").click();
 const savedResponse=await response;assert(savedResponse.ok());assert.equal(captured.length,1);
 const saved=captured[0],requirements=m=>m.technical_processes.flatMap(p=>p.operations.flatMap(o=>o.resource_requirements));
 const a=requirements(old),b=requirements(saved);assert.equal(a.length,b.length);
 const refs=r=>[...new Set([...(Array.isArray(r.resource_refs)?r.resource_refs:[]),r.resource_ref].filter(x=>x!=null&&String(x).trim()).map(String))].sort();
 console.log("CONSUMPTION_REQUIREMENT_COMPARISON",JSON.stringify({before:a.map(r=>({type:r.resource_type,refs:refs(r),quantity:r.quantity,rule:r.consumption_rule})),after:b.map(r=>({type:r.resource_type,refs:refs(r),quantity:r.quantity,rule:r.consumption_rule}))}));
 for(let i=0;i<a.length;i++){assert.equal(a[i].resource_type,b[i].resource_type);assert.deepEqual(refs(a[i]),refs(b[i]),"resource binding unchanged");assert.equal(Number(a[i].quantity),Number(b[i].quantity));assert.equal(b[i].consumption_rule,a[i].consumption_rule==="per_m2"?"per_unit":a[i].consumption_rule||"during_operation")}
 assert.equal(b.filter(x=>x.resource_type==="material"&&x.consumption_rule==="per_unit").length,2);
 if(live){
  const actual=await page.evaluate(async()=>{const r=await fetch("/api/model",{cache:"no-store",credentials:"same-origin"});return (await r.json()).model});
  assert(actual);assert.equal(requirements(actual).filter(x=>x.resource_type==="material"&&x.consumption_rule==="per_unit").length,2);
 }
 assert.deepEqual(errors,[],"no page errors");
 console.log("CONSUMPTION_BROWSER_PASS",JSON.stringify({live,legacyMigrated:2,quantityPreserved:true,otherRulesPreserved:true,unitsHidden:true}));
}finally{await browser.close()}
