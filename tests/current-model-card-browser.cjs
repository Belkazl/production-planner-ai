const assert=require("node:assert/strict");
const fs=require("node:fs");
const {chromium}=require("playwright");

(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  await context.addCookies([{name:"pp_demo_auth",value:"tenantA",url:"http://127.0.0.1:8080",httpOnly:true}]);
  const page=await context.newPage();
  const errors=[];
  page.on("pageerror",e=>errors.push(String(e)));
  const response=await page.goto("http://127.0.0.1:8080/",{waitUntil:"domcontentloaded",timeout:30000});
  assert.equal(response.status(),200);
  await page.locator("#summary").waitFor({state:"attached",timeout:12000});
  assert.equal(await page.locator("#pp-current-model-card-style").count(),1,
    "the exact summary CSS must be injected into authenticated HTML");
  const modelFixture=JSON.parse(fs.readFileSync("/tmp/pp-ceramics-live-model.json","utf8")).model;
  const result=await page.evaluate(givenModel=>{
   model=givenModel;
   renderSummary(); // The REAL upstream model renderer, not a synthetic card.
   const summary=document.getElementById("summary");
   const messages=document.getElementById("messages");
   const optimize=document.getElementById("opt");
   return {
    text:summary.textContent.trim(),
    display:getComputedStyle(summary).display,
    element:summary.tagName.toLowerCase()+"#summary",
    parentStart:summary.parentElement?.outerHTML?.slice(0,320)||"",
    messagesStillAttached:!!messages&&messages.isConnected,
    optimizeStillAttached:!!optimize&&optimize.isConnected,
    ordersStillInModel:Array.isArray(model.orders)&&model.orders.length>0,
    equipmentStillInModel:Array.isArray(model.autoclaves)&&model.autoclaves.length>0
   };
  },modelFixture);
  assert(result.text.includes("Текущая модель"),"real renderer still produces model card data");
  assert(result.text.includes("сотрудник")&&result.text.includes("заказ"),
   "real model summary must retain original calculated values");
  assert.equal(result.display,"none","summary must occupy no space in assistant UI");
  assert(result.messagesStillAttached&&result.optimizeStillAttached,
   "chat and optimization controls must remain mounted");
  assert(result.ordersStillInModel&&result.equipmentStillInModel,
   "production input data must remain available");
  console.log("MODEL_CARD_REAL_RENDERER_PASS",JSON.stringify(result));

  const updated=await page.evaluate(()=>{
   model={...model,orders:model.orders.slice(0,1)};
   renderSummary();
   const summary=document.getElementById("summary");
   return {display:getComputedStyle(summary).display,cardStillInDom:summary.textContent.includes("1 заказ")};
  });
  assert.deepEqual(updated,{display:"none",cardStillInDom:true},
   "re-rendering after input changes must not reveal the old summary");
  await page.screenshot({path:"current-model-card-hidden.png",fullPage:false});
  assert.deepEqual(errors,[],"no new browser errors");
  console.log("CURRENT_MODEL_CARD_REMOVAL_BROWSER_PASS",JSON.stringify({
   realRenderer:true,hidden:true,neighbourUiPreserved:true,underlyingModelPreserved:true,
   inputChangesRemainHidden:true,errors:0
  }));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
