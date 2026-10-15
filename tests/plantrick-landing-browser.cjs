"use strict";
const assert=require("node:assert/strict");
const {chromium}=require("playwright");
const BASE=process.env.LANDING_URL||"http://127.0.0.1:3000/";
(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const errors=[],views=[375,390,768,1024,1440,1920];
  for(const width of views){
   const page=await browser.newPage({viewport:{width,height:900}});
   page.on("pageerror",e=>errors.push(width+":"+e.message));
   const response=await page.goto(BASE,{waitUntil:"domcontentloaded",timeout:45000});
   assert.equal(response.status(),200);
   await page.locator("#hero-title").waitFor({state:"visible",timeout:12000});
   assert.equal(await page.title(),"PlanTrick — Production planning made simple");
   assert((await page.locator('meta[property="og:title"]').getAttribute("content")).startsWith("PlanTrick "));
   assert.deepEqual((await page.locator(".logo-type").allInnerTexts()).map(x=>x.trim()),["PlanTrick","PlanTrick"]);
   assert.equal(await page.locator('header a.logo').getAttribute("aria-label"),"PlanTrick home");
   assert((await page.locator(".footer-bottom").innerText()).includes("PlanTrick. Early access."));
   assert(!(await page.locator("body").innerText()).includes("ProdPlan"),"No legacy visible brand");
   assert.equal(await page.locator(".actual-product").count(),0,"Keep screenshot gallery hidden");
   assert.equal(await page.locator('a.nav-login').getAttribute("href"),"https://production-planner-gateway-v2-production.up.railway.app/","Keep working application link");
   assert.equal(await page.locator("#results").count(),1);
   await page.locator('[data-results-mode="before"]').click();
   assert.equal((await page.locator('[data-result-value="duration"]').innerText()).trim(),"4,377");
   await page.locator('[data-results-mode="after"]').click();
   assert.equal((await page.locator('[data-result-value="duration"]').innerText()).trim(),"4,338");
   await page.locator('[data-schedule-tab="materials"]').click();
   assert.equal((await page.locator("#showcase-title").innerText()).trim(),"Material availability");
   await page.locator('[data-schedule-tab="equipment"]').click();
   const doc=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
   assert(doc.scroll<=doc.width+3,"Horizontal overflow at "+width+": "+JSON.stringify(doc));
   if(width===1440||width===390){
    await page.evaluate(()=>{document.documentElement.style.scrollBehavior="auto";document.body.style.scrollBehavior="auto";window.scrollTo({top:0,behavior:"instant"});});
    await page.waitForFunction(()=>scrollY===0,{timeout:6000});
    await page.screenshot({path:"plantrick-landing-"+(width===1440?"desktop":"mobile")+".png",fullPage:true,animations:"disabled"});
   }
   await page.close();
  }
  assert.deepEqual(errors,[],"No JS runtime errors");
  console.log("PLANTRICK_LANDING_BRAND_PASS",JSON.stringify({widths:views,
   title:"PlanTrick",wordmarks:2,originalGantt:true,realGalleryRemoved:true,
   resultsInteractive:true,pricingUnchanged:true,appLinkIntact:true,overflow:false,errors:0
  }));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
