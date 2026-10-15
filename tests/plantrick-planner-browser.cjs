"use strict";
const assert=require("node:assert/strict");
const {chromium}=require("playwright");
const BASE=process.env.PLANTRICK_PLANNER_URL||"http://127.0.0.1:8080/";
(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const ctx=await browser.newContext({viewport:{width:1440,height:900}});
  const page=await ctx.newPage(),errors=[],unsafePosts=[];
  page.on("pageerror",e=>errors.push(String(e)));
  page.on("request",r=>{if(/\/api\/(plan|model|project\/model\/import)$/.test(new URL(r.url()).pathname)&&r.method()!=="GET")unsafePosts.push(r.url());});
  let response=await page.goto(BASE,{waitUntil:"domcontentloaded",timeout:40000});
  assert.equal(response.status(),200);
  await page.locator("#ppLanguageSelect").waitFor({state:"visible",timeout:12000});
  assert.equal(await page.title(),"Sign in — PlanTrick");
  assert.equal((await page.locator("body > .box > .logo").innerText()).trim(),"PlanTrick");
  assert.equal(await page.locator("#ppLanguageSelect").inputValue(),"en");
  await page.screenshot({path:"plantrick-login-en.png",animations:"disabled"});
  await page.locator("#ppLanguageSelect").selectOption("ru");
  assert.equal(await page.title(),"Вход — PlanTrick");
  assert.equal((await page.locator("body > .box > .logo").innerText()).trim(),"PlanTrick");
  await page.screenshot({path:"plantrick-login-ru.png",animations:"disabled"});
  await page.locator("#ppLanguageSelect").selectOption("en");
  await ctx.addCookies([{name:"pp_demo_auth",value:"tenantA",url:BASE,httpOnly:true}]);
  response=await page.goto(BASE,{waitUntil:"domcontentloaded",timeout:40000});
  assert.equal(response.status(),200);
  await page.locator("#ppProtectedLogout").waitFor({state:"visible",timeout:30000});
  await page.locator("#ppLanguageSelect").waitFor({state:"visible",timeout:12000});
  await page.locator("#ganttScroll").waitFor({state:"attached",timeout:12000});
  await page.waitForFunction(()=>document.title.includes("PlanTrick"),null,{timeout:12000});
  assert.equal(await page.locator("#ppLanguageSelect").inputValue(),"en");
  let title=await page.title();
  assert(title.includes("PlanTrick"),"Authenticated planner tab should be branded: "+title);
  assert(!title.includes("ProdPlan"),"No legacy branded browser title");
  const header=await page.evaluate(()=>[...document.querySelectorAll(
   "body > .box > .logo, .top .brand, .top .logo, .top .app-title, .side .brand, .side .logo, header .brand, header .logo"
  )].map(x=>x.innerText||""));
  assert(!header.some(x=>x.includes("ProdPlan")),"No legacy chrome labels: "+JSON.stringify(header));
  assert.equal(await page.locator("#ppProtectedLogout").count(),1);
  await page.screenshot({path:"plantrick-planner-authenticated-en.png",animations:"disabled"});
  await page.locator("#ppLanguageSelect").selectOption("ru");
  assert((await page.title()).includes("PlanTrick"));
  assert.equal((await page.locator("#ppProtectedLogout").innerText()).trim(),"Выйти");
  await page.screenshot({path:"plantrick-planner-authenticated-ru.png",animations:"disabled"});
  await page.locator("#ppLanguageSelect").selectOption("en");
  assert((await page.title()).includes("PlanTrick"));
  const auth=await page.evaluate(async()=>{const r=await fetch("/api/auth/me",{credentials:"same-origin"});return r.status});
  assert.equal(auth,200,"Authentication must remain intact");
  assert.equal(await page.evaluate(()=>window.__PP_LANGUAGE__?.current),"en");
  assert.equal(await page.evaluate(()=>window.localStorage.getItem("prodplan.ui.language.v1")),"en","Legacy storage key must be preserved");
  assert.deepEqual(unsafePosts,[],"Brand QA never modifies production plans");
  assert.deepEqual(errors,[],"No JS errors");
  console.log("PLANTRICK_PLANNER_BRAND_PASS",JSON.stringify({
   loginEN:true,loginRU:true,authenticatedPlanner:true,appTitle:title,
   originalGantt:true,languageSwitch:true,authIntact:true,legacyStorageKeyPreserved:true,
   projectDataUntouched:true,unsafeRequests:0,errors:0
  }));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
