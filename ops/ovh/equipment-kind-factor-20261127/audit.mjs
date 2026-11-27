import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-equipment-kind-test/node_modules/playwright-core");
const base="https://app.liftorbit.app",live=process.env.PP_PROJECT_CARD_LANGUAGE_LIVE==="1";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:45000});
 const register=await page.evaluate(async({email,password})=>(await fetch("/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,company:"Synthetic equipment kind QA"})})).status,{email:"equipment-kind-qa-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(25).toString("base64url")});
 assert.equal(register,200);
 // Open a valid synthetic project, since the empty-account Projects screen
 // hides the planner chat until a project is active.
 const id="prj_units_"+randomUUID().replaceAll("-","").slice(0,13);
 const seeded=await page.evaluate(async id=>{
  const model={scheduler_mode:"resource",quantity_unit:"m2",start:"2026-11-25T00:00:00",
   equipment:[{id:"M1",__ppid:"M1",name:"Тестовый пресс",kind:"pressing",process_factor:1.2,capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"fixed",duration_min:10}},{id:"M2",__ppid:"M2",name:"Тестовая печь",kind:"firing",process_factor:0.8,capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"fixed",duration_min:10}}],
   orders:[{id:"2601",quantity:600,area:600,unit:"m2",technical_process_id:"P",parameters:{color:"A"}}],
   employees:[{id:"E1",name:"Synthetic operator",role:"operator",shift:"day"}],materials:[{id:'M',name:'Synthetic powder',unit:'kg',initial_stock:1000,deliveries:[]}],shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},constraints:[],setup_rules:[],
   technical_processes:[{id:"P",name:"Synthetic process",operations:[{id:"OP",name:"Press",sequence:1,duration_min:10,resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"M1",resource_refs:["M1"],quantity:1,unit:"pcs"},{resource_type:"employee",match_mode:"specific",resource_ref:"E1",resource_refs:["E1"],quantity:1,unit:"pcs",consumption_rule:"during_operation"}]},{id:"OP2",name:"Fire",sequence:2,duration_min:10,resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"M2",resource_refs:["M2"],quantity:1,unit:"pcs"}]}]}]};
  model.autoclaves=structuredClone(model.equipment);
  const plan={valid:true,_revision:1,duration_minutes:6,generic_schedule:true,generic_operations:[{operation_id:"OP",start_min:0,end_min:6,equipment_ids:["M1"],employee_ids:[]}]};
  const storage={"prodplan.projects.v2":JSON.stringify([{id,name:"Тестовый проект",model,revision:1,lastPlan:plan,updatedAt:"2026-11-27T10:00:00Z",createdAt:"2026-11-27T09:00:00Z"},{id:id+"_second",name:"Копия",model:structuredClone(model),revision:1,lastPlan:plan,updatedAt:"2026-11-27T10:00:00Z"}]),"prodplan.project.active.v2":id};
  return (await fetch("/api/db-storage",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({storage})})).status;
 },id);
 assert.equal(seeded,200);
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>window.__PP_LANGUAGE__?.installed&&typeof model==="object"&&model?.equipment?.length===2,{},{timeout:30000});
 await page.locator("#ppLanguageSelect").selectOption("en");
 if(await page.evaluate(()=>document.body.classList.contains("projects-mode")))await page.locator(".top .nav > span").filter({hasText:/^(Planning|Планирование)$/}).click();
 await page.locator(".side .item").filter({hasText:/^(Equipment|Оборудование)$/}).click();
 await page.waitForFunction(()=>document.querySelector("#sectionView table")?.getClientRects().length>0,{},{timeout:15000});
 const data=await page.evaluate(()=>{
  const section=document.querySelector("#sectionView");
  const table=section.querySelector("table");
  const rows=[...table.querySelectorAll("tbody tr")].map(r=>({html:r.outerHTML.slice(0,4500),fields:[...r.querySelectorAll("input,select")].map(x=>({field:x.dataset.f,value:x.value,options:x.options?[...x.options].map(o=>({value:o.value,text:o.textContent})):null}))}));
  const selectedModel=typeof model==="object"?model:null;
  const fields=m=>(m||[]).map(x=>Object.fromEntries(Object.entries(x).filter(([k])=>["id","__ppid","name","kind","type","capacity","capacity_unit","factor","process_factor","processFactor","timing_profile"].includes(k))));
  const scripts=[...document.scripts].map(s=>({id:s.id,source:s.textContent||""}));
  const excerpts=[];
  for(const s of scripts){
   const patterns=[/data-f=["'](?:type|factor|process_factor|kind)["']/g,/\b(?:process_factor|processFactor)\b/g,/\bfunction\s+(?:equipment|renderEquipment|renderSection|editEquipment|saveEquipment|renderTable)\b/g];
   for(const p of patterns){p.lastIndex=0;for(const m of s.source.matchAll(p)){const x=s.source.slice(Math.max(0,m.index-420),m.index+700);if(!/password|secret|credential|api[_-]?key|authorization|token/i.test(x)&&!excerpts.some(e=>e.source===x)&&excerpts.length<25)excerpts.push({id:s.id,source:x})}}
  }
  return {headers:[...table.querySelectorAll("th")].map(x=>x.textContent.trim()),rows,equipment:fields(selectedModel?.equipment),autoclaves:fields(selectedModel?.autoclaves),excerpts};
 });
 console.log("EQUIPMENT_KIND_AUDIT",JSON.stringify(data));
}finally{await browser.close()}
