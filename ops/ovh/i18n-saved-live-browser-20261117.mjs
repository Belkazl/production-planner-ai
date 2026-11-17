import {chromium} from 'playwright';
import {randomUUID,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';

const base="https://app.liftorbit.app";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const context=await browser.newContext({viewport:{width:1600,height:900}});
const page=await context.newPage();
const errors=[];page.on("pageerror",e=>errors.push(String(e).slice(0,160)));
const html=String.raw`<section id="i18n-live-qa" style="padding:10px">
  <h3 id="i18nPlanName">План 15.10.2026 07:44</h3>
  <span id="i18nPlanSummary">15.10.2026, 07:44 · 4338 min · 118 партий · переналадки 1335 мин</span>
  <div id="i18nChanges">Условия изменились: оборудование</div>
  <div id="i18nAllChanges">Условия изменились: старт, заказы, техпроцесс, оборудование, сотрудники/смены, материалы, переналадки</div>
  <button id="i18nOpen">Открыть</button>
  <div id="i18nValidator">Остановлено пользователем. Выбранный план показан на Ганте и пока не сохранён.</div>
  <div id="i18nPreview">Лучший найденный: 4409 мин · временный просмотр, не сохранён</div>
  <span id="i18nProject">Керамика</span>
</section>`;
const expected={
 i18nPlanName:"Plan 15.10.2026 07:44",
 i18nPlanSummary:"15.10.2026, 07:44 · 4338 min · 118 batches · setups 1335 min",
 i18nChanges:"Conditions changed: equipment",
 i18nAllChanges:"Conditions changed: start date, orders, production process, equipment, employees / shifts, materials, setup rules",
 i18nOpen:"Open",
 i18nValidator:"Stopped by user. The selected plan is shown on the Gantt chart and has not been saved yet.",
 i18nPreview:"Best found: 4409 min · Temporary preview, not saved",
 i18nProject:"Керамика"
};
try{
 const guest=await page.goto(base,{waitUntil:"domcontentloaded",timeout:60000});
 assert.equal(guest.status(),200);
 const register=await page.evaluate(async ({email,password})=>{
  const r=await fetch("/api/auth/register",{method:"POST",credentials:"same-origin",
   headers:{"content-type":"application/json"},
   body:JSON.stringify({email,password,company:"One-time localization QA"})});
  return {status:r.status,ok:r.ok};
 },{email:"qa-i18n-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid",password:randomBytes(32).toString("base64url")});
 assert.equal(register.status,200,"Synthetic test account must be created only for this test");
 const logged=await page.goto(base,{waitUntil:"domcontentloaded",timeout:60000});
 assert.equal(logged.status(),200);
 await page.waitForFunction(()=>window.__PP_LANGUAGE__?.installed,{timeout:15000});
 const scripts=await page.evaluate(()=>({
  hasNewTranslator:!!document.querySelector("#ppLanguageUiJs")?.textContent?.includes("Conditions changed:"),
  login:!!document.querySelector("#loginTab"),selection:document.getElementById("ppLanguageSelect")?.value
 }));
 console.log("I18N_LIVE_TRANSLATOR",JSON.stringify(scripts));
 assert.equal(scripts.hasNewTranslator,true,"New localizer must actually be served to logged-in users");
 assert.equal(scripts.login,false);
 await page.locator("#ppLanguageSelect").selectOption("en");
 await page.evaluate(html=>document.body.insertAdjacentHTML("beforeend",html),html);
 await page.waitForFunction(expected=>{
  for(const [id,text] of Object.entries(expected))
   if(document.getElementById(id)?.textContent?.trim()!==text)return false;
  return true;
 },expected,{timeout:10000});
 const en=await page.evaluate(keys=>Object.fromEntries(keys.map(k=>[k,document.getElementById(k)?.textContent?.trim()])),Object.keys(expected));
 assert.deepEqual(en,expected);
 console.log("I18N_LIVE_ENGLISH_DYNAMIC_PASS",JSON.stringify({tested:Object.keys(en).length,lang:await page.locator("#ppLanguageSelect").inputValue()}));
 await page.locator("#ppLanguageSelect").selectOption("ru");
 await page.waitForFunction(()=>document.getElementById("i18nPlanName")?.textContent==="План 15.10.2026 07:44"&&document.getElementById("i18nPreview")?.textContent.includes("временный просмотр"),null,{timeout:10000});
 await page.locator("#ppLanguageSelect").selectOption("en");
 await page.waitForFunction(expected=>Object.entries(expected).every(([id,text])=>document.getElementById(id)?.textContent?.trim()===text),expected,{timeout:10000});
 assert.deepEqual(errors,[],"No uncaught page errors expected during localization");
 console.log("I18N_LIVE_RU_EN_ROUNDTRIP_PASS");
 await page.screenshot({path:"i18n-live-english-qa.png",fullPage:false});
 console.log("I18N_LIVE_PRODUCTION_VERIFIED");
}catch(e){
 console.log("I18N_LIVE_FAILURE",String(e?.stack||e).slice(0,900));
 process.exitCode=1;
}finally{await browser.close()}
