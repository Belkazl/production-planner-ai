"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {chromium}=require("playwright");
const BASE="https://aps-setup-bridge-production.up.railway.app/materials-test";
const OUT="assets/demo";
const num=x=>Number.isFinite(Number(x))?Number(x):0;
(async()=>{
 const b=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const page=await b.newPage({viewport:{width:1500,height:900},deviceScaleFactor:1});
  page.on("pageerror",e=>console.log("DEMO_BROWSER_WARNING",String(e).slice(0,400)));
  const [mr,pr]=await Promise.all([page.request.get(BASE+"/model",{timeout:45000}),page.request.get(BASE+"/plan",{timeout:45000})]);
  assert.equal(mr.status(),200,"Read-only demo model");
  assert.equal(pr.status(),200,"Read-only demo plan");
  const model=(await mr.json()).model,plan=(await pr.json()).plan;
  assert(Array.isArray(model.orders)&&model.orders.length===12);
  assert.equal(model.materials.length,6);
  assert.equal(plan.operations.length,84);
  assert.equal(plan.preview_only,true,"Never expose an actual tenant's plan on a public website");
  const orderIds=model.orders.map(o=>Number(o.id)).sort((a,b)=>a-b);
  assert.deepEqual(orderIds,[2601,2602,2603,2604,2605,2606,2607,2608,2609,2610,2611,2612]);
  const exported={
    type:"read-only-test-etalon-demo",source:"Ceramic demo: existing APS Setup Bridge read-only visual preview",
    title:"12 ceramic orders · 84 planned operations · 6 materials",
    isGAOptimization:false,
    modelStart:String(model.start||"2026-10-05T08:00:00"),
    durationMinutes:num(plan.duration_minutes),
    orders:model.orders.map(o=>({id:Number(o.id),area:num(o.area),quantity:num(o.quantity),kind:String(o.product_name||"Ceramic tiles").slice(0,40)})),
    materials:model.materials.map(m=>({id:String(m.id),name:String(m.name),unit:String(m.unit||""),initialStock:num(m.initial_stock)})),
    operations:plan.operations.map(o=>({
      id:String(o.id||o.operation_id||"").slice(0,150),
      order:Number(o.order||o.order_id||0),batch:Number(o.batch||o.batch_index||1),
      name:String(o.operation_name||o.name||o.operation||"Production operation").slice(0,100),
      start:num(o.start_min??o.start),end:num(o.end_min??o.end),
      resources:(o.resources||[]).map(r=>({
        type:String(r.resource_type||r.type||""),
        id:String(r.id||r.resource_id||r.resource_ref||"").slice(0,80),
        quantity:num(r.quantity||r.consumption||0)
      })).filter(r=>["equipment","employee","material"].includes(r.type))
    }))
  };
  assert(exported.operations.every(o=>o.end>=o.start&&o.end>0));
  fs.mkdirSync(OUT,{recursive:true});
  fs.writeFileSync(path.join(OUT,"ceramic-demo.json"),JSON.stringify(exported,null,2)+"\n");
  const res=await page.goto(BASE,{waitUntil:"domcontentloaded",timeout:60000});
  assert.equal(res.status(),200);
  await page.waitForFunction(()=>window.__PP_MATERIALS_TEST__?.ready,{timeout:50000});
  await page.waitForTimeout(300);
  for(const [key,file] of [
    ["gantt","gantt-materials.png"],["orders","gantt-orders.png"],["employees","gantt-employees.png"]
  ]){
    await page.locator("#ppmt-bar [data-ppmt='"+key+"']").click();
    await page.locator("#ppTabsView .pp3-card").waitFor({state:"visible",timeout:16000});
    const error=await page.locator("#ppmt-state").innerText();
    assert(!error.includes("Ошибка"),"UI error: "+key+": "+error);
    const chart=page.locator("#ppTabsView .pp3-card").first();
    await chart.evaluate(el=>{
      el.style.width="1100px";
      el.style.maxWidth="1100px";
      el.style.margin="0";
    });
    await chart.screenshot({path:path.join(OUT,file),animations:"disabled",timeout:40000});
    const dims=await chart.boundingBox();
    console.log("DEMO_REAL_COMPONENT_CAPTURE",JSON.stringify({key,file,dimensions:dims?{width:dims.width,height:dims.height}:null}));
  }
  await page.locator("#ppmt-bar [data-ppmt='materials']").click();
  await page.locator("#matBody tr[data-m]").first().waitFor({state:"visible"});
  assert.equal(await page.locator("#matBody tr[data-m]").count(),6);
  console.log("DEMO_READ_ONLY_SOURCE_VERIFIED",JSON.stringify({
    orders:exported.orders.length,materials:exported.materials.length,operations:exported.operations.length,
    duration:exported.durationMinutes,preview_only:true,files:fs.readdirSync(OUT),
    sampleOperation:exported.operations[0],sampleMaterial:exported.materials[0]
  }));
 }finally{await b.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
