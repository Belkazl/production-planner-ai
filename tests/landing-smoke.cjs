const assert=require("node:assert/strict");
const { chromium }=require("playwright");
const BASE=process.env.LANDING_URL||"http://127.0.0.1:3000/";
async function test(){
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const desktop=await browser.newPage({viewport:{width:1440,height:920},deviceScaleFactor:1});
  const errors=[];desktop.on("pageerror",e=>errors.push(String(e)));
  const resp=await desktop.goto(BASE,{waitUntil:"domcontentloaded",timeout:50000});
  assert.equal(resp.status(),200,"landing homepage must be available");
  await desktop.locator(".full-row").first().waitFor({state:"visible",timeout:9000});
  assert.equal(await desktop.title(),"ProdPlan AI — Production planning made simple");
  assert((await desktop.locator("#hero-title").innerText()).includes("Under control."));
  assert.equal(await desktop.locator(".full-row").count(),6);
  const before=await desktop.locator(".full-row").first().locator(".full-bar").first().evaluate(el=>el.style.left);
  await desktop.locator('[data-mode-choice="original"]').click();
  const after=await desktop.locator(".full-row").first().locator(".full-bar").first().evaluate(el=>el.style.left);
  assert.notEqual(before,after,"Illustrative Gantt comparison needs to change the schedule");
  await desktop.locator('[data-mode-choice="optimized"]').click();
  await desktop.locator('[data-schedule-tab="materials"]').click();
  assert.equal(await desktop.locator("#showcase-title").innerText(),"Material availability");
  assert.equal(await desktop.locator(".full-row").count(),6);
  assert((await desktop.locator(".full-row").first().innerText()).includes("Body powder"));
  await desktop.locator('[data-schedule-tab="orders"]').click();
  assert.equal(await desktop.locator("#showcase-title").innerText(),"Order progress");
  assert((await desktop.locator(".full-row").first().innerText()).includes("Order #2607"));
  await desktop.locator('[data-schedule-tab="equipment"]').click();
  const hero=await desktop.locator(".schedule-block").first().evaluate(el=>({left:el.style.left,width:el.style.width}));
  assert(hero.left.endsWith("%")&&hero.width.endsWith("%"));
  await desktop.locator(".faq-list summary").first().click();
  assert(await desktop.locator(".faq-list details").first().evaluate(el=>el.open));
  await desktop.locator(".hero-actions [data-trial-trigger]").click();
  const dialog=desktop.locator("#trial-dialog");
  assert(await dialog.evaluate(el=>el.open),"Trial button must open honest preview dialog");
  assert((await dialog.innerText()).includes("not enabled yet"));
  const trialTarget=await dialog.locator("a.modal-continue").getAttribute("href");
  assert(trialTarget.startsWith("https://production-planner-gateway-v2-production.up.railway.app/"));
  await dialog.locator(".modal-close").click();
  assert(!(await dialog.evaluate(el=>el.open)));
  const importantLinks=await desktop.locator(".main-nav a").evaluateAll(all=>all.map(a=>a.getAttribute("href")));
  assert(importantLinks.every(v=>v&&v.startsWith("#")));
  for(const a of importantLinks)assert.equal(await desktop.locator(a).count(),1,"Missing navigation destination "+a);
  await desktop.screenshot({path:"landing-v1-desktop.png",fullPage:true,animations:"disabled"});
  const mobile=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  const mobileErr=[];mobile.on("pageerror",e=>mobileErr.push(String(e)));
  const mobileResp=await mobile.goto(BASE,{waitUntil:"domcontentloaded",timeout:50000});
  assert.equal(mobileResp.status(),200);
  await mobile.locator(".full-row").first().waitFor({state:"attached",timeout:10000});
  const pageSize=await mobile.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
  assert(pageSize.scroll<=pageSize.client+3,"No horizontal overflow on mobile: "+JSON.stringify(pageSize));
  const toggle=mobile.locator(".menu-toggle");assert(await toggle.isVisible());
  await toggle.click();assert.equal(await toggle.getAttribute("aria-expanded"),"true");
  assert(await mobile.locator(".main-nav a[href='#features']").isVisible());
  await mobile.locator(".main-nav a[href='#features']").click();
  assert.equal(await toggle.getAttribute("aria-expanded"),"false");
  await mobile.locator(".pricing-button").click();
  assert(await mobile.locator("#trial-dialog").evaluate(el=>el.open));
  await mobile.locator(".modal-close").click();
  await mobile.evaluate(()=>window.scrollTo({top:0,behavior:"instant"}));
  await mobile.waitForTimeout(150);
  assert(await mobile.locator(".site-header").isVisible(),"Mobile header must be visible at top");
  await mobile.screenshot({path:"landing-v1-mobile.png",fullPage:true,animations:"disabled"});
  const tablet=await browser.newPage({viewport:{width:768,height:1024}});
  tablet.on("pageerror",e=>errors.push(String(e)));
  await tablet.goto(BASE,{waitUntil:"domcontentloaded",timeout:50000});
  const tabletOverflow=await tablet.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  assert(tabletOverflow<=3,"Tablet horizontal overflow "+tabletOverflow);
  await tablet.screenshot({path:"landing-v1-tablet.png",fullPage:true,animations:"disabled"});
  const health=await desktop.request.get(new URL("/health",BASE).href);
  assert.equal(health.status(),200);assert.equal((await health.json()).ok,true);
  assert.deepEqual(errors,[]);assert.deepEqual(mobileErr,[]);
  console.log("PRODPLAN_LANDING_V1_VISUAL_PASS",JSON.stringify({
   page:BASE,desktop:true,mobile:true,tablet:true,trialDialog:true,pricingClear:true,
   ganttModes:["Initial","Optimized"],views:["equipment","materials","orders"],
   noOverflow:true,browserErrors:0,productionProjectUntouched:true
  }));
 } finally {await browser.close();}
}
test().catch(e=>{console.error(e);process.exit(1)});
