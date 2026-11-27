import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {oldCell,newCell,css,transformPerformanceColumns} from "./patch.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-equipment-performance-columns-test/node_modules/playwright-core");
const base="https://app.liftorbit.app",live=process.env.PP_PERFORMANCE_COLUMNS_LIVE==="1";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:45000});
 const register=await page.evaluate(async({email,password})=>(await fetch("/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,company:"Synthetic equipment performance units QA"})})).status,{email:"equipment-performance-columns-qa-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(25).toString("base64url")});
 assert.equal(register,200);
 // Open a valid synthetic project, since the empty-account Projects screen
 // hides the planner chat until a project is active.
 const id="prj_units_"+randomUUID().replaceAll("-","").slice(0,13);
 const seeded=await page.evaluate(async id=>{
  const model={scheduler_mode:"resource",quantity_unit:"m2",start:"2026-11-25T00:00:00",
   equipment:[{id:"M1",__ppid:"M1",name:"Тестовый пресс",kind:"pressing",process_multiplier:0.8,capabilities:{allowed_parameters:{color:["A"]}},capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"throughput",throughput_per_hour:900}},{id:"M2",__ppid:"M2",name:"Тестовая печь",kind:"firing",process_multiplier:1.2,capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"fixed",duration_min:10}},{id:"M3",__ppid:"M3",name:"Synthetic flow oven",kind:"drying",capacity:200,capacity_unit:"m2",process_multiplier:0.8,timing_profile:{timing_mode:"flow",throughput_per_hour:600,residence_min:5}},{id:"M4",__ppid:"M4",name:"Synthetic legacy",kind:"pressing",capacity:200,capacity_unit:"m2",process_multiplier:1.3}],
   orders:[{id:"2601",quantity:600,area:600,unit:"m2",technical_process_id:"P",parameters:{color:"A"}}],
   employees:[{id:"E1",name:"Synthetic operator",role:"operator",shift:"day"}],materials:[{id:'M',name:'Synthetic powder',unit:'kg',initial_stock:1000,deliveries:[]}],shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},constraints:[],setup_rules:[],
   technical_processes:[{id:"P",name:"Synthetic process",operations:[{id:"OP",name:"Press",sequence:1,duration_min:10,resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"M1",resource_refs:["M1"],quantity:1,unit:"pcs"},{resource_type:"employee",match_mode:"specific",resource_ref:"E1",resource_refs:["E1"],quantity:1,unit:"pcs",consumption_rule:"during_operation"}]},{id:"OP2",name:"Fire",sequence:2,duration_min:10,resource_requirements:[{resource_type:"equipment",match_mode:"any",resource_ref:"kind:firing",resource_refs:["kind:firing"],quantity:1,unit:"pcs"}]}]}]};
  model.autoclaves=structuredClone(model.equipment);
  const plan=null;
  const storage={"prodplan.projects.v2":JSON.stringify([{id,name:"Тестовый проект",model,revision:1,lastPlan:plan,updatedAt:"2026-11-27T10:00:00Z",createdAt:"2026-11-27T09:00:00Z"},{id:id+"_second",name:"Копия",model:structuredClone(model),revision:1,lastPlan:plan,updatedAt:"2026-11-27T10:00:00Z"} ]),"prodplan.project.active.v2":id};
  return (await fetch("/api/db-storage",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({storage})})).status;
 },id);
 assert.equal(seeded,200);
 const errors=[];page.on("pageerror",e=>errors.push(String(e).slice(0,200)));
 const ready=async()=>{
  await page.reload({waitUntil:"domcontentloaded",timeout:45000});
  await page.waitForFunction(()=>window.__PP_LANGUAGE__?.installed&&typeof model==="object"&&model?.equipment?.length===4,{},{timeout:30000});
  await page.locator("#ppLanguageSelect").selectOption("en");
  if(await page.evaluate(()=>document.body.classList.contains("projects-mode")))await page.locator(".top .nav > span").filter({hasText:/^(Planning|Планирование)$/}).click();
  await page.locator(".side .item").filter({hasText:/^(Equipment|Оборудование)$/}).click();
  await page.waitForFunction(()=>document.querySelectorAll("#sectionView #ppEditBody [data-f=kind]").length===4,{},{timeout:15000});
 };
 if(!live){
  await ready();assert.equal(await page.locator("#sectionView [data-pp-perf-unit]").count(),4);assert.equal(await page.locator("#sectionView .pp-perf-unit-cell").count(),0);
  await page.route("**/",async route=>{
   if(!route.request().isNavigationRequest()||new URL(route.request().url()).pathname!=="/")return route.continue();
   const response=await route.fetch(),old=await response.text(),out=transformPerformanceColumns(old,oldCell,newCell,css);
   assert.notEqual(out,old,"exact production editor and language anchors");assert.equal(transformPerformanceColumns(out,oldCell,newCell,css),out);
   await route.fulfill({response,body:out,headers:{...response.headers(),"content-type":"text/html; charset=utf-8"}});
  });
 }
 await ready();
 const inspect=()=>page.evaluate(()=>({
  headers:[...document.querySelectorAll("#sectionView th")].map(e=>e.textContent.trim()),
  rows:[...document.querySelectorAll("#sectionView [data-pp-performance-mode]")].map(e=>({mode:e.dataset.ppPerformanceMode,value:e.querySelector('[data-pp-perf="value"]').value,residence:e.querySelector('[data-pp-perf="residence"]')?.value??null,unit:e.closest("tr").querySelector("[data-pp-perf-unit]").value,options:[...e.closest("tr").querySelector("[data-pp-perf-unit]").options].map(o=>o.value),text:e.innerText}))
 }));
 const verify=async lang=>{
  await page.waitForFunction(lang=>[...document.querySelectorAll("#sectionView th")].some(x=>x.textContent.trim()===(lang==="en"?"Performance":"Производительность")),lang,{timeout:12000});
  const a=await inspect();
  assert.deepEqual(a.headers,lang==="en"?["Name","Capacity, m²","Type","Performance","Calculation unit",""]:["Название","Вместимость, м²","Тип","Производительность","Единица расчёта",""]);
  const layout=await page.evaluate(()=>[...document.querySelectorAll("#sectionView .pp-perf-value-cell")].map(td=>{const input=td.querySelector('[data-pp-perf="value"]'),sel=td.nextElementSibling.querySelector("[data-pp-perf-unit]"),a=input.getBoundingClientRect(),b=sel.getBoundingClientRect();return {separate:input.closest("td")!==sel.closest("td"),inputWidth:a.width,selectWidth:b.width,inputHeight:a.height,selectHeight:b.height,aligned:Math.abs(a.top-b.top)<2,inputRadius:parseFloat(getComputedStyle(input).borderTopLeftRadius),selectRadius:parseFloat(getComputedStyle(sel).borderTopLeftRadius),noOverlap:a.right<=b.left,cellCount:td.closest("tr").cells.length}}));
  for(const [i,row] of layout.entries()){assert(row.separate&&row.noOverlap&&row.cellCount===6,JSON.stringify(row));assert(Math.abs(row.inputWidth-100)<2&&Math.abs(row.selectWidth-140)<2,JSON.stringify(row));assert(row.inputRadius>=17&&row.selectRadius>=17);if(i<2)assert(row.aligned,JSON.stringify(row));}
  assert.equal(await page.locator("#sectionView [data-f=process_multiplier]").count(),0);
  assert.deepEqual(a.rows.map(r=>r.mode),["throughput","fixed","flow","inherited"]);
  assert.deepEqual(a.rows.map(r=>r.value),["1125","12","750",""]);
  assert.equal(a.rows[2].residence,"4");assert.deepEqual(a.rows.map(r=>r.unit),["m²/h","min/cycle","m²/h","m²/h"]);for(const row of a.rows)assert.deepEqual(row.options,["m²/h","kg/h","pcs/h","l/h","min/cycle"]);
  assert(a.rows[3].text.includes(lang==="en"?"Uses operation duration":"По времени операции"));
  console.log("PERFORMANCE_COLUMNS_VIEW",JSON.stringify({lang,...a}));
 };
 await verify("en");await page.locator("#ppLanguageSelect").selectOption("ru");await verify("ru");await page.locator("#ppLanguageSelect").selectOption("en");await verify("en");
 const original=await page.evaluate(()=>structuredClone(model));
 const captured=[];
 await page.route("**/api/project/model/import",async route=>{
  const body=JSON.parse(route.request().postData()||"{}");captured.push(body.model);
  if(!live)return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ok:true,model:body.model,model_ready:true})});
  return route.continue();
 });
 const save=async()=>{
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/project/model/import"&&r.request().method()==="POST",{timeout:45000});
  await page.locator("#sectionView [data-pp-save]").click();
  const result=await response;assert(result.ok());const body=await result.json();assert.notEqual(body.ok,false);
  const expected=captured.at(-1);
  // The native editor also persists the active project asynchronously. Wait
  // for both the complete in-memory model and its project record before the
  // next edit, rather than racing the initial import's storage synchronization.
  await page.waitForFunction(expected=>{
   const signature=eq=>JSON.stringify(eq.map(e=>[e.id,e.kind,e.process_multiplier,e.timing_profile??null]));
   const list=JSON.parse(localStorage.getItem("prodplan.projects.v2")||"[]");
   const project=list.find(p=>String(p.id)===String(localStorage.getItem("prodplan.project.active.v2")));
   return !document.querySelector("#sectionView [data-pp-save]")?.disabled&&signature(model?.equipment||[])===signature(expected)&&signature(project?.model?.equipment||[])===signature(expected);
  },expected.equipment,{timeout:20000});
  return expected;
 };
 const fields=r=>({id:r.id,name:r.name,kind:r.kind,capacity:r.capacity,capacity_unit:r.capacity_unit,process_multiplier:r.process_multiplier,capabilities:r.capabilities,timing_profile:r.timing_profile});
 const unchanged=await save();
 assert.deepEqual(unchanged.equipment.map(fields),original.equipment.map(fields));
 assert.deepEqual(unchanged.autoclaves.map(fields),unchanged.equipment.map(fields));
 assert.deepEqual(unchanged.technical_processes,original.technical_processes);
 const vals=page.locator('#sectionView [data-pp-perf="value"]');
 const units=page.locator("#sectionView [data-pp-perf-unit]");
 await units.nth(0).selectOption("min/cycle");await vals.nth(0).fill("16");await units.nth(1).selectOption("m²/h");await vals.nth(1).fill("1000");await vals.nth(2).fill("800");
 await page.locator('#sectionView [data-pp-perf="residence"]').fill("6");await vals.nth(3).fill("130");
 const edited=await save();
 assert.deepEqual(edited.equipment.map(r=>r.process_multiplier),[.8,1.2,.8,1.3]);
 assert.equal(edited.equipment[0].timing_profile.timing_mode,"fixed");assert.equal(edited.equipment[0].timing_profile.duration_min,20);assert.equal(edited.equipment[0].timing_profile.performance_unit,"min/cycle");
 assert.equal(edited.equipment[1].timing_profile.timing_mode,"throughput");assert.equal(edited.equipment[1].timing_profile.throughput_per_hour,1200);assert.equal(edited.equipment[1].timing_profile.performance_unit,"m²/h");
 assert.equal(edited.equipment[2].timing_profile.throughput_per_hour,640);
 assert.equal(edited.equipment[2].timing_profile.residence_min,7.5);
 assert.equal(edited.equipment[3].timing_profile.throughput_per_hour,169);
 assert.deepEqual(edited.equipment[0].capabilities,original.equipment[0].capabilities);
 assert.deepEqual(edited.technical_processes,original.technical_processes);
 assert.deepEqual(edited.autoclaves.map(fields),edited.equipment.map(fields));
 if(live){
  const readServer=async()=>page.evaluate(async()=>{
   const r=await fetch("/api/model",{credentials:"same-origin",cache:"no-store"});
   if(!r.ok)throw Error("model read failed: "+r.status);
   return (await r.json()).model;
  });
  // Use consecutive matching full-model reads, not a single successful poll
  // of one field followed by a separate potentially stale request.
  let actual,consecutive=0;
  const deadline=Date.now()+30000;
  while(Date.now()<deadline&&consecutive<3){
   actual=await readServer();
   let matched=false;try{assert.deepEqual(actual?.equipment?.map(fields),edited.equipment.map(fields));matched=true}catch{}
   consecutive=matched?consecutive+1:0;
   if(consecutive<3)await page.waitForTimeout(500);
  }
  assert.equal(consecutive,3,"edited server model must remain stable");
  assert.deepEqual(actual.equipment.map(fields),edited.equipment.map(fields));
  await ready();
  const reopened=await inspect();
  assert.deepEqual(reopened.rows.map(r=>r.value),["16","1000","800","130"]);
  assert.deepEqual(reopened.rows.map(r=>r.unit),["min/cycle","m²/h","m²/h","m²/h"]);
  assert.equal(reopened.rows[2].residence,"6");
  const persisted=await readServer();
  assert.deepEqual(persisted.equipment.map(fields),edited.equipment.map(fields));
 }
 assert.deepEqual(errors,[],"no page errors");
 console.log("PERFORMANCE_COLUMNS_BROWSER_PASS",JSON.stringify({live,originalTimingPreserved:true,editableSpeed:true,editableCycleAndFlow:true,legacyCompatible:true,mirrorPreserved:true,localized:true}));
 await page.screenshot({path:"/tmp/liftorbit-equipment-performance-columns-"+(live?"live":"candidate")+".png"});
}finally{await browser.close()}
