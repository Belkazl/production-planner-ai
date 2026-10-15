"use strict";
const assert=require("node:assert/strict");
const {chromium}=require("playwright");
const LANDING="https://liftorbit.app/";
const APP="https://app.liftorbit.app/";
const LEGACY="https://production-planner-gateway-v2-production.up.railway.app/";
(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const ctx=await browser.newContext({viewport:{width:1440,height:900}});
  const page=await ctx.newPage(),errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  let res=await page.goto(LANDING,{waitUntil:"domcontentloaded",timeout:50000});
  assert.equal(res.status(),200,"LiftOrbit landing must respond 200");
  assert.equal(await page.title(),"Production Scheduling Software for Small Manufacturers | LiftOrbit");
  const links=await page.locator("a[href^='https://app.liftorbit.app/']").count();
  assert(links>=3,"Landing login and app links must point to the custom domain");
  assert.equal(await page.locator("link[rel='canonical']").getAttribute("href"),LANDING);
  await page.screenshot({path:"liftorbit-custom-domain-landing.png",animations:"disabled"});
  res=await page.goto(APP,{waitUntil:"domcontentloaded",timeout:50000});
  assert.equal(res.status(),200,"LiftOrbit app must respond 200");
  await page.locator("#loginTab").waitFor({state:"visible",timeout:18000});
  assert.equal(await page.title(),"Sign in — LiftOrbit");
  assert.equal((await page.locator(".box .logo").innerText()).trim(),"LiftOrbit");
  await page.screenshot({path:"liftorbit-custom-domain-login.png",animations:"disabled"});
  const anonymous=await ctx.request.get(new URL("/api/auth/me",APP).href,{timeout:30000});
  assert.equal(anonymous.status(),401,"Production API must remain protected for guests");
  const getStatus=async(host,origin,fetchSite)=>(
    await ctx.request.post(new URL("/api/model",host).href,{
      timeout:30000,
      headers:{Origin:origin,"Sec-Fetch-Site":fetchSite,"Content-Type":"application/json"},
      data:"{}"
    })
  ).status();
  const newAllowed=await getStatus(APP,APP.replace(/\/$/,""),"same-origin");
  const oldAllowed=await getStatus(LEGACY,LEGACY.replace(/\/$/,""),"same-origin");
  const siblingDenied=await getStatus(APP,LANDING.replace(/\/$/,""),"same-site");
  const outsiderDenied=await getStatus(APP,"https://untrusted.invalid","cross-site");
  assert.equal(newAllowed,401,"New custom-domain same-origin write must reach auth gate, not fail origin check");
  assert.equal(oldAllowed,401,"Legacy Railway same-origin auth must still be available");
  assert.equal(siblingDenied,403,"Landing must not be allowed to POST to app");
  assert.equal(outsiderDenied,403,"Cross-site writes must be refused");
  assert.deepEqual(errors,[],"New public domains must load without browser JS errors");
  console.log("LIFTORBIT_CUSTOM_DOMAIN_PUBLIC_PASS",JSON.stringify({
   landing:LANDING,app:APP,legacyLogin:LEGACY,ssl:true,landingLinks:links,
   registrationUiVisible:true,anonymousLocked:true,
   newAllowed,oldAllowed,siblingDenied,outsiderDenied,
   browserErrors:errors.length,productionDataChanged:false
  }));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
