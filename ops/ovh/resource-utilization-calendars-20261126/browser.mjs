import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {css,helperSource,transformUtilization} from "./patch.mjs";
import {ppCalendarResourceMetrics} from "./metrics.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-utilization-test/node_modules/playwright-core");
const base="https://app.liftorbit.app",live=process.env.PP_UTILIZATION_LIVE==="1";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:45000});
 const register=await page.evaluate(async({email,password})=>(await fetch("/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,company:"Synthetic utilization QA"})})).status,{email:"utilization-qa-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(25).toString("base64url")});
 assert.equal(register,200);
 // Open a valid synthetic project, since the empty-account Projects screen
 // hides the planner chat until a project is active.
 const id="prj_units_"+randomUUID().replaceAll("-","").slice(0,13);
 const seeded=await page.evaluate(async id=>{
  const model={scheduler_mode:"resource",quantity_unit:"m2",start:"2026-11-25T00:00:00",
   equipment:[{id:"M1",name:"Synthetic manual press",kind:"press",capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"fixed",duration_min:10}},{id:"M2",name:"Synthetic autonomous oven",kind:"oven",capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"fixed",duration_min:10}}],
   orders:[{id:"2601",quantity:600,area:600,unit:"m2",technical_process_id:"P",parameters:{color:"A"}}],
   employees:[{id:"E1",name:"Synthetic operator",role:"operator",shift:"day"}],materials:[],shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},constraints:[],setup_rules:[],
   technical_processes:[{id:"P",name:"Synthetic process",operations:[{id:"OP",name:"Press",sequence:1,duration_min:10,resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"M1",resource_refs:["M1"],quantity:1,unit:"pcs"},{resource_type:"employee",match_mode:"specific",resource_ref:"E1",resource_refs:["E1"],quantity:1,unit:"pcs",consumption_rule:"during_operation"}]},{id:"OP2",name:"Fire",sequence:2,duration_min:10,resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"M2",resource_refs:["M2"],quantity:1,unit:"pcs"}]}]}]};
  const storage={"prodplan.projects.v2":JSON.stringify([{id,name:"Synthetic utilization QA",model,revision:1,lastPlan:null}]),"prodplan.project.active.v2":id};
  return (await fetch("/api/db-storage",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({storage})})).status;
 },id);
 assert.equal(seeded,200);
 if(!live)await page.route("**/",async route=>{
  if(!route.request().isNavigationRequest()||new URL(route.request().url()).pathname!=="/")return route.continue();
  const response=await route.fetch(),old=await response.text(),out=transformUtilization(old,css,helperSource);
  assert.notEqual(out,old,"authenticated HTML patch");
  await route.fulfill({response,body:out,headers:{...response.headers(),"content-type":"text/html; charset=utf-8"}});
 });
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>typeof window.__ppGroqRenderResourceUtilization==="function"&&window.__ppGroqRenderResourceUtilization.name==="ppRenderCalendarLoad"&&typeof model==="object"&&model?.orders?.length===1,{},{timeout:30000});
 const plan={valid:true,duration_minutes:1440,generic_schedule:true,generic_operations:[
  {operation_id:"OP",order:"2601",start_min:480,end_min:720,equipment_ids:["M1"],employee_ids:["E1"]},
  {operation_id:"OP",order:"2601",start_min:780,end_min:900,equipment_ids:["M1"],employee_ids:["E1"]},
  {operation_id:"OP2",order:"2601",start_min:0,end_min:1080,equipment_ids:["M2"],employee_ids:[]}
 ]};
 const render=await page.evaluate(plan=>{
  const html=window.__ppGroqRenderResourceUtilization(plan),host=document.createElement("div");host.innerHTML=html;
  const groups=[...host.querySelectorAll("[data-util-group]")].map(g=>({kind:g.dataset.utilGroup,rows:[...g.querySelectorAll(".ppr")].map(row=>({name:row.querySelector("b")?.textContent,effective:row.querySelector(".pp-util-values span")?.textContent,calendar:row.querySelector(".pp-util-values small:last-child")?.textContent,meta:row.querySelector(".pp-util-meta")?.textContent}))}));
  return {groups,html,model:structuredClone(model)};
 },plan);
 assert.equal(render.groups.length,2);assert.equal(render.groups[0].kind,"equipment");assert.equal(render.groups[1].kind,"employees");assert.equal(render.groups[0].rows.length,2);assert.equal(render.groups[1].rows.length,1);
 for(const row of [...render.groups[0].rows,...render.groups[1].rows])assert.equal(row.effective,"75.0%",JSON.stringify(row));
 assert(render.groups[0].rows[0].calendar.includes("25.0%"));assert(render.groups[0].rows[1].calendar.includes("75.0%"));assert(render.groups[1].rows[0].calendar.includes("25.0%"));
 const expected=ppCalendarResourceMetrics(plan,render.model);assert.equal(expected.equipment[0].available,480);
 // Exercise the native secondary-tab handler using the same selected plan.
 // This synthetic plan remains in browser memory only and is not saved.
 const view=await page.evaluate(plan=>{
  const tabs=[...document.querySelectorAll("#planView .tabs > div")];
  if(tabs.length<5)return {ok:false,reason:"tabs"};
  window.__ppGenericPlan=plan;window.__ppTabPlan=plan;
  tabs[4].dispatchEvent(new Event("click",{bubbles:true,cancelable:true}));
  return {ok:true};
 },plan);
 assert(view.ok);
 await page.waitForFunction(()=>!!document.querySelector("#ppTabsView [data-util-group=equipment]")&&!!document.querySelector("#ppTabsView [data-util-group=employees]"),{},{timeout:12000});
 const visible=await page.locator("#ppTabsView").innerText();
 assert(visible.includes("75.0%"));assert(visible.includes("25.0%"));
 const capture=await page.evaluate(()=>typeof ppGroqCaptureContext==="function"?ppGroqCaptureContext():null);
 if(capture?.utilizationSource==="visible_resource_utilization"){assert.equal(capture.totalRows,3);assert(capture.utilization.every(x=>x.percent==="75.0%"))}
 await page.screenshot({path:"/tmp/liftorbit-utilization-"+(live?"live":"candidate")+".png"});
 console.log("UTILIZATION_BROWSER_PASS",JSON.stringify({live,equipment:render.groups[0].rows.length,employees:render.groups[1].rows.length,manual:render.groups[0].rows[0].effective,autonomous:render.groups[0].rows[1].effective,employee:render.groups[1].rows[0].effective}));
}finally{await browser.close()}
