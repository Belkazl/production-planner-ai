const assert=require("node:assert/strict");
const fs=require("node:fs");
const {chromium}=require("playwright");
(async()=>{
 const raw=JSON.parse(fs.readFileSync("/tmp/pp-ceramics-material-model.json","utf8"));
 const fixture=raw.model||raw,order=fixture.orders.find(x=>x.id===2601);
 assert(order&&fixture.materials.length===6);
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const context=await browser.newContext({viewport:{width:1600,height:950}});
  await context.addCookies([{name:"pp_demo_auth",value:"tenantA",url:"http://127.0.0.1:8080",httpOnly:true}]);
  const page=await context.newPage(),errors=[];
  page.on("pageerror",error=>errors.push(String(error)));
  const response=await page.goto("http://127.0.0.1:8080/",{waitUntil:"domcontentloaded",timeout:40000});
  assert.equal(response.status(),200);
  await page.waitForFunction(()=>Boolean(window.__PP_SECONDARY_GANTTS_V3__?.installed&&window.__PP_LANGUAGE__?.installed),null,{timeout:30000});
  await page.locator("#ppLanguageSelect").selectOption("ru");
  await page.evaluate(m=>{
    model=m;modelReady=true;
    document.body.classList.remove("projects-mode");
    document.getElementById("planView").style.display="block";
  },fixture);
  await page.locator(".side > .item").filter({hasText:"Материалы"}).click();
  await page.locator("#matBody tr[data-m]").first().waitFor({state:"visible",timeout:10000});
  assert.equal(await page.locator("#matBody tr[data-m]").count(),6);
  let names=await page.locator("#matBody [data-f=name]").evaluateAll(a=>a.map(x=>x.value));
  for(const mat of fixture.materials)assert(names.includes(mat.name),"material missing in edit table: "+mat.name);
  assert.equal(await page.locator("#matBody tr[data-m]").first().locator("[data-f=stock]").inputValue(),"185000");
  await page.screenshot({path:"ceramics-materials-editor.png",fullPage:true});
  // Save through the actual existing UI, but ONLY into our isolated mock tenant.
  // The real production project and global fixture are never written.
  await page.locator("#sectionView [data-save]").click();
  await page.waitForFunction(()=>document.getElementById("ppEditStatus")?.textContent==="Сохранено",null,{timeout:20000});
  const persistedResponse=await context.request.get("http://127.0.0.1:8080/api/model");
  assert.equal(persistedResponse.status(),200);
  const persisted=(await persistedResponse.json()).model;
  assert.equal(persisted.materials.length,6,"Material rows lost on existing UI Save");
  assert.deepEqual(persisted.orders,fixture.orders,"Saving materials mutated demo orders");
  assert.deepEqual(persisted.setup_rules,fixture.setup_rules,"Saving materials mutated changeover rules");
  const materialRequirements=persisted.technical_processes[0].operations.flatMap(op=>(op.resource_requirements||[]).filter(r=>r.resource_type==="material"));
  assert.equal(materialRequirements.length,6,"Material per-m2 requirements lost during backend round trip");
  for(const req of materialRequirements)assert.equal(req.consumption_rule,"per_m2");
  const materials=fixture.materials.map(x=>({id:x.id,quantity:x.consumption_per_unit*order.area}));
  const ref=id=>({resource_type:"material",id,quantity:materials.find(x=>x.id===id).quantity});
  const start=fixture.start;
  const testPlan={start,duration_minutes:360,operations:[
    {order:2601,batch:1,start_min:15,end_min:65,operation_name:"Прессование",resources:[ref("M_BODY")]},
    {order:2601,batch:1,start_min:75,end_min:125,operation_name:"Глазурование",resources:[ref("M_ENGOBE"),ref("M_GLAZE")]},
    {order:2601,batch:1,start_min:130,end_min:160,operation_name:"Цифровая декорация",resources:[ref("M_INK")]},
    {order:2601,batch:1,start_min:170,end_min:220,operation_name:"Упаковка",resources:[ref("M_CARTONS"),ref("M_PALLETS")]}
   ],batches:[{order:2601,start_min:15,area:order.area}]};
  const stats=await page.evaluate(plan=>{
    document.getElementById("sectionView").style.display="none";
    document.getElementById("planView").style.display="block";
    const chart=window.__PP_SECONDARY_GANTTS_V3__.renderMode(2,plan);
    const target=document.getElementById("ppTabsView");
    target.replaceChildren(chart);
    target.style.display="block";
    return {
     rows:chart.querySelectorAll(".pp3-row").length,
     deliveries:chart.querySelectorAll(".pp3-bar.pp3-delivery").length,
     consumption:chart.querySelectorAll(".pp3-bar.pp3-consumption").length,
     content:chart.innerText.slice(0,500),
     title:chart.querySelector("h3")?.textContent
    };
  },testPlan);
  assert.equal(stats.rows,6,"Material Gantt should have exactly six lanes");
  assert(stats.deliveries>=6,"All six scheduled deliveries should appear");
  assert(stats.consumption>=6,"All six consumption events should appear");
  assert(stats.title.includes("материал"),"Material Gantt title missing");
  await page.screenshot({path:"ceramics-materials-gantt.png",fullPage:true});
  assert.deepEqual(errors,[],"No JavaScript errors");
  console.log("CERAMICS_MATERIALS_BROWSER_PASS",JSON.stringify({materialRows:stats.rows,receipts:stats.deliveries,consumptions:stats.consumption,russian:true,ordersIntact:fixture.orders.length,visible:true,mockBackendSaved:true,browserErrors:0}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
