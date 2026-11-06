const assert=require("node:assert/strict");
const {chromium}=require("playwright");
(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const ctx=await browser.newContext({viewport:{width:1280,height:840}});
  const page=await ctx.newPage();
  const errs=[],responses=[];
  page.on("pageerror",x=>errs.push(String(x)));
  page.on("response",res=>{
   if(/\/api\/auth\/(login|me|logout)$/.test(new URL(res.url()).pathname))responses.push({path:new URL(res.url()).pathname,status:res.status()});
  });
  const url="http://127.0.0.1:8080/";
  const first=await page.goto(url,{waitUntil:"domcontentloaded",timeout:30000});
  assert.equal(first.status(),200);
  await page.locator("#f #email").fill("synthetic@example.invalid");
  await page.locator("#f #password").fill("qa-test-password");
  await page.locator("#go").click();
  await page.waitForFunction(()=>!!document.getElementById("ppProtectedLogout"),{timeout:35000});
  const auth=await page.evaluate(async()=>{let r=await fetch("/api/auth/me",{credentials:"same-origin"});return r.status});
  assert.equal(auth,200,"signed-in /api/auth/me must succeed even when legacy backend has no such route");
  const storage=await page.evaluate(async()=>{const r=await fetch("/api/db-storage",{credentials:"same-origin"});return {status:r.status,ok:r.ok}});
  assert.equal(storage.status,200,"signed-in API must work");
  const cookies=await ctx.cookies();
  const cookie=cookies.find(x=>x.name==="pp_demo_auth");
  assert(cookie && cookie.httpOnly,"session cookie should be httpOnly and set for visible site");
  assert(responses.some(x=>x.path==="/api/auth/login"&&x.status===200),JSON.stringify(responses));
  assert(responses.some(x=>x.path==="/api/auth/me"&&x.status===200),JSON.stringify(responses));
  await page.screenshot({path:"signed-in-stable.png",fullPage:false});
  console.log("BROWSER_LOGIN_NAVIGATES_TO_PLANNER_PASS",JSON.stringify({sessionCookieHttpOnly:true,authStatus:auth,storageStatus:storage,loginSuccess:true,logoutVisible:true,pageErrors:errs.slice(0,3)}));
  await page.locator("#ppProtectedLogout").click();
  await page.locator("#loginTab").waitFor({timeout:10000});
  const after=await page.evaluate(async()=>{const r=await fetch("/api/db-storage",{credentials:"same-origin"});return r.status});
  assert.equal(after,401,"logout must revoke access");
  console.log("BROWSER_LOGOUT_REVOKES_SESSION_PASS");
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
