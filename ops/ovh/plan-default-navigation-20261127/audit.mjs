import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-plan-default-navigation-test/node_modules/playwright-core");
const base="https://app.liftorbit.app";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:45000});
 const register=await page.evaluate(async({email,password})=>(await fetch("/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,company:"Synthetic planning start QA"})})).status,{email:"plan-default-nav-qa-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(25).toString("base64url")});
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
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>window.__PP_LANGUAGE__?.installed&&typeof model==="object"&&model?.equipment?.length===4,null,{timeout:30000});
 await page.locator("#ppLanguageSelect").selectOption("en");
 if(await page.evaluate(()=>document.body.classList.contains("projects-mode")))await page.locator(".top .nav > span").filter({hasText:/^(Planning|Планирование)$/}).click();
 await page.locator(".side .item").filter({hasText:/^(Plan|План)$/}).click();
 const result=await page.evaluate(()=>{
 const manager=document.getElementById("projectManagerJsV2")?.textContent||"";
 const snippets=(s,re,before=80,after=1500,limit=10)=>[...s.matchAll(re)].slice(0,limit).map(m=>s.slice(Math.max(0,m.index-before),m.index+after)).filter(x=>!/(password|secret|api[_-]?key|authorization|credential)/i.test(x));
 return {rail:[...document.querySelectorAll(".side .item")].map(x=>({html:x.outerHTML.slice(0,600),text:x.textContent,active:x.classList.contains("active")})),projectManager:snippets(manager,/function (?:open\w*|activate\w*|show\w*|switch\w*|init)\(|(?:^|[;\n])\s*(?:window\.)?ppShowProjects\s*=|classList\.remove\(["']projects-mode|classList\.add\(["']projects-mode/g,50,1700,16),
 routes:[...document.scripts].flatMap(e=>snippets(e.textContent||"",/querySelectorAll\(["']\.side \.item|querySelector\(["']\.side \.item|function (?:showSection|overrideSection|selectSection|openSection)\(/g,80,500,8).map(c=>({id:e.id,c}))).slice(0,25)};
 });
 console.log("PLAN_NAV_AUDIT",JSON.stringify(result));
}finally{await browser.close()}
