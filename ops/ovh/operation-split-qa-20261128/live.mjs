import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-operation-split-qa/node_modules/playwright-core");
const base="https://app.liftorbit.app";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:45000});
 const request=async(path,method="GET",body=null)=>page.evaluate(async({path,method,body})=>{
   const r=await fetch(path,{method,credentials:"same-origin",headers:{"Content-Type":"application/json"},...(body===null?{}:{body:JSON.stringify(body)})});
   return {status:r.status,data:await r.json().catch(()=>null)};
 },{path,method,body});
 const registered=await request("/api/auth/register","POST",{email:"operation-split-qa-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(25).toString("base64url"),company:"Isolated operation split QA"});
 assert.equal(registered.status,200,"isolated QA registration");
 const date=new Date();date.setUTCDate(date.getUTCDate()+2);while([0,6].includes(date.getUTCDay()))date.setUTCDate(date.getUTCDate()+1);
 const day=date.toISOString().slice(0,10);
 const id="prj_split_"+randomUUID().replaceAll("-","").slice(0,13);
 const requirement=(resource_type,resource_ref)=>({resource_type,match_mode:"specific",resource_ref,resource_refs:[resource_ref],quantity:1,unit:"pcs",...(resource_type==="employee"?{consumption_rule:"during_operation"}:{})});
 const equipment=[{id:"OVEN",__ppid:"OVEN",name:"QA full-cycle oven",kind:"firing",capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"fixed",duration_min:30}},{id:"PACK",__ppid:"PACK",name:"QA packing station",kind:"packaging",capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"rate",rate_value:240,rate_unit:"m2/h",performance:240,performance_unit:"m2/h",rate_per_hour:240,quantity_per_hour:240,duration_min:50},performance:240,performance_unit:"m2/h"}];
 const model={scheduler_mode:"resource",quantity_unit:"m2",start:day+"T16:15:00",equipment,autoclaves:structuredClone(equipment),employees:[{id:"E1",name:"QA furnace operator",role:"operator",shift:"day"},{id:"E2",name:"QA packer",role:"operator",shift:"day"}],shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},orders:[{id:"SPLIT-QA-1",quantity:200,area:200,unit:"m2",technical_process_id:"P",process_hours:1,parameters:{color:"A"}}],technical_processes:[{id:"P",name:"QA furnace and packing",operations:[{id:"FIRE",name:"QA furnace",sequence:1,duration_min:30,resource_requirements:[requirement("equipment","OVEN"),requirement("employee","E1")]},{id:"PACK_OP",name:"QA packing",sequence:2,duration_min:50,resource_requirements:[requirement("equipment","PACK"),requirement("employee","E2")]}]}],materials:[],constraints:[],setup_rules:[]};
 assert.equal((await request("/api/db-storage","POST",{storage:{"prodplan.projects.v2":JSON.stringify([{id,name:"Isolated operation split QA",model,revision:1,lastPlan:null}]),"prodplan.project.active.v2":id}})).status,200);
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(id=>localStorage.getItem("prodplan.project.active.v2")===id&&typeof model==="object"&&model?.orders?.length===1,id,{timeout:40000});
 await page.locator("#ppLanguageSelect").selectOption("en");
 if(await page.evaluate(()=>document.body.classList.contains("projects-mode")))await page.locator(".top .nav > span").filter({hasText:/^(Planning|Планирование)$/}).click();
 await page.locator(".side .item").filter({hasText:/^(Plan|План)$/}).click();
 const dateField=page.locator("#ppPlanningStartDate"),timeField=page.locator("#ppPlanningStartTime");
 if(await dateField.isVisible()){
   await dateField.fill(day);await timeField.fill("16:15");
   await page.locator("#ppPlanningStartApply").click();
   await page.waitForFunction(()=>document.querySelector(".pp-planning-start-status")?.textContent.includes("Saved")&&!window.__ppPlanningStartSaving,null,{timeout:45000});
 }
 const state=await request("/api/model");
 const persisted=state.data?.model;
 assert.ok(persisted&&persisted.orders?.[0]?.quantity===200,"exact synthetic quantity persisted");
 console.log("QA_MODEL_TIMING",JSON.stringify({start:persisted.start,equipment:(persisted.equipment||persisted.autoclaves||[]).map(e=>({id:e.id,capacity:e.capacity,timing_profile:e.timing_profile,performance:e.performance,performance_unit:e.performance_unit})),operations:persisted.technical_processes?.[0]?.operations?.map(o=>({id:o.id,name:o.name,duration_min:o.duration_min}))}));
 const opt=page.locator("#opt");await opt.waitFor({state:"visible"});
 const posted=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/plan"&&r.request().method()==="POST",{timeout:30000});
 await opt.click();assert.ok((await posted).status()<400,"optimizer request accepted");
 let final;
 for(let i=0;i<130;i++){const p=await request("/api/plan-progress");if(p.data?.result?.valid===true&&p.data?.running!==true){final=p.data.result;break;}await page.waitForTimeout(1000);}
 assert.ok(final,"valid native optimization completed");
 const rows=(final.operations||[]).filter(o=>o.operation_id==="FIRE"||o.operation_id==="PACK_OP"||/QA furnace|QA packing/.test(String(o.operation_name||o.name||"")));
 assert.ok(rows.length>=2,"expected native operation rows");
 // Output only synthetic schedule rows, not user data, credentials or closed source.
 console.log("OPERATION_SPLIT_QA_ROWS",JSON.stringify(rows));
 const number=o=>Number(o.quantity??o.qty??o.area??o.batch_quantity??o.batch_size??o.volume);
 const name=o=>String(o.operation_id||o.operation_name||o.name||"");
 const fires=rows.filter(o=>/FIRE|furnace/i.test(name(o))),packs=rows.filter(o=>/PACK_OP|packing/i.test(name(o)));
 const quantities=packs.map(number);
 const sum=quantities.reduce((a,b)=>a+b,0);
 const result={fullFurnace:fires.length===1&&Math.abs(number(fires[0])-200)<1e-6,packCount:packs.length,packQuantities:quantities,packTotal:sum};
 console.log("OPERATION_SPLIT_QA_RESULT",JSON.stringify(result));
 // Verify the fixture's rate/calendar first in the printed native schedule; do not infer support from upstream splitting or ambiguous schemas.
 if(!result.fullFurnace||!Number.isFinite(sum)||Math.abs(sum-200)>1e-6)throw Error("INCONCLUSIVE_FIXTURE_OR_UPSTREAM_BATCHING");
 assert.ok(packs.length>=2,"Independent operation splitting missing for the tested full-batch scenario");
 assert.ok(quantities.some(q=>Math.abs(q-60)<1e-6)&&quantities.some(q=>Math.abs(q-140)<1e-6),"Expected shift-fitting 60/140 split; inspect exact timing and rate before diagnosis");
 console.log("OPERATION_SPLIT_QA_QUANTITY_PASS");
}finally{await browser.close();}
