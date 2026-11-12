const assert=require("node:assert/strict");
const {chromium}=require("playwright");
(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const url=process.env.PP_GANTT_QA_URL||"http://127.0.0.1:8080/";
  const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
  await context.addCookies([{name:"pp_demo_auth",value:"tenantA",url,httpOnly:true}]);
  const page=await context.newPage();
  page.on("pageerror",err=>console.log("PAGE_ERROR",String(err).slice(0,400)));
  const response=await page.goto(url,{waitUntil:"domcontentloaded",timeout:90000});
  assert.equal(response.status(),200);
  await page.waitForFunction(()=>!!window.__PP_GANTT_BLOCK_DETAILS_V1__?.installed,{timeout:15000});
  await page.locator("#ppLanguageSelect").selectOption("ru");
  await page.evaluate(()=>{document.body.classList.remove("projects-mode");document.getElementById("planView").style.display="block"});
  const real=page.locator(".pg2-bar:visible");
  const count=await real.count();
  console.log("REAL_EQUIPMENT_BLOCKS_VISIBLE",count);
  if(count){
   await real.first().click({timeout:10000});
   assert.equal(await page.locator("#ppGanttOperationDetails[hidden]").count(),0);
   const v=await page.locator("#ppGanttOperationDetails").innerText();
   assert(v.length>25,"real chart operation card lacks details");
   console.log("REAL_GANTT_CLICK_DETAILS_OK",v.slice(0,220));
   await page.locator("#ppGanttOperationDetails .pgd-close").click();
  }
  await page.evaluate(()=>{
   function add(id,cls,operation,kind,resourceKind,resource,evt){
    const el=document.createElement("div");
    el.id=id;el.className=cls;
    el.style.cssText="position:fixed;left:25px;top:180px;width:150px;height:32px;z-index:2147483590;background:rgb(57,98,185);color:white;cursor:pointer";
    el.textContent="2602";
    el.__ppOperation=operation;el.__ppKind=kind;el.__ppResourceKind=resourceKind;
    el.__ppResource=resource;el.__ppMaterialEvent=evt||null;el.__ppPlan={start:"2026-10-05T08:00:00Z"};
    el.tabIndex=0;document.body.appendChild(el);
    return el;
   }
   add("qa-gantt-equip","pg2-bar",{order:2602,batch:2,operation_name:"Обжиг",start_min:60,end_min:180,operation_id:"qa-operation-17"},"operation","equipment",{name:"E7P"});
  });
  await page.locator("#qa-gantt-equip").click();
  let info=await page.locator("#ppGanttOperationDetails").innerText();
  for(const v of ["Обжиг","2602","E7P","120 мин"])assert(info.includes(v),"equipment missing "+v);
  await page.screenshot({path:"gantt-click-dialog.png",fullPage:false});
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#ppGanttOperationDetails[hidden]").count(),1);
  await page.evaluate(()=>{
   document.getElementById("qa-gantt-equip").remove();
   const el=document.createElement("div");
   el.id="qa-gantt-setup";el.className="pg2-bar pg2-setup";
   el.style.cssText="position:fixed;left:25px;top:180px;width:150px;height:32px;z-index:2147483590;background:rgb(15,26,45);cursor:pointer";
   el.__ppOperation={order:2611,batch:1,operation_name:"Смена цвета",start_min:200,end_min:225,setup_parameter:"Цвет",from_state:"Зелёный",to_state:"Синий"};
   el.__ppPlan={start:"2026-10-05T08:00:00Z"};
   el.__ppResource={name:"SACMI"};el.__ppResourceKind="equipment";el.__ppKind="setup";
   document.body.appendChild(el);
  });
  await page.locator("#qa-gantt-setup").click();
  info=await page.locator("#ppGanttOperationDetails").innerText();
  for(const v of ["Переналадка","SACMI","Зелёный","Синий","25 мин"])assert(info.includes(v),"setup missing "+v);
  await page.locator("#ppGanttOperationDetails .pgd-close").click();
  console.log("LIVE_BROWSER_GANTT_DETAILS_PASS",JSON.stringify({realBlocks:count,equipment:true,setup:true,esc:true}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
