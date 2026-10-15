const assert=require("node:assert/strict");
const {chromium}=require("playwright");
const URL="https://prodplan-i18n-screen-qa-production.up.railway.app/";
(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const page=await browser.newPage({viewport:{width:1510,height:920}});
  const errors=[];page.on("pageerror",e=>errors.push(String(e)));
  const response=await page.goto(URL,{waitUntil:"domcontentloaded",timeout:65000});
  assert.equal(response.status(),200,"QA login must load");
  await page.locator("#ppLanguageSelect").waitFor({state:"visible",timeout:12000});
  await page.waitForFunction(()=>window.__PP_LANGUAGE__?.installed,{timeout:10000});
  assert.equal(await page.locator("#ppLanguageSelect").inputValue(),"en");
  assert.equal(await page.locator("#loginTab").innerText(),"Sign in");
  assert.equal(await page.locator('label[for="password"]').innerText(),"Password");
  assert.equal(await page.locator("#ppLanguageControl").getAttribute("aria-label"),"Language");
  await page.screenshot({path:"locale-qa-login-en.png",fullPage:true});
  await page.locator("#ppLanguageSelect").selectOption("ru");
  assert.equal(await page.locator("#loginTab").innerText(),"Войти");
  assert.equal(await page.locator('label[for="password"]').innerText(),"Пароль");
  assert.equal(await page.locator("#ppLanguageControl").getAttribute("aria-label"),"Язык");
  await page.screenshot({path:"locale-qa-login-ru.png",fullPage:true});
  await page.reload({waitUntil:"domcontentloaded"});
  assert.equal(await page.locator("#ppLanguageSelect").inputValue(),"ru");
  await page.locator("#ppLanguageSelect").selectOption("en");
  assert.equal(await page.locator("#loginTab").innerText(),"Sign in");
  assert.deepEqual(errors,[],"No runtime errors in deployed QA UI");
  console.log("PP_I18N_DEPLOYED_QA_PASS",JSON.stringify({url:URL,defaultLanguage:"en",languages:["en","ru"],persisted:true,noBrowserErrors:true}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
