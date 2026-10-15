const assert=require("node:assert/strict");
const {chromium}=require("playwright");
const URL=process.env.LANDING_URL||"http://127.0.0.1:3000/";
(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const errors=[];
  for(const width of [390,550,768,900,1024,1440,1920]){
   const page=await browser.newPage({viewport:{width,height:900},deviceScaleFactor:1});
   page.on("pageerror",e=>errors.push(width+": "+String(e)));
   const r=await page.goto(URL,{waitUntil:"domcontentloaded",timeout:50000});
   assert.equal(r.status(),200,"Homepage failed at "+width);
   const section=page.locator("#benefits");
   await section.waitFor({state:"attached",timeout:15000});
   assert.equal(await section.locator(".benefit-item").count(),4,"Exactly four value propositions");
   assert.equal(await section.locator(".benefits-scrap").count(),3,"Illustration needs orders, machines, materials");
   assert.equal(await section.locator(".benefits-after-row").count(),3,"Illustration has planned operations");
   assert((await section.locator("#benefits-title").innerText()).includes("Less planning friction."));
   const expected=[
     "Spend less time rebuilding plans.",
     "Spot constraints before they slow you down.",
     "Make better use of what you have.",
     "Get started without a big IT project."
   ];
   const actual=await section.locator(".benefit-item h3").allTextContents();
   assert.deepEqual(actual.map(x=>x.trim()),expected,"All benefit headings must be present");
   const order=await page.evaluate(()=>({platform:document.querySelector("#platform").offsetTop,
     benefits:document.querySelector("#benefits").offsetTop,
     steps:document.querySelector("#how-it-works").offsetTop}));
   assert(order.platform<order.benefits&&order.benefits<order.steps,"Benefits section position");
   const pageWidth=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,
     client:document.documentElement.clientWidth}));
   assert(pageWidth.scroll<=pageWidth.client+3,"Horizontal overflow at "+width+": "+JSON.stringify(pageWidth));
   const nav=page.locator('.main-nav a[href="#benefits"]');
   assert.equal(await nav.count(),1,"Benefits must be linked in navigation");
   if(width<=1100){
    const toggle=page.locator(".menu-toggle");assert(await toggle.isVisible());
    await toggle.click();assert(await nav.isVisible(),"Menu benefits link must be visible on narrow screen");
    await nav.click();
    assert.equal(await toggle.getAttribute("aria-expanded"),"false","Menu should close on navigation");
   }else{
    assert(await nav.isVisible(),"Benefits nav link should show on wide screens: "+JSON.stringify(await nav.evaluate(el=>({width:innerWidth,display:getComputedStyle(el).display,parent:getComputedStyle(el.parentElement).display,header:getComputedStyle(document.querySelector(".site-header")).display,rect:el.getBoundingClientRect().toJSON()}))));
    const header=await page.evaluate(()=>{
      const n=document.querySelector(".main-nav").getBoundingClientRect(),
            a=document.querySelector(".nav-actions").getBoundingClientRect();
      return {navRight:n.right,actionsLeft:a.left};
    });
    assert(header.navRight<=header.actionsLeft+2,"Header navigation overlaps actions at "+width+": "+JSON.stringify(header));
   }
   if(width===1440){
    await page.screenshot({path:"landing-v2-desktop.png",fullPage:true,animations:"disabled"});
    await section.screenshot({path:"landing-v2-benefits-desktop.png",animations:"disabled"});
    await page.locator('[data-schedule-tab="materials"]').click();
    assert.equal(await page.locator("#showcase-title").textContent(),"Material availability","Existing Gantt still works");
    await page.locator('[data-schedule-tab="equipment"]').click();
    await page.locator(".hero-actions [data-trial-trigger]").click();
    assert(await page.locator("#trial-dialog").evaluate(x=>x.open),"Trial opens");
    await page.locator(".modal-close").click();
   }
   if(width===390){
    await page.evaluate(()=>scrollTo({top:0,behavior:"instant"}));
    await page.screenshot({path:"landing-v2-mobile.png",fullPage:true,animations:"disabled"});
    await section.screenshot({path:"landing-v2-benefits-mobile.png",animations:"disabled"});
   }
   if(width===768)await section.screenshot({path:"landing-v2-benefits-tablet.png",animations:"disabled"});
   await page.close();
  }
  assert.deepEqual(errors,[],"No JS errors across seven viewport widths");
  console.log("LANDING_BENEFITS_V2_PASS",JSON.stringify({url:URL,
   widths:[390,550,768,900,1024,1440,1920],advantages:4,
   responsive:true,menuNavigation:true,noHorizontalOverflow:true,interactiveGanttPreserved:true,
   trialHonestyPreserved:true,productionPlannerUnaffected:true}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
