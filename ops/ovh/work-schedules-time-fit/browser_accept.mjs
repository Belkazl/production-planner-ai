import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {patchPreview} from "./patch.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require("/tmp/liftorbit-equipment-sdk-toolbar-test/node_modules/playwright-core");
const live=process.env.PP_WORK_SCHEDULES_TIME_FIT_LIVE==="1";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900},timezoneId:"Europe/Ljubljana",locale:"en-US"});
 const request=(path,method="GET",body)=>page.evaluate(async({path,method,body})=>{
  const r=await fetch(path,{method,credentials:"same-origin",cache:"no-store",...(body?{headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{})});
  return {status:r.status,data:await r.json().catch(()=>({}))};
 },{path,method,body});
 await page.goto("https://app.liftorbit.app/",{waitUntil:"domcontentloaded",timeout:45000});
 assert.equal((await request("/api/auth/register","POST",{email:"employee-editor-qa-"+randomUUID()+"@liftorbit.invalid",password:randomBytes(25).toString("base64url"),company:"Synthetic equipment toolbar QA"})).status,200);
 const id="prj_start_"+randomUUID().replaceAll("-","").slice(0,13);
 const m={scheduler_mode:"resource",quantity_unit:"m2",start:"2026-10-05T08:00:00",
  equipment:[{id:"M1",__ppid:"M1",name:"QA press",kind:"pressing",capacity:200,capacity_unit:"m2",timing_profile:{timing_mode:"fixed",duration_min:30}}],
  orders:[{id:"2601",quantity:200,area:200,unit:"m2",technical_process_id:"P",process_hours:1,parameters:{color:"A"},ship_by:"2099-12-01T08:00"},{id:"2602",quantity:200,area:200,unit:"m2",technical_process_id:"P",process_hours:1,parameters:{color:"A"}}],
  employees:[{id:"E1",name:"QA operator",role:"operator",shift:"day"}],materials:[{id:"M",name:"QA material",unit:"kg",initial_stock:1000,deliveries:[]}],shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},constraints:[],setup_rules:[],
  technical_processes:[{id:"P",name:"QA process",operations:[{id:"OP",name:"Press",sequence:1,duration_min:30,resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"M1",resource_refs:["M1"],quantity:1,unit:"pcs"},{resource_type:"employee",match_mode:"specific",resource_ref:"E1",resource_refs:["E1"],quantity:1,unit:"pcs",consumption_rule:"during_operation"}]}]}]};
 m.autoclaves=structuredClone(m.equipment);
 const record={id,name:"Synthetic equipment toolbar QA",model:m,revision:1,lastPlan:null,messages:[{role:'user',text:'First project QA message'},{role:'assistant',text:'First project QA response'}]};
 assert.equal((await request("/api/db-storage","POST",{storage:{"prodplan.projects.v2":JSON.stringify([record,{...record,id:id+"_other",name:"Second navigation QA",model:structuredClone(m),messages:[{role:"user",text:"Second project QA message"}]}]),"prodplan.project.active.v2":id}})).status,200);
 if(!live)await page.route("**/",async route=>{
  if(!route.request().isNavigationRequest()||new URL(route.request().url()).pathname!=="/")return route.continue();
  const response=await route.fetch(),old=await response.text(),out=patchPreview(old);
  assert.notEqual(out,old,"authenticated page must receive toolbar patch");assert.equal(patchPreview(out),out);
  await route.fulfill({response,body:out,headers:{...response.headers(),"content-type":"text/html; charset=utf-8"}});
 });
 const errors=[];page.on("pageerror",e=>errors.push(e.message.slice(0,200)));
 const nav=key=>page.locator(".side .item").filter({has:page.locator('[data-pp-solar-holder="'+key+'"]')});
 const head=()=>page.locator("#sectionView .pp-sdk-equipment-toolbar");
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForFunction(()=>window.__PP_EQUIPMENT_SDK_TOOLBAR_V1__&&window.__PP_LANGUAGE__?.installed&&typeof model==="object"&&model?.equipment?.length===1,null,{timeout:30000});
 await page.locator("#ppLanguageSelect").selectOption("en");
 if(await page.evaluate(()=>document.body.classList.contains("projects-mode")))await page.locator(".top .nav > span").filter({hasText:/^(Planning|Планирование)$/}).click();
 await nav("employees").click();
 console.log("EMPLOYEE_EDITOR",await page.locator("#sectionView").evaluate(el=>({heading:el.querySelector("h1")?.textContent,fields:[...el.querySelectorAll("tbody [data-f]")].map(n=>n.dataset.f),buttons:[...el.querySelectorAll(".pp-edit-head button")].map(n=>n.outerHTML.slice(0,160))})));
 await head().waitFor({state:"visible"});
 const snapshot=()=>head().evaluate(h=>{
  const button=e=>{const s=getComputedStyle(e),bg=getComputedStyle(e,"::before"),inner=e.querySelector(".pp-sdk-ButtonInner");return {text:e.textContent.trim(),height:e.getBoundingClientRect().height,radius:parseFloat(s.borderRadius),font:s.fontSize,weight:s.fontWeight,bg:bg.backgroundColor,shadow:bg.boxShadow,color:s.color,variant:e.dataset.variant,hasInner:!!inner,innerVisible:inner?.getBoundingClientRect().width>0}};
  const title=h.querySelector("b"),desc=h.querySelector(".pp-edit-status"),table=h.closest(".pp-edit-wrap")?.querySelector("table");
  return {title:title.textContent.trim(),titleSize:getComputedStyle(title).fontSize,description:desc.textContent.trim(),descSize:getComputedStyle(desc).fontSize,buttons:[button(h.querySelector("[data-pp-add]")),button(h.querySelector("[data-pp-save]"))],inputHeight:table?.querySelector(".pp-sdk-InputContainer")?.getBoundingClientRect().height,selectHeight:table?.querySelector(".pp-sdk-SelectControl")?.getBoundingClientRect().height,columns:[...table.querySelectorAll("th")].map(x=>x.textContent.trim())};
 });
 const verify=async lang=>{
  await page.waitForFunction(lang=>document.querySelector("#sectionView .pp-sdk-equipment-toolbar [data-pp-save]")?.textContent.trim()===(lang==="en"?"Save changes":"Сохранить изменения"),lang,{timeout:15000});
  const s=await snapshot();console.log("EQUIPMENT_TOOLBAR_LAYOUT",JSON.stringify(s));
  assert.equal(s.title,lang==="en"?"Edit data":"Редактирование данных");
  assert.equal(s.titleSize,"16px");assert.equal(s.descSize,"14px");
  assert.deepEqual(s.buttons.map(x=>x.variant),["outline","solid"]);
  for(const btn of s.buttons){assert.ok(Math.abs(btn.height-40)<1,JSON.stringify(btn));assert.ok(btn.radius>=20);assert.equal(btn.font,"14px");assert.equal(btn.weight,"500");assert.ok(btn.hasInner&&btn.innerVisible);assert.notEqual(btn.color,"");}
  assert.notEqual(s.buttons[0].shadow,"none");assert.notEqual(s.buttons[1].bg,"rgba(0, 0, 0, 0)");assert.notEqual(s.buttons[1].color,s.buttons[1].bg);
  assert.ok(Math.abs(s.inputHeight-40)<1&&Math.abs(s.selectHeight-40)<1);
  assert.ok(s.columns.length>=4);
 };
 await verify("en");
 await page.locator("#ppLanguageSelect").selectOption("ru");await verify("ru");
 await page.locator("#ppLanguageSelect").selectOption("en");await verify("en");
 const table=page.locator("#sectionView table.pp-sdk-equipment-table");
 const rows=table.locator("tbody tr");
 const count=await rows.count();
 const shift=table.locator('.pp-sdk-SelectControl').first();
 assert.equal(await shift.evaluate(el=>getComputedStyle(el).fontWeight),'400');
 await shift.focus();await shift.press('Enter');await page.locator('.pp-sdk-MenuList:popover-open').getByRole('option').first().click();
 
 await head().locator("[data-pp-add]").click();
 assert.equal(await rows.count(),count+1,"Native Add handler remains intact");
 await nav("orders").click();
 assert.equal(await head().count(),0,"No styling of unrelated editors");
 assert.equal(await page.locator("#sectionView [data-order-save]").count(),1);
 await nav("employees").click();await head().waitFor();
 assert.equal(await rows.count(),count,"Unsaved equipment draft did not change model");
 const capacity=table.locator('input[data-f="name"]').first();
 await capacity.fill("Updated QA employee");
 const posted=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/project/model/import"&&r.request().method()==="POST",{timeout:30000});
 await head().locator("[data-pp-save]").click();
 assert.ok((await posted).ok());
 await page.waitForFunction(()=>model?.employees?.[0]?.name==="Updated QA employee",null,{timeout:20000});
 const persisted=await request("/api/model");assert.equal(persisted.data.model.employees[0].name,"Updated QA employee");
 await head().waitFor();await verify("en");

 const panel=page.locator("#sectionView [data-pp-weekly-calendar]");
 const verifyCalendar=async()=>{
   await panel.waitFor({state:"visible"});
   await page.waitForFunction(()=>document.querySelector("[data-pp-weekly-calendar] [data-pp-save-schedules] .pp-sdk-ButtonInner")&&document.querySelector("[data-pp-weekly-calendar] input[type=time].pp-sdk-Input"),null,{timeout:15000});
   const result=await panel.evaluate(p=>({
     heading:p.querySelector("strong").textContent.trim(),
     buttons:[...p.querySelectorAll("button")].map(b=>({label:b.textContent.trim(),height:b.getBoundingClientRect().height,radius:parseFloat(getComputedStyle(b).borderRadius),variant:b.dataset.variant,inner:!!b.querySelector(".pp-sdk-ButtonInner")})),
     inputs:[...p.querySelectorAll("input[type=text],input[type=time]")].map(i=>({type:i.type,height:i.getBoundingClientRect().height,wrap:i.parentElement.classList.contains("pp-sdk-InputContainer")})),
     checks:[...p.querySelectorAll("input[type=checkbox]")].map(i=>({checked:i.checked,state:i.nextElementSibling?.dataset.state,height:i.nextElementSibling?.getBoundingClientRect().height,bg:getComputedStyle(i.nextElementSibling).backgroundColor}))
   }));
   console.log("WORK_SCHEDULES_SDK_LAYOUT",JSON.stringify(result));

   const widths=await panel.locator("input[type=time]").evaluateAll(inputs=>inputs.map(i=>{
     const s=getComputedStyle(i),r=i.getBoundingClientRect(),w=i.parentElement.getBoundingClientRect();
     const canvas=document.createElement("canvas"),ctx=canvas.getContext("2d");ctx.font=s.font;
     const textWidth=Math.max(ctx.measureText("08:00 AM").width,ctx.measureText("11:59 PM").width);
     const available=r.width-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight);
     return {value:i.value,input:r.width,wrapper:w.width,height:r.height,available,textWidth,font:s.font,paddingLeft:s.paddingLeft,paddingRight:s.paddingRight};
   }));
   console.log("WORK_SCHEDULES_TIME_FIT_GEOMETRY",JSON.stringify(widths));
   assert.ok(widths.length>=4);
   for(const m of widths){
     assert.ok(m.wrapper>=171&&m.input>=170&&Math.abs(m.height-40)<1,JSON.stringify(m));
     assert.ok(m.available>=m.textWidth+38,"Full AM/PM text plus native picker and separation: "+JSON.stringify(m));
   }
   // Read the native Chromium shadow DOM where available, checking the actual AM/PM field and clock indicator geometry.
   const cdp=await page.context().newCDPSession(page);
   try{
     const {root}=await cdp.send("DOM.getDocument",{depth:0,pierce:true});
     const {nodeIds}=await cdp.send("DOM.querySelectorAll",{nodeId:root.nodeId,selector:"#sectionView [data-pp-weekly-calendar] input[type=time]"});
     const native=[];
     const rect=async(node)=>{const b=(await cdp.send("DOM.getBoxModel",{backendNodeId:node.backendNodeId})).model.border;return {left:Math.min(b[0],b[2],b[4],b[6]),right:Math.max(b[0],b[2],b[4],b[6])}};
     for(const nodeId of nodeIds){
       const {node}=await cdp.send("DOM.describeNode",{nodeId,depth:-1,pierce:true});
       const descendants=[];
       const visit=n=>{descendants.push(n);for(const child of [...(n.children||[]),...(n.shadowRoots||[])])visit(child)};
       visit(node);
       const pseudo=n=>{const a=n.attributes||[];const k=a.indexOf("pseudo");return k<0?"":a[k+1]};
       const ampm=descendants.find(n=>pseudo(n)==="-webkit-datetime-edit-ampm-field");
       const picker=descendants.find(n=>pseudo(n)==="-webkit-calendar-picker-indicator");
       const edit=descendants.find(n=>pseudo(n)==="-webkit-datetime-edit");
       if(ampm&&picker&&edit){
         const a=await rect(ampm),p=await rect(picker),e=await rect(edit);
         native.push({ampm:a,picker:p,edit:e});
         assert.ok(a.right<=e.right+1&&a.right+2<=p.left,"Native AM/PM must fit before the clock: "+JSON.stringify({a,p,e}));
       }
     }
     console.log("WORK_SCHEDULES_TIME_FIT_NATIVE",JSON.stringify(native));
   }finally{await cdp.detach()}

   assert.ok(result.buttons.length>=3&&result.inputs.length>=3&&result.checks.length>=8);
   for(const b of result.buttons){assert.ok(b.inner&&Math.abs(b.height-40)<1&&b.radius>=20,JSON.stringify(b))}
   for(const i of result.inputs){assert.ok(i.wrap&&Math.abs(i.height-40)<1,JSON.stringify(i))}
   for(const c of result.checks){assert.equal(c.state,c.checked?"checked":"unchecked");assert.ok(Math.abs(c.height-18)<1,JSON.stringify(c))}
   assert.equal(result.buttons.find(x=>/^(Save schedules|Сохранить графики)$/.test(x.label)).variant,"solid");
   return result;
 };
 await verifyCalendar();
 await page.locator("#ppLanguageSelect").selectOption("ru");await verify("ru");assert.equal((await verifyCalendar()).heading,"Рабочие графики");
 await page.locator("#ppLanguageSelect").selectOption("en");await verify("en");assert.equal((await verifyCalendar()).heading,"Work schedules");
 await panel.locator("[data-pp-add-shift]").click();
 const newShift=panel.locator('[data-pp-shift="shift-1"]');await newShift.waitFor();
 await newShift.locator('[data-pp-calendar-field="name"]').fill("QA evening");
 await newShift.locator('[data-pp-calendar-field="start"]').fill("08:30");
 await newShift.locator('[data-pp-calendar-field="end"]').fill("18:00");
 await newShift.locator('[data-pp-calendar-day="5"]').uncheck();
 await newShift.locator("[data-pp-add-break]").click();
 const breakRow=newShift.locator("[data-pp-calendar-break]");await breakRow.waitFor();
 await breakRow.locator("input[type=time]").first().fill("12:15");
 await breakRow.locator("input[type=time]").last().fill("13:00");
 await newShift.locator("[data-pp-add-break]").click();
 assert.equal(await newShift.locator("[data-pp-calendar-break]").count(),2);
 await newShift.locator("[data-pp-calendar-break]").last().getByRole("button").click();
 assert.equal(await newShift.locator("[data-pp-calendar-break]").count(),1);
 await verifyCalendar();
 await panel.locator("[data-pp-save-schedules]").click();
 await page.waitForFunction(()=>model?.shift_calendars?.["shift-1"]?.name==="QA evening",null,{timeout:30000});
 const saved=await request("/api/model");const calendar=saved.data.model.shift_calendars["shift-1"];
 assert.equal(calendar.name,"QA evening");assert.equal(calendar.start,"08:30");assert.equal(calendar.end,"18:00");
 assert.deepEqual(calendar.days.slice().sort((a,b)=>a-b),[1,2,3,4]);assert.deepEqual(calendar.breaks,[["12:15","13:00"]]);
 await verifyCalendar();
 console.log("WORK_SCHEDULES_PERSISTENCE_PASS");

 assert.deepEqual(errors,[],"No uncaught page errors");
 await page.screenshot({path:"/tmp/work-schedules-time-fit-"+(live?"live":"candidate")+".png"});
 console.log("WORK_SCHEDULES_TIME_FIT_BROWSER_"+(live?"LIVE":"CANDIDATE")+"_PASS");
}finally{await browser.close()}
