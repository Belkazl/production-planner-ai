const assert=require("node:assert/strict");
const {chromium}=require("playwright");
const fs=require("node:fs");
const fixtureHtml=fs.readFileSync("/tmp/pp-gateway-fixture.html","utf8");
const modelTitleAt=fixtureHtml.indexOf("Текущая модель");
console.log("CURRENT_MODEL_MARKUP_SOURCE",JSON.stringify({found:modelTitleAt>=0,excerpt:modelTitleAt>=0?fixtureHtml.slice(Math.max(0,modelTitleAt-550),modelTitleAt+950):""}));

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
  await page.waitForFunction(()=>!!window.__PP_CURRENT_MODEL_CARD_UI__,null,{timeout:12000});
  const before=await page.evaluate(()=>{
   const nodes=[...document.querySelectorAll("[data-pp-current-model-hidden]")];
   return {cards:nodes.length,hidden:nodes.every(el=>getComputedStyle(el).display==="none"),
    assistantVisible:!!document.querySelector(".shell"),
    planPresent:!!document.getElementById("planView"),
    optimizePresent:!!document.getElementById("opt")};
  });
  assert(before.assistantVisible&&before.planPresent&&before.optimizePresent,
   "removing chat summary must not remove navigation, planning, or optimizer");
  if(before.cards)assert(before.hidden,"real planner model card must be hidden");
  console.log("MODEL_CARD_REAL_FIXTURE",JSON.stringify(before));

  await page.evaluate(()=>{
   const wrapper=document.createElement("section");
   wrapper.id="pp-summary-fixture";
   wrapper.innerHTML='<p id="pp-assistant-intro">AI-помощник работает</p>'+
    '<div id="pp-summary-outer"><div id="pp-summary-card"><b>Текущая модель</b>'+
    '<div><span>14 автоклавов</span><span>5 сотрудников</span>'+
    '<span>12 заказов</span><span>Старт 05.10.2026</span></div></div></div>'+
    '<p id="pp-assistant-followup">Можно запускать оптимизацию</p>';
   document.body.appendChild(wrapper);
   window.__PP_CURRENT_MODEL_CARD_UI__.scan();
  });
  const state=await page.evaluate(()=>{
   const card=document.getElementById("pp-summary-card");
   return {hidden:getComputedStyle(card).display==="none",
    outerShown:getComputedStyle(document.getElementById("pp-summary-outer")).display!=="none",
    introShown:getComputedStyle(document.getElementById("pp-assistant-intro")).display!=="none",
    followupShown:getComputedStyle(document.getElementById("pp-assistant-followup")).display!=="none",
    allValuesStillInDom:card.textContent.includes("14 автоклавов")&&card.textContent.includes("12 заказов")};
  });
  assert.deepEqual(state,{hidden:true,outerShown:true,introShown:true,followupShown:true,allValuesStillInDom:true},
   "only the redundant model card must disappear; underlying data and neighboring UI must remain");

  await page.evaluate(()=>{
   const old=document.getElementById("pp-summary-card");
   old.remove();
   const fresh=document.createElement("div");
   fresh.id="pp-summary-card-new";
   fresh.innerHTML='<strong>Текущая модель</strong><div>2 станка · 4 сотрудника · 6 заказов · Старт 14.10.2026</div>';
   document.getElementById("pp-summary-outer").appendChild(fresh);
  });
  await page.waitForFunction(()=>getComputedStyle(document.getElementById("pp-summary-card-new")).display==="none",null,{timeout:5000});
  await page.screenshot({path:"current-model-card-hidden.png",fullPage:false});
  assert.deepEqual(errors,[],"no new browser exceptions");
  console.log("CURRENT_MODEL_CARD_REMOVAL_BROWSER_PASS",JSON.stringify({liveTitleMatches:before.cards,
   hidden:true,neighbourUiPreserved:true,underlyingDataPreserved:true,projectChangeRehides:true,errors:0}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
