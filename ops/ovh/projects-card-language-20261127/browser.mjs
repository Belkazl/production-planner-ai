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
 const ready=async()=>{
  await page.reload({waitUntil:"domcontentloaded",timeout:45000});
  await page.waitForFunction(()=>window.__PP_LANGUAGE__?.installed&&typeof model==="object"&&model?.orders?.length===1&&JSON.parse(localStorage.getItem("prodplan.projects.v2")||"[]").length===2,{},{timeout:30000});
  await page.locator("#ppLanguageSelect").selectOption("en");
  const projects=page.locator(".top .nav > span").filter({hasText:/^(Projects|Проекты)$/});
  // Saved-plan hydration may asynchronously return to Planning on reload.
  // Wait for hydration and check the route again before inspecting cards.
  await page.waitForTimeout(2000);
  if(!await page.evaluate(()=>document.body.classList.contains("projects-mode")))await projects.click();
  await page.locator(".pm-card").first().waitFor({state:"visible",timeout:15000});
  await page.waitForTimeout(500);
  if(!await page.evaluate(()=>document.body.classList.contains("projects-mode")))await projects.click();
  await page.waitForFunction(()=>document.querySelectorAll(".pm-card").length===2&&[...document.querySelectorAll(".pm-card h3")].some(e=>e.textContent.trim()==="Тестовый проект"),{},{timeout:15000});
 };
 const snapshot=()=>page.evaluate(()=>{
  const cards=[...document.querySelectorAll(".pm-card")].filter(e=>e.getClientRects().length).map(card=>({
   name:card.querySelector(".pm-name h3")?.textContent.trim(),
   modified:card.querySelector(".pm-name > small")?.textContent.trim(),
   stats:[...card.querySelectorAll(".pm-stat")].map(e=>({count:e.querySelector("b")?.textContent.trim(),caption:[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.nodeValue.trim()).filter(Boolean).join(" ")})),
   last:card.querySelector(".pm-last > span")?.textContent.trim(),
   hours:card.querySelector(".pm-last > b")?.textContent.trim(),
   actions:[...card.querySelectorAll(".pm-actions button")].map(e=>e.textContent.trim())
  }));
  return {cards,body:document.querySelector(".main")?.innerText.slice(0,3000)};
 });
 if(!live){
  await ready();console.log("PROJECT_CARD_LANGUAGE_BASELINE",JSON.stringify(await snapshot()));
  await page.route("**/",async route=>{if(!route.request().isNavigationRequest()||new URL(route.request().url()).pathname!=="/")return route.continue();const response=await route.fetch(),old=await response.text(),out=transformProjectsLanguage(old,helper);assert.notEqual(out,old,"exact current localizer");assert.equal(transformProjectsLanguage(out,helper),out);await route.fulfill({response,body:out,headers:{...response.headers(),"content-type":"text/html; charset=utf-8"}})});
 }
 await ready();
 const original=await page.evaluate(()=>localStorage.getItem("prodplan.projects.v2"));
 const verify=async lang=>{
  const expected=lang==="en"?{stats:["Equipment","Employees","Orders","Calculations"],last:"Latest plan",hours:"0.1 h",copy:"Copy",exp:"Export",date:"Modified "}:{stats:["оборудование","сотрудников","заказов","расчётов"],last:"Последний план",hours:"0,1 ч",copy:"Копия",exp:"Экспорт",date:"Изменено "};
  try{await page.waitForFunction(expected=>{
   const cards=[...document.querySelectorAll(".pm-card")].filter(e=>e.getClientRects().length);
   if(cards.length!==2)return false;
   return cards.every(card=>{
    const stats=[...card.querySelectorAll(".pm-stat")].map(e=>[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.nodeValue.trim()).filter(Boolean).join(" "));
    const actions=[...card.querySelectorAll(".pm-actions button")].map(e=>e.textContent.trim());
    return JSON.stringify(stats)===JSON.stringify(expected.stats)&&card.querySelector(".pm-last > span")?.textContent.trim()===expected.last&&card.querySelector(".pm-last > b")?.textContent.trim()===expected.hours&&card.querySelector(".pm-name > small")?.textContent.trim().startsWith(expected.date)&&actions.includes(expected.copy)&&actions.includes(expected.exp);
   });
  },expected,{timeout:15000})}catch(e){console.log("PROJECT_CARD_LANGUAGE_DIAGNOSTIC",JSON.stringify(await snapshot()));throw e}
  const s=await snapshot();assert.deepEqual(s.cards.map(x=>x.name).sort(),["Копия","Тестовый проект"].sort());
  for(const card of s.cards)assert.deepEqual(card.stats.map(x=>x.count),["2","1","1","0"]);
  console.log("PROJECT_CARD_LANGUAGE_VIEW",JSON.stringify({lang,cards:s.cards}));
 };
 await verify("en");await page.locator("#ppLanguageSelect").selectOption("ru");await verify("ru");await page.locator("#ppLanguageSelect").selectOption("en");await verify("en");
 assert.equal(await page.evaluate(()=>localStorage.getItem("prodplan.projects.v2")),original,"language switching must not write project records");
 // Search and regenerated card labels must retain locale and user-defined names.
 const search=page.getByPlaceholder("Search projects");await search.fill("Тестовый проект");
 await page.waitForFunction(()=>document.querySelectorAll(".pm-card").length===1&&document.querySelector(".pm-card .pm-name h3")?.textContent.trim()==="Тестовый проект",{},{timeout:12000});
 await search.fill("");await verify("en");
 await ready();await verify("en");
 assert.deepEqual(errors,[],"no page errors");
 await page.screenshot({path:"/tmp/liftorbit-project-card-language-"+(live?"live":"candidate")+".png"});
 console.log("PROJECT_CARD_LANGUAGE_BROWSER_PASS",JSON.stringify({live,translatedCards:2,bothLanguages:true,projectNamesPreserved:true,modelUnchanged:true}));
}finally{await browser.close()}
