import {chromium} from "playwright-core";
import assert from "node:assert/strict";
import {randomUUID,randomBytes} from "node:crypto";

const base="https://app.liftorbit.app";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1640,height:940}});
const errors=[];
page.on("pageerror",error=>errors.push(String(error).slice(0,250)));
const api=(path,method="GET",data)=>page.evaluate(async({path,method,data})=>{
 const init={method,cache:"no-store",credentials:"same-origin",headers:{accept:"application/json"}};
 if(data!==undefined){init.headers["content-type"]="application/json";init.body=JSON.stringify(data)}
 const r=await fetch(path,init);let body={};try{body=await r.json()}catch{}
 return {status:r.status,body};
},{path,method,data});
const ids=Array.from({length:12},(_,i)=>"QA"+(2601+i));
const model={
 start:"2026-10-05T08:00:00",finish:"2026-10-08T20:00:00",
 equipment:Array.from({length:14},(_,i)=>({id:"QA_EQ"+i,name:"QA machine "+i,kind:"pressing"})),
 autoclaves:Array.from({length:14},(_,i)=>({id:"QA_EQ"+i,name:"QA machine "+i,kind:"pressing",capacity:600})),
 employees:Array.from({length:5},(_,i)=>({id:"QA_EMP"+i,name:"QA employee "+i,role:"operator",shift:"day"})),
 orders:ids.map(id=>({id,technical_process_id:"QA_TP",quantity:80,unit:"m2"})),
 technical_processes:[{id:"QA_TP",name:"QA production"}],materials:[]
};
function makePlan(duration=4405){
 const operations=Array.from({length:915},(_,i)=>({
  order:ids[i%12],start_min:i*5,end_min:i*5+4,is_setup:i<89,
  operation_name:i<89?"Setup: Press format":"Pressing",
  equipment_ids:["QA_EQ"+(i%14)],employee_ids:["QA_EMP"+(i%5)],
  phase:i<89?"setup":"process"
 }));
 return {valid:true,ok:true,partial:false,_revision:7,
  duration_minutes:duration,batch_count:118,operator_wait_minutes:413124,
  machine_idle_minutes:16859,start:model.start,finish:model.finish,
  operations,generic_operations:operations,batches:[]};
}
async function capture(mode){
 await page.waitForFunction(mode=>{
  return window.__PP_UNIFIED_GANTT_V2__?.activeMode===mode&&
   document.getElementById("planView")?.dataset.ppUnifiedGantt===String(mode);
 },mode,{timeout:12000});
 return page.evaluate(()=>{
  const host=document.getElementById("ppGanttToolV2");
  const panel=document.querySelector("#planView .card.gantt-card");
  const other=document.getElementById("ppTabsView");
  const rows=[...host.querySelectorAll(".pg2-row")];
  return {
   mode:window.__PP_UNIFIED_GANTT_V2__.activeMode,
   chartVisible:getComputedStyle(panel).display!=="none",
   secondaryVisible:other?getComputedStyle(other).display!=="none":null,
   timelineVisible:!host.hidden,
   mainRows:rows.length,
   firstRow:rows[0]?.querySelector(".pg2-title")?.textContent||"",
   name:panel.querySelector(".gantt-head b")?.textContent,
   axis:host.querySelector(".pg2-axis>.pg2-name")?.textContent,
   classes:host.className,
   demoModelEquipment:model.equipment.length,
   accountSavedPlanDuration:window.__ppTabPlan?.duration_minutes||null,
   nativeEngine:window.__PP_UNIFIED_GANTT_V2__?.engine,
   ops:window.__PP_UNIFIED_GANTT_V2__?.lastOperations,
   zoom:window.__PP_GANTT_TOOL_V2__?.zoom,
   hasStop:window.__PP_STOP_RESTORE_PREVIOUS_V1__?.installed===true
  };
 });
}
try{
 const first=await page.goto(base,{waitUntil:"domcontentloaded",timeout:60000});
 assert.equal(first.status(),200);
 const created=await api("/api/auth/register","POST",{
  email:"unified-gantt-qa-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid",
  password:randomBytes(25).toString("base64url"),company:"Disposable three Gantt QA"
 });
 assert.equal(created.status,200);
 await page.goto(base,{waitUntil:"domcontentloaded",timeout:60000});
 await page.waitForFunction(()=>
  window.__PP_UNIFIED_GANTT_V2__?.installed===true&&
  window.__PP_GANTT_TOOL_V2_INSTALLED__===true&&
  window.__PP_SECONDARY_GANTTS_V3__?.installed===true,
 null,{timeout:40000});
 await page.evaluate(({model:fixture,plan})=>{
  document.getElementById("planView").style.display="block";
  document.getElementById("sectionView").style.display="none";
  model=fixture;
  modelReady=true;
  window.__ppTabPlan=plan;
  window.__ppGenericPlan=plan;
  window.__ppOptimizerCommittedPlan=plan;
  renderPlan(plan);
 },{model,plan:makePlan()});
 const tabs=page.locator("#planView .tabs > div");
 assert.equal(await tabs.count(),6);
 let equipment=await capture(0);
 console.log("UNIFIED_GANTT_EQUIPMENT",JSON.stringify(equipment));
 assert.equal(equipment.chartVisible,true);
 assert.equal(equipment.secondaryVisible,false);
 assert.equal(equipment.mainRows,14);
 assert.equal(equipment.nativeEngine,"PP_GANTT_TOOL_V2");
 assert.equal(equipment.hasStop,true);
 console.log("UNIFIED_GANTT_TAB_VISIBILITY",JSON.stringify(await page.evaluate(()=>{
  const host=document.getElementById("planView");
  const tabs=host?.querySelector(".tabs");
  const elements=[...document.querySelectorAll("div,button,a,span")].filter(el=>
   el.children.length===0&&/^(Employee Gantt|Employees|Planning|Гантт сотрудников|Планирование)$/i.test((el.textContent||"").trim()))
   .slice(0,30).map(el=>({
    text:el.textContent.trim(),tag:el.tagName,className:String(el.className).slice(0,100),
    visible:el.getBoundingClientRect().width>0&&el.getBoundingClientRect().height>0,
    display:getComputedStyle(el).display,ancestors:[el.parentElement?.id,el.parentElement?.className].map(String)
   }));
  return {planViewDisplay:getComputedStyle(host).display,
   tabsDisplay:getComputedStyle(tabs).display,
   planViewRect:host.getBoundingClientRect().toJSON(),
   tabsRect:tabs.getBoundingClientRect().toJSON(),elements};
 })));
 await tabs.nth(1).click({timeout:6500});
 let employees=await capture(1);
 console.log("UNIFIED_GANTT_EMPLOYEES",JSON.stringify(employees));
 assert.equal(employees.chartVisible,true);
 assert.equal(employees.secondaryVisible,false);
 assert.equal(employees.mainRows,5);
 assert.match(employees.firstRow,/QA employee 0/);
 assert.equal(employees.ops,915);
 // Zoom must never revert the employee view to a duplicated equipment timeline.
 await page.locator("#zoomIn").click();
 await page.waitForFunction(()=>window.__PP_GANTT_TOOL_V2__?.zoom>1,null,{timeout:8000});
 await page.waitForTimeout(220);
 const employeesZoom=await capture(1);
 console.log("UNIFIED_GANTT_EMPLOYEES_ZOOM",JSON.stringify(employeesZoom));
 assert.equal(employeesZoom.mainRows,5);
 assert.equal(employeesZoom.demoModelEquipment,14,"live model never becomes fake employees");
 assert(employeesZoom.zoom>1);
 await page.evaluate(p=>{
  window.__ppTabPlan=p;
  renderPlan(p);
 },makePlan(4375));
 const employeesPreview=await capture(1);
 assert.equal(employeesPreview.mainRows,5);
 assert.equal(employeesPreview.ops,915);
 await tabs.nth(3).click();
 let orders=await capture(3);
 console.log("UNIFIED_GANTT_ORDERS",JSON.stringify(orders));
 assert.equal(orders.chartVisible,true);
 assert.equal(orders.secondaryVisible,false);
 assert.equal(orders.mainRows,12);
 assert.match(orders.firstRow,/QA2601/);
 assert.equal(orders.ops,915);
 // Other tabs should not also show the equipment chart.
 for(const n of [2,4,5]){
  await tabs.nth(n).click();
  const data=await capture(n);
  console.log("UNIFIED_GANTT_OTHER_TAB",JSON.stringify({tab:n,...data}));
  assert.equal(data.chartVisible,false,"Equipment panel must be absent on other tabs");
  assert.notEqual(data.secondaryVisible,false,"Original material/utilization content remains");
 }
 await tabs.nth(0).click();
 equipment=await capture(0);
 console.log("UNIFIED_GANTT_BACK_TO_EQUIPMENT",JSON.stringify(equipment));
 assert.equal(equipment.chartVisible,true);
 assert.equal(equipment.secondaryVisible,false);
 assert.equal(equipment.mainRows,14);
 assert.match(equipment.firstRow,/QA machine 0/);
 assert.equal(equipment.demoModelEquipment,14);
 assert.equal(equipment.nativeEngine,"PP_GANTT_TOOL_V2");
 assert.deepEqual(errors,[],"no JavaScript exceptions");
 const progress=await api("/api/plan-progress");
 assert.equal(progress.status,200);
 assert.equal(progress.body.running,false,"QA account never starts a GA job");
 console.log("UNIFIED_GANTT_V2_REAL_CHROME_ALL_TABS_ZOOM_AND_PREVIEW_PASS");
}catch(error){
 console.log("UNIFIED_GANTT_V2_REAL_CHROME_FAIL",String(error?.stack||error).slice(0,1650));
 console.log("UNIFIED_GANTT_JS_ERRORS",JSON.stringify(errors.slice(-6)));
 process.exitCode=1;
}finally{await browser.close()}
