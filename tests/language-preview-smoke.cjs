const assert=require("node:assert/strict");
const {chromium}=require("playwright");
const URL=process.env.PP_LANGUAGE_PREVIEW_URL||"https://prodplan-english-language-qa-production.up.railway.app/";
(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const context=await browser.newContext({viewport:{width:1510,height:920}});
  const page=await context.newPage();
  const jsErrors=[];page.on("pageerror",e=>jsErrors.push(String(e)));
  const response=await page.goto(URL,{waitUntil:"domcontentloaded",timeout:80000});
  assert.equal(response.status(),200,"Preview login must return HTTP 200");
  await page.locator("#ppLanguageSelect").waitFor({state:"visible",timeout:12000});
  await page.waitForFunction(()=>window.__PP_LANGUAGE__?.installed,{timeout:15000});
  assert.equal(await page.locator("#ppLanguageSelect").inputValue(),"en");
  assert.equal(await page.locator("#loginTab").innerText(),"Sign in");
  assert.equal(await page.locator('label[for="password"]').innerText(),"Password");
  assert.equal(await page.evaluate(()=>document.documentElement.lang),"en");
  const languageBounds=await page.locator("#ppLanguageSelect").boundingBox();
  assert(languageBounds&&languageBounds.width>40&&languageBounds.height>15,"Language switch must be visible");
  await page.screenshot({path:"preview-login-english.png",fullPage:true});
  await page.locator("#ppLanguageSelect").selectOption("ru");
  assert.equal(await page.locator("#loginTab").innerText(),"Войти");
  assert.equal(await page.locator('label[for="password"]').innerText(),"Пароль");
  await page.screenshot({path:"preview-login-russian.png",fullPage:true});
  await page.reload({waitUntil:"domcontentloaded"});
  await page.locator("#ppLanguageSelect").waitFor({state:"visible",timeout:10000});
  assert.equal(await page.locator("#ppLanguageSelect").inputValue(),"ru","Language choice must persist");
  await page.locator("#ppLanguageSelect").selectOption("en");
  const auth=await context.request.get(new URL("/api/auth/me",URL).href,{timeout:30000});
  assert.equal(auth.status(),401,"Preview must never expose authenticated user data");
  assert.deepEqual(jsErrors,[],"No uncaught browser errors");
  console.log("PUBLIC_I18N_PREVIEW_PASS",JSON.stringify({
   url:URL,defaultLanguage:"en",languages:["en","ru"],
   selectionPersists:true,login:true,noAuthenticationLeak:true,
   visibleLanguageControl:true,browserErrors:0
  }));
 }finally{await browser.close()}
})().catch(err=>{console.error(err);process.exit(1)});