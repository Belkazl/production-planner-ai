import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-i18n-test/node_modules/playwright-core");
const base="https://app.liftorbit.app",live=process.env.PP_SOLAR_LIVE==="1";
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
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>window.__PP_LANGUAGE__?.installed&&typeof model==="object"&&model?.employees?.length===1,{},{timeout:30000});
 await page.locator("#ppLanguageSelect").selectOption("en");
 await page.locator(".side .item").filter({hasText:/^(Employees|Сотрудники)$/}).click();
 await page.waitForFunction(()=>document.getElementById("sectionView")?.innerText.includes("графики")||document.getElementById("sectionView")?.innerText.includes("schedules"),{},{timeout:12000});
 const result=await page.evaluate(()=>{
  const section=document.getElementById("sectionView");
  const scripts=[...document.scripts].map(s=>({id:s.id,text:s.textContent||""}));
  const candidate=scripts.filter(s=>s.text.includes("Рабочие графики")||s.id==="ppLanguageUiJs");
  const snippets=[];
  for(const s of candidate){
   if(s.id==="ppLanguageUiJs"){
    const patterns=["function ","const ","Рабочие графики","День ","Гантт оборудования","Сохранить графики"];
    snippets.push({id:s.id,length:s.text.length,head:s.text.slice(0,1600),matches:s.text.split("\n").filter(l=>/function |Гантт оборудования|День |Рабочие графики/.test(l)).map(l=>l.slice(0,350)).slice(0,50)});
   }else{
    const i=s.text.indexOf("Рабочие графики");
    snippets.push({id:s.id,length:s.text.length,fragment:s.text.slice(Math.max(0,i-6500),i+11000)});
   }
  }
  return {selected:document.getElementById("ppLanguageSelect").value,language:document.documentElement.lang,body:section.innerText.slice(0,6000),snippets};
 });
 console.log("CALENDAR_I18N_SOURCE",JSON.stringify(result));
}finally{await browser.close()}
