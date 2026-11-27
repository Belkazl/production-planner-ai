import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {transformCalendarLanguage} from "./patch.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-i18n-test/node_modules/playwright-core");
const base="https://app.liftorbit.app",live=process.env.PP_CALENDAR_LANGUAGE_LIVE==="1";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:45000});
 const register=await page.evaluate(async({email,password})=>(await fetch("/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,company:"Synthetic calendar translation QA"})})).status,{email:"calendar-i18n-qa-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(25).toString("base64url")});
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
  const storage={"prodplan.projects.v2":JSON.stringify([{id,name:"Synthetic calendar translation QA",model,revision:1,lastPlan:null}]),"prodplan.project.active.v2":id};
  return (await fetch("/api/db-storage",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({storage})})).status;
 },id);
 assert.equal(seeded,200);
 const pageErrors=[];page.on("pageerror",e=>pageErrors.push(String(e).slice(0,180)));
 let imports=0;page.on("request",r=>{if(r.method()==="POST"&&new URL(r.url()).pathname==="/api/project/model/import")imports++});
 if(!live)await page.route("**/",async route=>{
  if(!route.request().isNavigationRequest()||new URL(route.request().url()).pathname!=="/")return route.continue();
  const response=await route.fetch(),old=await response.text(),out=transformCalendarLanguage(old);
  assert.notEqual(out,old,"exact current weekly calendar source");
  assert.equal(transformCalendarLanguage(out),out,"idempotent");
  await route.fulfill({response,body:out,headers:{...response.headers(),"content-type":"text/html; charset=utf-8"}});
 });
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>window.__PP_LANGUAGE__?.installed&&typeof model==="object"&&model?.employees?.length===1,{},{timeout:30000});
 await page.locator("#ppLanguageSelect").selectOption("en");
 await page.locator(".side .item").filter({hasText:/^(Employees|Сотрудники)$/}).click();
 const panel=page.locator("[data-pp-weekly-calendar]");
 const verify=async lang=>{
  const expected=lang==="en"?{title:"Work schedules",add:"+ Add shift",save:"Save schedules",end:"End",days:["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],breaks:"Breaks",full:"24 hours (same start/end)",summary:"08:00–12:00, 13:00–19:00 · Mon, Tue, Wed, Thu, Fri"}:{title:"Рабочие графики",add:"+ Добавить смену",save:"Сохранить графики",end:"Окончание",days:["Пн","Вт","Ср","Чт","Пт","Сб","Вс"],breaks:"Перерывы",full:"24 часа (одинаковое время)",summary:"08:00–12:00, 13:00–19:00 · Пн, Вт, Ср, Чт, Пт"};
  await page.waitForFunction(({expected,lang})=>{
   const p=document.querySelector("[data-pp-weekly-calendar]"),s=document.getElementById("sectionView");
   if(!p||!s||document.getElementById("ppLanguageSelect")?.value!==lang)return false;
   const get=sel=>p.querySelector(sel)?.textContent.trim();
   const end=p.querySelector('[data-pp-calendar-field="end"]')?.parentElement?.textContent.trim();
   const full=p.querySelector('[data-pp-calendar-full-day]')?.parentElement?.textContent.trim();
   const days=[...p.querySelectorAll("[data-pp-calendar-day]")].slice(0,7).map(x=>x.parentElement.textContent.trim());
   const rows=[...s.querySelectorAll("tbody tr")];
   return get("strong")===expected.title&&get("[data-pp-add-shift]")===expected.add&&get("[data-pp-save-schedules]")===expected.save&&
    end===expected.end&&full===expected.full&&JSON.stringify(days)===JSON.stringify(expected.days)&&
    p.textContent.includes(expected.breaks)&&rows.some(r=>[...r.cells].some(c=>c.textContent.trim()===expected.summary));
  },{expected,lang},{timeout:15000});
  const data=await page.evaluate(()=>{
   const section=document.getElementById("sectionView"),panel=section.querySelector("[data-pp-weekly-calendar]");
   return {calendar:panel.innerText,summary:[...section.querySelectorAll("tbody tr")].map(r=>[...r.cells].map(c=>c.textContent.trim())),employee:[...section.querySelectorAll("tbody input")].map(x=>x.value)};
  });
  if(lang==="en")assert(!/[\u0400-\u04ff]/u.test(data.calendar.replaceAll("Тестовая смена","")),data.calendar);
  assert(data.employee.includes("Тестовый сотрудник"));assert(data.employee.includes("Тестовая роль"));
  console.log("CALENDAR_LANGUAGE_VIEW_PASS",JSON.stringify({lang,title:expected.title,summary:expected.summary}));
 };
 await verify("en");
 const original=await page.evaluate(()=>JSON.stringify(model));
 // Unsaved user-entered shift data must survive a language round trip.
 const draft=panel.locator('[data-pp-calendar-field="name"]').first();
 await draft.fill("Тестовая смена");
 await page.locator("#ppLanguageSelect").selectOption("ru");await verify("ru");assert.equal(await draft.inputValue(),"Тестовая смена");
 await page.locator("#ppLanguageSelect").selectOption("en");await verify("en");assert.equal(await draft.inputValue(),"Тестовая смена");
 // Exercise dynamic add-break rendering after switching to English.
 await panel.locator("[data-pp-add-break]").first().click();
 assert.equal(await panel.locator("[data-pp-calendar-break]").count(),2);
 assert.equal(await panel.locator("[data-pp-add-break]").first().innerText(),"+ Break");
 assert.equal(await page.evaluate(()=>JSON.stringify(model)),original,"language switching never changes the saved model");
 assert.equal(imports,0,"no model imports while changing language");
 // Confirm the selected language is persisted across an authenticated reload.
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>window.__PP_LANGUAGE__?.installed&&document.getElementById("ppLanguageSelect")?.value==="en",{},{timeout:30000});
 const employees=page.locator(".side .item").filter({hasText:/^(Employees|Сотрудники)$/});
 await employees.click();await verify("en");
 assert.deepEqual(pageErrors,[],"no uncaught page errors");
 await page.screenshot({path:"/tmp/liftorbit-calendar-language-"+(live?"live":"candidate")+".png"});
 console.log("CALENDAR_LANGUAGE_BROWSER_PASS",JSON.stringify({live,roundtrip:true,draftPreserved:true,modelUnchanged:true,languagePersisted:true}));
}finally{await browser.close()}
