import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {labels,transformBottleneckLanguage} from "./patch.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-bottleneck-i18n-test/node_modules/playwright-core");
const base="https://app.liftorbit.app",live=process.env.PP_BOTTLENECK_I18N_LIVE==="1";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:45000});
 const register=await page.evaluate(async({email,password})=>(await fetch("/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,company:"Synthetic bottleneck localization QA"})})).status,{email:"bottleneck-i18n-qa-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(25).toString("base64url")});
 assert.equal(register,200);
 // Open a valid synthetic project, since the empty-account Projects screen
 // hides the planner chat until a project is active.
 const id="prj_units_"+randomUUID().replaceAll("-","").slice(0,13);
 const seeded=await page.evaluate(async id=>{
  const model={scheduler_mode:"resource",quantity_unit:"m2",start:"2026-11-25T00:00:00",
   equipment:[{id:"M1",__ppid:"M1",name:"Тестовый пресс",kind:"press",capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"fixed",duration_min:10}},{id:"M2",__ppid:"M2",name:"Тестовая печь",kind:"oven",capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"fixed",duration_min:10}}],
   orders:[{id:"2601",quantity:600,area:600,unit:"m2",technical_process_id:"P",parameters:{color:"A"}}],
   employees:[{id:"E1",name:"Synthetic operator",role:"operator",shift:"day"}],materials:[],shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},constraints:[],setup_rules:[],
   technical_processes:[{id:"P",name:"Synthetic process",operations:[{id:"OP",name:"Press",sequence:1,duration_min:10,resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"M1",resource_refs:["M1"],quantity:1,unit:"pcs"},{resource_type:"employee",match_mode:"specific",resource_ref:"E1",resource_refs:["E1"],quantity:1,unit:"pcs",consumption_rule:"during_operation"}]},{id:"OP2",name:"Fire",sequence:2,duration_min:10,resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"M2",resource_refs:["M2"],quantity:1,unit:"pcs"}]}]}]};
  const storage={"prodplan.projects.v2":JSON.stringify([{id,name:"Synthetic bottleneck localization QA",model,revision:1,lastPlan:null}]),"prodplan.project.active.v2":id};
  return (await fetch("/api/db-storage",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({storage})})).status;
 },id);
 assert.equal(seeded,200);
 const errors=[];page.on("pageerror",e=>errors.push(String(e).slice(0,180)));
 const plan={valid:true,duration_minutes:1440,generic_schedule:true,wait_minutes:73,operator_wait_minutes:73,cycles:3,generic_operations:[
  {operation_id:"OP",order:"2601",start_min:480,end_min:720,equipment_ids:["M1"],employee_ids:["E1"],batch_quantity:200},
  {operation_id:"OP",order:"2601",start_min:780,end_min:900,equipment_ids:["M1"],employee_ids:["E1"],batch_quantity:200},
  {operation_id:"OP2",order:"2601",start_min:0,end_min:1080,equipment_ids:["M2"],employee_ids:[],batch_quantity:200}
 ]};
 const ready=async()=>{
  await page.reload({waitUntil:"domcontentloaded",timeout:45000});
  await page.waitForFunction(()=>window.__PP_LANGUAGE__?.installed&&typeof model==="object"&&model?.orders?.length===1&&document.querySelectorAll("#planView .tabs > div").length>=6,{},{timeout:30000});
  await page.locator("#ppLanguageSelect").selectOption("en");
  await page.locator(".side .item").filter({hasText:/^(Plan|План)$/}).click();
 };
 const activate=async i=>{
  await page.evaluate(({i,plan})=>{
   window.__ppGenericPlan=plan;window.__ppTabPlan=plan;
   document.querySelectorAll("#planView .tabs > div")[i].dispatchEvent(new Event("click",{bubbles:true,cancelable:true}));
  },{i,plan});
 };
 const snap=()=>page.evaluate(terms=>{
  const box=document.querySelector("#ppTabsView");
  if(!box)return null;
  const leaf=[...box.querySelectorAll("*")].filter(e=>e.children.length===0&&e.getClientRects().length>0).map(e=>({text:e.textContent.trim(),tag:e.tagName,cls:e.className,next:e.nextElementSibling?.textContent.trim()||null}));
  return {text:box.innerText,labels:leaf.filter(x=>terms.includes(x.text)),leaf:leaf.slice(0,80)};
 },[...Object.keys(labels),...Object.values(labels)]);
 const verify=async lang=>{
  const expected=lang==="en"?Object.values(labels):Object.keys(labels);
  await page.waitForFunction(expected=>{
   const box=document.querySelector("#ppTabsView");if(!box)return false;
   return expected.every(t=>[...box.querySelectorAll("*")].some(e=>e.children.length===0&&e.textContent.trim()===t&&e.getClientRects().length>0));
  },expected,{timeout:12000});
  const state=await snap();assert.equal(state.labels.length,4);
  assert.deepEqual(new Set(state.labels.map(x=>x.text)),new Set(expected));
  return state;
 };
 let initial;
 if(!live){
  await ready();await activate(5);initial=await verify("ru");
  console.log("BOTTLENECK_I18N_BASELINE",JSON.stringify(initial));
  await page.route("**/",async route=>{
   if(!route.request().isNavigationRequest()||new URL(route.request().url()).pathname!=="/")return route.continue();
   const response=await route.fetch(),old=await response.text(),out=transformBottleneckLanguage(old,labels);
   assert.notEqual(out,old,"exact existing language renderer");assert.equal(transformBottleneckLanguage(out,labels),out);
   await route.fulfill({response,body:out,headers:{...response.headers(),"content-type":"text/html; charset=utf-8"}});
  });
 }
 await ready();
 const before=await page.evaluate(()=>JSON.stringify(model));
 await activate(5);
 let en;
 try{en=await verify("en")}catch(e){console.log("BOTTLENECK_I18N_DIAGNOSTIC",JSON.stringify(await snap()));throw e}
 const values=state=>state.labels.map(x=>x.next?.replace(/^(\d+(?:[.,]\d+)?)\s+(?:мин|min)$/u,"$1 min"));
 if(initial)assert.deepEqual(values(en),values(initial),"card values unchanged, allowing localized minute unit");
 assert(en.text.includes("Тестовый пресс"),"user-defined resource name stays unchanged");
 await page.locator("#ppLanguageSelect").selectOption("ru");const ru=await verify("ru");
 assert.deepEqual(values(ru),values(en));
 await page.locator("#ppLanguageSelect").selectOption("en");await verify("en");
 // The remaining secondary sections use their original renderers. Report
 // remaining Cyrillic leaf labels (excluding known fixture data), for review.
 const audit=[];
 for(const i of [2,3,4]){
  await activate(i);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const state=await snap();
  audit.push({tab:i,remaining:[...new Set((state?.leaf||[]).map(x=>x.text).filter(x=>/[\u0400-\u04ff]/.test(x)&&!x.includes("Тестовая печь")&&!x.includes("Тестовый пресс")))].slice(0,24)});
 }
 console.log("BOTTLENECK_I18N_OTHER_PLAN_TABS",JSON.stringify(audit));
 await activate(5);await verify("en");
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>window.__PP_LANGUAGE__?.installed&&document.getElementById("ppLanguageSelect")?.value==="en"&&model?.orders?.length===1,{},{timeout:30000});
 await page.locator(".side .item").filter({hasText:/^(Plan|План)$/}).click();
 await activate(5);await verify("en");
 assert.equal(await page.evaluate(()=>JSON.stringify(model)),before,"translation does not change project data");
 assert.deepEqual(errors,[],"no page errors");
 console.log("BOTTLENECK_I18N_BROWSER_PASS",JSON.stringify({live,labels:4,languageRoundtrip:true,modelUnchanged:true,regeneratedLabels:true}));
 await page.screenshot({path:"/tmp/liftorbit-bottleneck-i18n-"+(live?"live":"candidate")+".png"});
}finally{await browser.close()}
