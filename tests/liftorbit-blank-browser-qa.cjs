"use strict";
const { chromium } = require("playwright");
const fs=require("fs");
const model=JSON.parse(fs.readFileSync("/tmp/pp-ceramics-live-model.json","utf8")).model;
const base="http://127.0.0.1:8080/";

function snapshotScript(){
  const css=e=>{if(!e)return null;const c=getComputedStyle(e),r=e.getBoundingClientRect();return {display:c.display,visibility:c.visibility,opacity:c.opacity,rect:{w:Math.round(r.width),h:Math.round(r.height)},bg:c.backgroundColor}};
  return {url:location.href,title:document.title,ready:document.readyState,
    bodyChildren:document.body?.children.length||0,bodyTextLength:document.body?.innerText?.length||0,
    lang:document.documentElement.lang,login:css(document.querySelector("body > .box")),
    top:css(document.querySelector(".top")),gantt:css(document.querySelector("#ganttScroll")),
    projects:css(document.querySelector("#projectsView")),loginPresent:!!document.getElementById("loginTab"),
    logoutPresent:!!document.getElementById("ppProtectedLogout"),
    rootBg:getComputedStyle(document.body).backgroundColor,
    modelReady:typeof modelReady!=="undefined"?modelReady:null,orders:(typeof model!=="undefined"&&model&&model.orders)?model.orders.length:null,
    languageInstalled:window.__PP_LANGUAGE__?.installed||false};
}
(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  for(const mode of ["clean","persisted","reloaded","slowwrite"]){
   const ctx=await browser.newContext({viewport:{width:1498,height:994},locale:"en-US",
      userAgent:"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36"});
   const page=await ctx.newPage();
   const problems=[];
   const mark=(kind,item)=>{if(problems.length<30)problems.push({kind,message:String(item).slice(0,260)})};
   page.on("pageerror",e=>mark("js",e.message));
   page.on("console",m=>{if(m.type()==="error")mark("console",m.text())});
   page.on("requestfailed",r=>mark("network",r.url()+" "+r.failure()?.errorText));
   page.on("response",r=>{if(r.status()>=500)mark("http",r.status()+" "+r.url())});
   if(mode==="slowwrite"){
     await page.route("**/api/db-storage*",async route=>{
       if(route.request().method()!=="POST")return route.continue();
       await new Promise(resolve=>setTimeout(resolve,12000));
       try{await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ok:true})})}catch(e){}
     });
   }
   if(mode==="persisted"||mode==="reloaded"){
     const p={id:"prj_mugww6lr_kanzz5",name:"Керамика",revision:50,model,savedPlans:[]};
     const storage={"prodplan.projects.v2":JSON.stringify([p]),"prodplan.project.active.v2":p.id,"prodplan.ui.language.v1":"en"};
     await page.route("**/api/db-storage*",async route=>{
       if(route.request().method()==="GET")return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ok:true,storage})});
       return route.continue();
     });
     await page.addInitScript(data=>{
       try{
         localStorage.setItem("prodplan.projects.v2",JSON.stringify(data.projects));
         localStorage.setItem("prodplan.project.active.v2",data.active);
       }catch(e){}
     },{projects:[p],active:p.id});
   }
   try{
     let res=await page.goto(base,{waitUntil:"domcontentloaded",timeout:30000});
     console.log("BLANK_DIAGNOSTIC_LOGIN",mode,JSON.stringify({status:res.status(),snap:await page.evaluate(snapshotScript)}));
     if(mode==="reloaded"){
       await ctx.addCookies([{name:"pp_demo_auth",value:"tenantA",url:base,httpOnly:true}]);
       res=await page.reload({waitUntil:"domcontentloaded",timeout:40000});
     }else{
       await page.locator("#email").fill("qa@example.invalid");
       await page.locator("#password").fill("qa-test-password");
       await page.locator("#go").click();
       try{await page.waitForURL(base,{waitUntil:"domcontentloaded",timeout:30000})}
       catch(e){mark("login-navigation",e.message)}
     }
     await page.waitForTimeout(5500);
     const snap=await page.evaluate(snapshotScript);
     console.log("BLANK_DIAGNOSTIC_APP",mode,JSON.stringify({snap,problems}));
     if(!await page.evaluate(()=>window.__PP_ASYNC_DB_SYNC__===true))throw Error("Async DB persistence shim not installed: "+mode);
     if(mode==="slowwrite"){
       const start=Date.now();
       await page.evaluate(()=>localStorage.setItem("liftorbit-qa-write-only","non-sensitive-synthetic-qa"));
       const elapsed=Date.now()-start;
       console.log("BLANK_DIAGNOSTIC_ASYNC_WRITE",JSON.stringify({elapsedMs:elapsed,bodyStillVisible:await page.locator(".top").isVisible()}));
       if(elapsed>3000)throw Error("localStorage write blocked UI for "+elapsed+" ms");
       await page.waitForTimeout(500);
     }
     await page.screenshot({path:"diag-"+mode+".png",timeout:15000,animations:"disabled"});
     if(snap.loginPresent || !snap.logoutPresent || !snap.top || snap.top.rect.w<100 || snap.top.rect.h<20)
       throw Error("App not visible after login in "+mode+" "+JSON.stringify(snap));
   }catch(e){
     console.log("BLANK_DIAGNOSTIC_FAILURE",mode,String(e.message).slice(0,2000));
     try{console.log("BLANK_DIAGNOSTIC_RECOVERY",mode,JSON.stringify(await page.evaluate(snapshotScript)))}catch(x){console.log("BLANK_DIAGNOSTIC_UNRESPONSIVE",mode,String(x).slice(0,500))}
     try{await page.screenshot({path:"diag-"+mode+"-failure.png",timeout:10000})}catch{}
     throw e;
   }finally{await ctx.close()}
  }
  console.log("LIFTORBIT_BLANK_SCREEN_4_MODES_AND_ASYNC_STORAGE_PASS");
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
