const assert=require("node:assert/strict");
const {chromium}=require("playwright");
const URL="https://aps-setup-bridge-candidate-v2-production.up.railway.app/";
(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const page=await browser.newPage({viewport:{width:1510,height:950},deviceScaleFactor:1});
  const errors=[],writeRequests=[];
  page.on("pageerror",e=>errors.push(String(e)));
  page.on("request",r=>{
   if(r.method()!=="GET" && /\/api\/(project\/model\/import|plan|optimizer-stop)/.test(r.url()))writeRequests.push(r.method()+" "+r.url());
  });
  const res=await page.goto(URL,{waitUntil:"domcontentloaded",timeout:65000});
  assert.equal(res.status(),200);
  await page.waitForFunction(()=>Boolean(window.__PP_ORDER_PARAMS_ACCORDION_V1__?.installed),null,{timeout:30000});
  await page.waitForFunction(()=>typeof model!=="undefined"&&Array.isArray(model?.orders)&&model.orders.length>=12,null,{timeout:65000});
  const section=page.locator(".side .item").filter({hasText:/^Заказы$/}).first();
  await section.click();
  const rows=page.locator("#ppOrderParamBody > tr[data-oparam-order]");
  await rows.first().waitFor({timeout:20000});
  const n=await rows.count();
  assert.equal(n,12,"ceramics demo has 12 orders");
  await page.waitForFunction(()=>document.querySelectorAll("#ppOrderParamBody .pp-oparam-cell[data-pp-expanded=false]").length===12,null,{timeout:10000});
  const first=rows.first();
  const data=await first.evaluate(row=>{
   const rect=el=>{const r=el.getBoundingClientRect();return{top:r.top,left:r.left,width:r.width,bottom:r.bottom}};
   const cells=[...row.children].map(rect);
   const cell=row.querySelector(".pp-oparam-cell");
   return{
    label:getComputedStyle(row.children[1],"::before").content,
    cols:cells,
    process:row.querySelector("[data-otp]")?.value,
    quantity:row.querySelector("[data-oarea]")?.value,
    num:row.querySelector("[data-oid]")?.value,
    params:cell.querySelectorAll("[data-oparam-pair]").length,
    hidden:getComputedStyle(cell.querySelector("[data-oparam-list]")).display==="none",
    header:document.querySelector(".pp-oparam-table thead th:nth-child(2)")?.textContent,
   }
  });
  assert.equal(data.num,"2601");assert.equal(data.quantity,"2400");
  assert(data.label.includes("Объём выпуска"),"invalid visible heading "+data.label);
  assert.equal(data.header,"Объём выпуска");
  assert(data.hidden&&data.params===15,"wrong collapsed parameter count");
  assert(Math.abs(data.cols[0].top-data.cols[1].top)<2&&Math.abs(data.cols[1].top-data.cols[2].top)<2,"three order columns not aligned");
  assert(data.cols[3].top>=data.cols[0].bottom-2,"parameters not below");
  assert(data.cols[3].width>data.cols[2].width*1.6,"parameter section is not full width");
  await page.screenshot({path:"production-orders-collapsed.png",fullPage:false});
  const toggle=first.locator("[data-pp-order-toggle]");
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-expanded"),"true");
  assert.notEqual(await first.locator("[data-oparam-list]").evaluate(e=>getComputedStyle(e).display),"none");
  assert.equal(await first.locator("[data-pkey]").first().inputValue(),"width_mm");
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-expanded"),"false");
  assert.equal(writeRequests.length,0,"smoke test must not change model or optimizer");
  assert.equal(errors.length,0,"uncaught UI errors: "+JSON.stringify(errors));
  console.log("PRODUCTION_ETALON_ORDER_VOLUME_PASS",JSON.stringify({url:URL,orders:n,firstOrder:data.num,firstQuantity:data.quantity,label:data.label,parameterCount:data.params,collapsedByDefault:true,expand:true,writeRequests:0}));
 }finally{await browser.close()}
})().catch(err=>{console.error(err);process.exit(1)});
