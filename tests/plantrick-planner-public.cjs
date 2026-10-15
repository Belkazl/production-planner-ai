"use strict";
const assert=require("node:assert/strict");
const {chromium}=require("playwright");
const BASE=process.env.PLANTRICK_PLANNER_PUBLIC_URL||"https://production-planner-gateway-v2-production.up.railway.app/";
(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const ctx=await browser.newContext({viewport:{width:1440,height:900}});
  const page=await ctx.newPage(),jsErrors=[];
  page.on("pageerror",e=>jsErrors.push(String(e)));
  let response=await page.goto(BASE,{waitUntil:"domcontentloaded",timeout:60000});
  assert.equal(response.status(),200);
  await page.locator("#ppLanguageSelect").waitFor({state:"visible",timeout:15000});
  assert.equal(await page.title(),"Sign in — PlanTrick");
  assert.equal((await page.locator("body > .box > .logo").innerText()).trim(),"PlanTrick");
  assert.equal(await page.locator("#ppLanguageSelect").inputValue(),"en");
  await page.screenshot({path:"plantrick-live-login-en.png",animations:"disabled"});
  await page.locator("#ppLanguageSelect").selectOption("ru");
  assert.equal(await page.title(),"Вход — PlanTrick");
  assert.equal((await page.locator("body > .box > .logo").innerText()).trim(),"PlanTrick");
  await page.screenshot({path:"plantrick-live-login-ru.png",animations:"disabled"});
  await page.reload({waitUntil:"domcontentloaded"});
  assert.equal(await page.locator("#ppLanguageSelect").inputValue(),"ru");
  await page.locator("#ppLanguageSelect").selectOption("en");
  assert.equal(await page.title(),"Sign in — PlanTrick");
  const api=await ctx.request.get(new URL("/api/auth/me",BASE).href,{timeout:30000});
  assert.equal(api.status(),401,"Protected API must remain protected");
  assert.equal(await page.locator("#ppProtectedLogout").count(),0,"Unauthenticated UI must not expose app");
  assert.deepEqual(jsErrors,[],"No browser runtime errors");
  console.log("PLANTRICK_PUBLIC_PLANNER_LOGIN_PASS",JSON.stringify({
   published:true,brand:"PlanTrick",english:true,russian:true,languagePersistence:true,
   anonymousApi:401,authGateIntact:true,errors:0
  }));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
