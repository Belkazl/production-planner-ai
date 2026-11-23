import {chromium} from "playwright-core";
import {randomUUID,randomBytes} from "node:crypto";
import {readFileSync} from "node:fs";
import assert from "node:assert/strict";
import vm from "node:vm";
const source=readFileSync("ops/ovh/units-single-source-20261123/resource-units-html.js","utf8");
const context={};vm.runInNewContext(source+";this.transform=ppResourceUnitsHtml;",context);
const transform=context.transform;
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 const page=await browser.newPage({viewport:{width:1580,height:1000}});
 const errors=[];page.on("pageerror",e=>errors.push(String(e)));
 let r=await page.goto("https://app.liftorbit.app",{waitUntil:"domcontentloaded",timeout:45000});
 assert.equal(r.status(),200);
 const email="unit-single-qa-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid";
 const password=randomBytes(25).toString("base64url");
 const reg=await page.evaluate(async({email,password})=>{
  const r=await fetch("/api/auth/register",{method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({email,password,company:"Unit source isolated QA"})});return r.status
 },{email,password});
 assert.equal(reg,200);
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 const body=await page.content();
 assert(body.includes("function rr(r){"),"full native Production editor source available");
 assert(body.includes("function renderMaterials(){"));
 const transformed=transform(body);
 assert(transformed.includes("function ppCanonicalRequirementUnit"));
 assert(transformed.includes("readonly aria-readonly=\"true\""));
 assert(transformed.includes("ppNormalizeRequirementUnits(next)"));
 assert(!transformed.includes("data-rf=\"unit\" value=\"'+esc(r.unit||"));
 assert.equal(transform("not the native production HTML"),"not the native production HTML");
 console.log("UNITS_ACTUAL_NATIVE_HTML_TRANSFORM_PASS",JSON.stringify({bytesBefore:body.length,bytesAfter:transformed.length,delta:transformed.length-body.length}));
 const id="prj_units_"+randomUUID().replaceAll("-").slice(0,13);
 const model={
  scheduler_mode:"resource",start:"2026-11-23T08:00:00",quantity_unit:"м²",
  orders:[{id:"2601",area:20,quantity:20,unit:"м²",technical_process_id:"TP-1",process_hours:1}],
  autoclaves:[{id:"EQ-1",name:"Press",kind:"pressing",capacity:500,capacity_unit:"м²"}],
  equipment:[{id:"EQ-1",name:"Press",kind:"pressing",capacity:500,capacity_unit:"м²"}],
  employees:[{id:"EMP-1",name:"Operator",role:"Press operator",shift:"day"}],
  shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},
  materials:[{id:"M1",name:"Powder",unit:"кг",initial_stock:185000,deliveries:[]},
    {id:"M2",name:"Boxes",unit:"шт.",initial_stock:1000,deliveries:[]}],
  technical_processes:[{id:"TP-1",name:"Ceramics",operations:[{
   id:"OP-1",sequence:1,name:"Pressing",duration_min:40,parallel_allowed:false,
   resource_requirements:[
    {id:"RR-M1",resource_type:"material",match_mode:"specific",resource_ref:"M1",quantity:18.5,unit:"шт.",consumption_rule:"per_m2"},
    {id:"RR-E",resource_type:"equipment",match_mode:"specific",resource_ref:"EQ-1",quantity:1,unit:"кг",consumption_rule:"during_operation"},
    {id:"RR-L",resource_type:"employee",match_mode:"specific",resource_ref:"EMP-1",quantity:1,unit:"кг",consumption_rule:"during_operation"}
   ]}]}],
  setup_rules:[]
 };
 const projects=JSON.stringify([{id,name:"Unit source QA",model,revision:1}]);
 const stored=await page.evaluate(async ({id,projects})=>{
  const r=await fetch("/api/db-storage",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({storage:{"prodplan.projects.v2":projects,"prodplan.project.active.v2":id}})});
  return r.status;
 },{id,projects});
 assert.equal(stored,200,"isolated project save");
 await page.route("**/","route" in {}?()=>{}:async route=>{
  if(route.request().isNavigationRequest()&&new URL(route.request().url()).pathname==="/"){
   const resp=await route.fetch();
   let html=await resp.text();
   if(html.includes("function rr(r){"))html=transform(html);
   return route.fulfill({response:resp,body:html,headers:{...resp.headers(),"content-type":"text/html; charset=utf-8"}});
  }
  return route.continue();
 });
 await page.reload({waitUntil:"domcontentloaded",timeout:45000});
 await page.waitForTimeout(1250);
 const diag=await page.evaluate(()=>({
  active:localStorage.getItem("prodplan.project.active.v2"),
  projectCount:JSON.parse(localStorage.getItem("prodplan.projects.v2")||"[]").length,
  route:location.pathname,
  renderSectionType:typeof renderSection,
  modelDefined:typeof model,
  section:!!document.getElementById("sectionView"),
  unitPatch: [...document.scripts].some(x=>x.textContent?.includes("function ppCanonicalRequirementUnit")),
  nav:[...document.querySelectorAll("a,button,[role=tab],.nav-item")].filter(x=>/Производство|Материалы|Production|Materials/i.test(x.textContent||"")).map(x=>({text:x.textContent?.trim(),html:x.outerHTML.slice(0,180)})).slice(0,15)
 }));
 console.log("UNITS_PATCHED_BROWSER_CONTEXT",JSON.stringify(diag).slice(0,3000));
 assert(diag.unitPatch,"new unit source in loaded browser");
 assert.equal(errors.length,0,"modified HTML must not break browser scripts "+JSON.stringify(errors.slice(0,4)));
 // Exercise the real native Production and Materials editors, not synthetic HTML.
 const captured=[];
 await page.route("**/api/project/model/import",async route=>{
  const body=JSON.parse(route.request().postData()||"{}");
  captured.push(body.model);
  await route.fulfill({status:200,contentType:"application/json",
   body:JSON.stringify({ok:true,model:body.model,model_ready:true})});
 });
 model.technical_processes.push({id:"TP-2",name:"Packing",operations:[{
  id:"OP-2",sequence:1,name:"Pack",duration_min:10,resource_requirements:[
   {id:"RR-M2",resource_type:"material",match_mode:"specific",resource_ref:"M2",
    quantity:4,unit:"кг",consumption_rule:"per_operation"}
  ]}]});
 const rendered=await page.evaluate(m=>{
  model=m;modelReady=true;renderSection("Производство");
  return [...document.querySelectorAll("#sectionView [data-r]")].map(row=>({
   id:row.dataset.id,
   type:row.querySelector("[data-rf=resource_type]")?.value,
   unit:row.querySelector("[data-rf=unit]")?.value,
   readonly:row.querySelector("[data-rf=unit]")?.readOnly,
   quantity:row.querySelector("[data-rf=quantity]")?.value,
   consumption:row.querySelector("[data-rf=consumption_rule]")?.value
  }));
 },model);
 const unitOf=(id)=>rendered.find(x=>x.id===id);
 assert.equal(unitOf("RR-M1").unit,"кг");
 assert.equal(unitOf("RR-E").unit,"шт.");
 assert.equal(unitOf("RR-L").unit,"чел.");
 assert(rendered.every(x=>x.readonly),"all Production unit controls must be read-only");
 assert.equal(unitOf("RR-M1").quantity,"18.5");
 assert.equal(unitOf("RR-M1").consumption,"per_m2");
 console.log("UNITS_EDITOR_READONLY_AND_CANONICAL_DISPLAY_PASS",JSON.stringify(rendered));
 const dynamic=await page.evaluate(()=>{
  const row=document.querySelector('#sectionView [data-r][data-id="RR-M1"]');
  const sel=row.querySelector("[data-rf=resource_ref]");
  sel.value="M2";sel.dispatchEvent(new Event("change",{bubbles:true}));
  const afterBoxes=row.querySelector("[data-rf=unit]").value;
  sel.value="M1";sel.dispatchEvent(new Event("change",{bubbles:true}));
  const afterPowder=row.querySelector("[data-rf=unit]").value;
  row.querySelector("[data-rf=unit]").value="invalid manual value";
  row.querySelector("[data-rf=unit]").dispatchEvent(new Event("input",{bubbles:true}));
  return {afterBoxes,afterPowder};
 });
 assert.equal(dynamic.afterBoxes,"шт.");
 assert.equal(dynamic.afterPowder,"кг");
 console.log("UNITS_MATERIAL_SELECTION_AUTOMATIC_UPDATE_PASS",JSON.stringify(dynamic));
 await page.locator('#sectionView [data-save]').click();
 await page.waitForTimeout(350);
 assert.equal(captured.length,1,"Production save captured");
 const first=captured[0];
 const req=(m,p,op)=>m.technical_processes.find(x=>x.id===p).operations.find(x=>x.id===op).resource_requirements;
 const one=req(first,"TP-1","OP-1");
 assert.deepEqual(one.map(x=>x.unit),["кг","шт.","чел."]);
 assert.equal(one[0].quantity,18.5);
 assert.equal(one[0].consumption_rule,"per_m2");
 assert.equal(req(first,"TP-2","OP-2")[0].unit,"шт.","even other technical processes must be normalized");
 console.log("UNITS_ALL_TECH_PROCESSES_NORMALIZED_ON_PRODUCTION_SAVE_PASS");
 await page.evaluate(()=>renderSection("Материалы"));
 await page.locator('#matBody [data-id="M1"] [data-f=unit]').fill("г");
 await page.locator('#sectionView [data-save]').click();
 await page.waitForTimeout(350);
 assert.equal(captured.length,2,"Materials save captured");
 const second=captured[1];
 assert.equal(second.materials.find(x=>x.id==="M1").unit,"г");
 assert.equal(req(second,"TP-1","OP-1")[0].unit,"г");
 assert.equal(req(second,"TP-1","OP-1")[0].quantity,18.5,
  "changing unit must not silently convert quantity");
 assert.equal(req(second,"TP-1","OP-1")[0].consumption_rule,"per_m2",
  "material consumption mode unchanged");
 assert.equal(req(second,"TP-2","OP-2")[0].unit,"шт.");
 console.log("UNITS_MATERIAL_EDIT_PROPAGATES_WITHOUT_QUANTITY_CONVERSION_PASS");
 console.log("UNITS_PATCHED_NATIVE_JS_EXECUTION_PASS");
}finally{await browser.close()}
