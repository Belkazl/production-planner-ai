import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {transformPage} from "./patch.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-equipment-types-create-test/node_modules/playwright-core");
const base="https://app.liftorbit.app",live=process.env.PP_EQUIPMENT_TYPES_LIVE==="1";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:45000});
 const register=await page.evaluate(async({email,password})=>(await fetch("/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,company:"Synthetic equipment performance units QA"})})).status,{email:"equipment-types-create-qa-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(25).toString("base64url")});
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
 if(live||page.__sdkCandidate)await page.waitForFunction(()=>document.querySelectorAll("#sectionView .pp-perf-unit-cell>.pp-sdk-SelectControl").length===4,{},{timeout:12000});
 };
 if(!live){
  await ready();assert.equal(await page.locator("#sectionView [data-pp-perf-unit]").count(),4);
  await page.route("**/",async route=>{
   if(!route.request().isNavigationRequest()||new URL(route.request().url()).pathname!=="/")return route.continue();
   const response=await route.fetch(),old=await response.text(),out=transformPage(old);
   assert.notEqual(out,old,"exact production editor and language anchors");assert.equal(transformPage(out),out);
   await route.fulfill({response,body:out,headers:{...response.headers(),"content-type":"text/html; charset=utf-8"}});
  });
 }
 page.__sdkCandidate=true;await ready();

 const type=page.locator('#sectionView select[data-f="kind"] + .pp-sdk-SelectControl');
 const open=async()=>{await type.first().click();const menu=page.locator(".pp-sdk-MenuList:popover-open");await menu.getByRole("option",{name:"+ Add new type",exact:true}).click();await page.locator(".pp-sdk-type-dialog[open]").waitFor();};
 await open();await page.locator(".pp-sdk-type-name").fill("PRESSING");await page.locator(".pp-sdk-type-add").click();assert.match(await page.locator(".pp-sdk-type-error").innerText(),/already exists/);
 await page.locator(".pp-sdk-type-name").fill("cutting");await page.locator(".pp-sdk-type-add").click();
 assert.equal(await page.locator(".pp-sdk-type-dialog").count(),0);
 assert.equal(await page.locator('#sectionView select[data-f="kind"]').first().inputValue(),"cutting");
 assert.equal(await page.locator('#sectionView select[data-f="kind"] option[value="cutting"]').count(),4);
 assert.equal(await page.evaluate(()=>model.equipment_types===undefined||!model.equipment_types.includes("cutting")),true,"no model write before Save");
 const res=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/project/model/import"&&r.request().method()==="POST",{timeout:45000});
 await page.locator("#sectionView [data-pp-save]").click();const response=await res;const result=await response.json();assert(response.ok());assert(result.model.equipment_types.includes("cutting"));assert.equal(result.model.equipment[0].kind,"cutting");assert.equal(result.model.autoclaves[0].kind,"cutting");
 await page.waitForFunction(()=>{const list=JSON.parse(localStorage.getItem("prodplan.projects.v2")||"[]");const p=list.find(x=>x.id===localStorage.getItem("prodplan.project.active.v2"));return model.equipment_types?.includes("cutting")&&p?.model?.equipment_types?.includes("cutting")},null,{timeout:30000});
 await ready();
 assert.equal(await page.locator('#sectionView select[data-f="kind"] option[value="cutting"]').count(),4);
 // A type is stored independently of its assigned row and is offered by the real technical-process editor.
 await page.locator(".side .item").filter({hasText:/^(Production|Производство)$/}).click();
 await page.waitForFunction(()=>document.querySelectorAll('#sectionView [data-rf="resource_ref"] option[value="kind:cutting"]').length>0,null,{timeout:15000});
 // Verify AI's shared deterministic builder and the live confirmation path using a synthetic proposal, without external provider calls.
 await page.locator(".side .item").filter({hasText:/^(Chat|Чат)$/}).click();
 const proposal=await page.evaluate(()=>{
  const p=ppGroqLocalEntry(),args={kind:"create_equipment_type",type_name:"milling"};
  const {change}=ppGroqPrepareEdit(p.model,args);
  ppGroqShowProposal({action:{projectId:p.id,revision:p.revision,args,change}},p,"Create equipment type milling");
  return {change,id:p.id,revision:p.revision};
 });
 assert.equal(proposal.change.record,"milling");
 const pending=page.locator('[data-groq-action="pending"]').last();
 if(live){
  const validation=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/assistant/validate-edit"&&r.request().method()==="POST",{timeout:115000});
  await pending.locator("[data-groq-apply]").click();
  const v=await validation;assert(v.ok(),JSON.stringify(await v.json()));await page.waitForFunction(()=>document.querySelector('[data-groq-action="applied"]'),null,{timeout:60000});
  await ready();assert.equal(await page.locator('#sectionView select[data-f="kind"] option[value="milling"]').count(),4);
 }else{await pending.locator("[data-groq-cancel]").click();assert.equal(await page.locator('[data-groq-action="cancelled"]').count(),1)}
 assert.deepEqual(errors,[]);
 console.log("EQUIPMENT_TYPES_BROWSER_PASS",JSON.stringify({live,duplicateRejected:true,saveRoundtrip:true,processTypes:true,aiProposal:true,aiApply:live}));
 await page.screenshot({path:"/tmp/liftorbit-equipment-types-create-"+(live?"live":"candidate")+".png"});
}finally{await browser.close()}
