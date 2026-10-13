const assert=require("node:assert/strict");
const {chromium}=require("playwright");
const URL="https://pp-progress-fix-qa-20261010-production.up.railway.app/";
(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const page=await browser.newPage({viewport:{width:1510,height:950},deviceScaleFactor:1});
  const errors=[];page.on("pageerror",err=>errors.push(String(err)));
  const resp=await page.goto(URL,{waitUntil:"domcontentloaded",timeout:90000});
  assert.equal(resp.status(),200);
  await page.waitForFunction(()=>Boolean(window.__PP_ORDER_PARAMS_ACCORDION_V1__?.installed),{timeout:30000});
  const side=page.locator(".side .item").filter({hasText:/^Заказы$/}).first();
  assert.equal(await side.count(),1);
  await side.click();
  const rows=page.locator("#ppOrderParamBody > tr[data-oparam-order]");
  await page.waitForTimeout(700);
  const snapshot=await page.evaluate(()=>({
    url:location.href,orders:document.querySelectorAll("#ppOrderParamBody>tr").length,
    section:document.getElementById("sectionView")?.innerText.slice(0,2500),
    sectionDisplay:getComputedStyle(document.getElementById("sectionView")).display,
    table:document.querySelector(".pp-oparam-table")?.outerHTML.slice(0,450),
    localStorageKeys:Object.keys(localStorage).slice(0,16),
    global:window.__PP_ORDER_PARAMS_ACCORDION_V1__
  }));
  console.log("QA_ORDER_DIAG",JSON.stringify(snapshot).slice(0,4800),"PAGE_ERRORS",JSON.stringify(errors.slice(0,5)));
  await rows.first().waitFor({state:"attached",timeout:15000});
  const count=await rows.count();
  assert(count>=1,"orders must be present");
  await page.waitForFunction(()=>document.querySelectorAll("#ppOrderParamBody .pp-oparam-cell[data-pp-expanded=false]").length===document.querySelectorAll("#ppOrderParamBody>tr").length,{timeout:10000});
  const first=rows.first();
  const structure=await first.evaluate(row=>{
    const rect=el=>{const r=el.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
    const cells=[...row.children].map(rect);
    const param=row.querySelector(".pp-oparam-cell"),toggle=param.querySelector("[data-pp-order-toggle]");
    return{display:getComputedStyle(row).display,cells,paramsDisplay:getComputedStyle(param.querySelector("[data-oparam-list]")).display,paramCount:param.querySelector("[data-oparam-pair]")?param.querySelectorAll("[data-oparam-pair]").length:0,aria:toggle.getAttribute("aria-expanded"),labels:[...row.querySelectorAll("[data-oid],[data-oarea],[data-otp]")].map(e=>e.value)};
  });
  assert.equal(structure.display,"grid","order must use grid layout");
  assert.equal(structure.paramsDisplay,"none","parameters must be hidden initially");
  assert.equal(structure.aria,"false");
  assert.equal(structure.labels[0],"2601");
  assert.equal(structure.labels[1],"2400");
  assert(structure.paramCount>0);
  const [a,b,c,d]=structure.cells;
  assert(Math.abs(a.top-b.top)<2&&Math.abs(b.top-c.top)<2,"three primary cells must be in same row");
  assert(d.top>=a.bottom-2,"parameter section must be below main order fields");
  assert(d.width>c.width*1.6,"collapsed parameter block should span full card");
  await page.screenshot({path:"orders-collapsed.png",fullPage:false});
  const cell=first.locator(".pp-oparam-cell"),toggle=cell.locator("[data-pp-order-toggle]");
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-expanded"),"true");
  assert.notEqual(await cell.locator("[data-oparam-list]").evaluate(e=>getComputedStyle(e).display),"none");
  const oldFirstKey=await cell.locator("[data-pkey]").first().inputValue();
  const oldFirstValue=await cell.locator("[data-pval]").first().inputValue();
  const editable=cell.locator("[data-pval]").first();
  await editable.fill("TEST-600");
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-expanded"),"false");
  await toggle.click();
  assert.equal(await editable.inputValue(),"TEST-600","unsaved edits must survive collapse/expand");
  await editable.fill(oldFirstValue);
  assert.equal(await cell.locator("[data-pkey]").first().inputValue(),oldFirstKey);
  const n=await cell.locator("[data-oparam-pair]").count();
  await cell.locator("[data-padd]").click();
  assert.equal(await cell.locator("[data-oparam-pair]").count(),n+1,"new parameter row missing");
  await page.waitForTimeout(250);
  assert((await toggle.innerText()).includes(String(n+1)),"counter not updated");
  await cell.locator("[data-oparam-pair]").last().locator("[data-pdel]").click();
  assert.equal(await cell.locator("[data-oparam-pair]").count(),n,"new parameter cannot be removed");
  assert.equal(await first.locator("[data-oid]").inputValue(),"2601");
  assert.equal(await first.locator("[data-oarea]").inputValue(),"2400");
  await page.screenshot({path:"orders-expanded.png",fullPage:false});
  const modelWrites=[];
  page.on("request",req=>{if(req.method()==="POST"&&req.url().includes("/api/project/model/import"))modelWrites.push(req.url())});
  await page.locator("[data-order-add]").click();
  await page.waitForTimeout(300);
  assert.equal(await rows.count(),count+1,"adding order should still work");
  assert.equal(await rows.last().locator("[data-pp-order-toggle]").getAttribute("aria-expanded"),"false");
  assert.equal(modelWrites.length,0,"adding an order without saving must not write production data");
  assert(!errors.length,"uncaught script errors: "+JSON.stringify(errors.slice(0,3)));
  console.log("ORDER_STACKED_BROWSER_PASS",JSON.stringify({orders:count,parameters:n,threeColumns:true,below:true,collapsedByDefault:true,expand:true,editsPreserved:true,addDelete:true,newOrder:true,modelWrites:0}));
 }finally{await browser.close()}
})().catch(err=>{console.error(err);process.exit(1)});
