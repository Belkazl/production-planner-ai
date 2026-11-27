import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {helper,transformProjectsLanguage} from "./patch.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-project-card-language-test/node_modules/playwright-core");
const base="https://app.liftorbit.app",live=process.env.PP_PROJECT_CARD_LANGUAGE_LIVE==="1";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:45000});
 const register=await page.evaluate(async({email,password})=>(await fetch("/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,company:"Synthetic project card localization QA"})})).status,{email:"project-card-language-qa-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(25).toString("base64url")});
 assert.equal(register,200);
 // Open a valid synthetic project, since the empty-account Projects screen
 // hides the planner chat until a project is active.
 const id="prj_units_"+randomUUID().replaceAll("-","").slice(0,13);
 const seeded=await page.evaluate(async id=>{
  const model={scheduler_mode:"resource",quantity_unit:"m2",start:"2026-11-25T00:00:00",
   equipment:[{id:"M1",__ppid:"M1",name:"Тестовый пресс",kind:"press",capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"fixed",duration_min:10}},{id:"M2",__ppid:"M2",name:"Тестовая печь",kind:"oven",capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"fixed",duration_min:10}}],
   orders:[{id:"2601",quantity:600,area:600,unit:"m2",technical_process_id:"P",parameters:{color:"A"}}],
   employees:[{id:"E1",name:"Synthetic operator",role:"operator",shift:"day"}],materials:[{id:'M',name:'Synthetic powder',unit:'kg',initial_stock:1000,deliveries:[]}],shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},constraints:[],setup_rules:[],
   technical_processes:[{id:"P",name:"Synthetic process",operations:[{id:"OP",name:"Press",sequence:1,duration_min:10,resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"M1",resource_refs:["M1"],quantity:1,unit:"pcs"},{resource_type:"employee",match_mode:"specific",resource_ref:"E1",resource_refs:["E1"],quantity:1,unit:"pcs",consumption_rule:"during_operation"}]},{id:"OP2",name:"Fire",sequence:2,duration_min:10,resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"M2",resource_refs:["M2"],quantity:1,unit:"pcs"}]}]}]};
  model.autoclaves=structuredClone(model.equipment);
  const plan={valid:true,_revision:1,duration_minutes:6,generic_schedule:true,generic_operations:[{operation_id:"OP",start_min:0,end_min:6,equipment_ids:["M1"],employee_ids:[]}]};
  const storage={"prodplan.projects.v2":JSON.stringify([{id,name:"Тестовый проект",model,revision:1,lastPlan:plan,updatedAt:"2026-11-27T10:00:00Z",createdAt:"2026-11-27T09:00:00Z"},{id:id+"_second",name:"Копия",model:structuredClone(model),revision:1,lastPlan:plan,updatedAt:"2026-11-27T10:00:00Z"}]),"prodplan.project.active.v2":id};
  return (await fetch("/api/db-storage",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({storage})})).status;
 },id);
 assert.equal(seeded,200);
 const errors=[];page.on("pageerror",e=>errors.push(String(e).slice(0,200)));
 const ready=async()=>{await page.reload({waitUntil:"domcontentloaded",timeout:45000});await page.waitForFunction(()=>window.__PP_LANGUAGE__?.installed&&JSON.parse(localStorage.getItem("prodplan.projects.v2")||"[]").length===2,{},{timeout:30000});await page.locator("#ppLanguageSelect").selectOption("en");await page.locator(".top .nav > span").filter({hasText:/^(Projects|Проекты)$/}).click();await page.waitForFunction(()=>document.body.classList.contains("projects-mode")&&document.body.innerText.includes("Тестовый проект"),{},{timeout:15000})};
 const snapshot=()=>page.evaluate(()=>{
  const leaf=[...document.querySelectorAll("body.projects-mode .main *")].filter(e=>e.children.length===0&&e.getClientRects().length&&e.textContent.trim()).map(e=>({text:e.textContent.trim(),tag:e.tagName,cls:e.className,prev:e.previousElementSibling?.textContent?.trim().slice(0,70),next:e.nextElementSibling?.textContent?.trim().slice(0,70),parent:e.parentElement?.className,ancestor:e.parentElement?.parentElement?.className}));
  return {leaf:leaf.slice(0,160),body:document.querySelector(".main")?.innerText.slice(0,5000)};
 });
 if(!live){
  await ready();console.log("PROJECT_CARD_LANGUAGE_BASELINE",JSON.stringify(await snapshot()));
  await page.route("**/",async route=>{if(!route.request().isNavigationRequest()||new URL(route.request().url()).pathname!=="/")return route.continue();const response=await route.fetch(),old=await response.text(),out=transformProjectsLanguage(old,helper);assert.notEqual(out,old,"exact current localizer");assert.equal(transformProjectsLanguage(out,helper),out);await route.fulfill({response,body:out,headers:{...response.headers(),"content-type":"text/html; charset=utf-8"}})});
 }
 await ready();
 const original=await page.evaluate(()=>localStorage.getItem("prodplan.projects.v2"));
 const verify=async lang=>{
  const words=lang==="en"?["Equipment","Employees","Orders","Calculations","Latest plan","Copy","Export"]:["оборудование","сотрудников","заказов","расчётов","Последний план","Копия","Экспорт"];
  try{await page.waitForFunction(({words,lang})=>{
   const main=document.querySelector(".main");if(!main)return false;
   const leaf=[...main.querySelectorAll("*")].filter(e=>e.children.length===0&&e.getClientRects().length>0).map(e=>e.textContent.trim());
   return words.every(w=>leaf.filter(s=>s===w).length>=2)&&leaf.includes("Тестовый проект")&&leaf.includes("Копия")&&leaf.filter(x=>x.startsWith(lang==="en"?"Modified ":"Изменено ")).length>=2;
  },{words,lang},{timeout:15000})}catch(e){console.log("PROJECT_CARD_LANGUAGE_DIAGNOSTIC",JSON.stringify(await snapshot()));throw e}
  const s=await snapshot();
  console.log("PROJECT_CARD_LANGUAGE_VIEW",JSON.stringify({lang,leaf:s.leaf.filter(x=>words.includes(x.text)||/^(Modified|Изменено) /.test(x.text)||/^\d+[.,]?\d*\s+[hч]$/.test(x.text))}));
  if(lang==="en")assert(!s.leaf.some(x=>["автоклавов","сотрудников","заказов","расчётов","Последний план","Экспорт"].includes(x.text)||/^Изменено\s/.test(x.text)||/^\d+(?:[.,]\d+)?\s*ч$/.test(x.text)),JSON.stringify(s));
 };
 await verify("en");await page.locator("#ppLanguageSelect").selectOption("ru");await verify("ru");await page.locator("#ppLanguageSelect").selectOption("en");await verify("en");
 assert.equal(await page.evaluate(()=>localStorage.getItem("prodplan.projects.v2")),original,"language switching must not write project records");
 // Search and regenerated card labels must retain locale and user-defined names.
 const search=page.getByPlaceholder("Search projects");await search.fill("Тестовый проект");
 await page.waitForFunction(()=>document.querySelector(".main")?.innerText.includes("Тестовый проект")&&!document.querySelector(".main")?.innerText.includes("Копия"),{},{timeout:12000});
 await search.fill("");await verify("en");
 await ready();await verify("en");
 assert.deepEqual(errors,[],"no page errors");
 await page.screenshot({path:"/tmp/liftorbit-project-card-language-"+(live?"live":"candidate")+".png"});
 console.log("PROJECT_CARD_LANGUAGE_BROWSER_PASS",JSON.stringify({live,translatedCards:2,bothLanguages:true,projectNamesPreserved:true,modelUnchanged:true}));
}finally{await browser.close()}
