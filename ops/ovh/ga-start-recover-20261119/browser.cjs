const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {chromium}=require("playwright-core");
const path=process.argv[2];
if(!path)throw Error("GA_START_TEST_REQUIRES_PATCHED_FILE");
const js=readFileSync(path,"utf8");
if(js.includes('ga_start_invalid_response'))throw Error("STALE_GENERIC_ERROR_PRESENT");
const browserOpts={channel:"chrome",headless:true,args:["--no-sandbox"]};
(async()=>{
 const browser=await chromium.launch(browserOpts);
 async function scenario(name,kind){
  const page=await browser.newPage();
  let posts=0,progressGets=0,active=false;
  const errors=[];
  page.on("pageerror",e=>errors.push(String(e)));
  try{
   await page.route("https://app.liftorbit.app/",r=>r.fulfill({status:200,contentType:"text/html",body:"<!doctype html><html lang=en><body>GA test</body></html>"}));
   await page.route("https://app.liftorbit.app/api/plan-progress",r=>{
    progressGets++;
    const isComplete=active&&progressGets>=((kind==="recover_502_running"||kind==="bad_202_running"||kind==="recover_409_running")?4:8);
    const p=isComplete?
      {ok:true,phase:"completed",running:false,success:true,percent:100,result:{ok:true,valid:true,operations:[{id:"x1"}],duration_minutes:60}}:
      {ok:true,phase:active?"running":"idle",running:active,success:false,percent:active?12:0,result:null};
    return r.fulfill({status:200,contentType:"application/json",body:JSON.stringify(p)});
   });
   await page.route("https://app.liftorbit.app/api/plan",r=>{
    posts++;
    if(kind==="recover_502_running"){
     active=true;
     return r.fulfill({status:502,contentType:"text/html",body:"<html>Bad Gateway</html>"});
    }
    if(kind==="bad_202_running"){
     active=true;
     return r.fulfill({status:202,contentType:"text/html",body:"broken"});
    }
    if(kind==="recover_409_running"){
     active=true;
     return r.fulfill({status:409,contentType:"application/json",body:JSON.stringify({ok:false,error:"optimization_running_stop_first"})});
    }
    if(kind==="retry_502_then_202"){
     if(posts===1)return r.fulfill({status:502,contentType:"text/html",body:"<html>Bad Gateway</html>"});
     active=true;return r.fulfill({status:202,contentType:"application/json",body:JSON.stringify({ok:true,started:true,job_id:"a".repeat(32),phase:"queued"})});
    }
    if(kind==="normal_202"||kind==="dedupe_concurrent"){
     active=true;return r.fulfill({status:202,contentType:"application/json",body:JSON.stringify({ok:true,started:true,job_id:"a".repeat(32),phase:"queued"})});
    }
    if(kind==="auth_401")return r.fulfill({status:401,contentType:"text/html",body:"<html>login</html>"});
    if(kind==="permanent_503")return r.fulfill({status:503,contentType:"text/html",body:"<html>unavailable</html>"});
    if(kind==="cancel_502")return r.fulfill({status:502,contentType:"text/html",body:"<html>gateway</html>"});
    throw Error("unexpected "+kind);
   });
   await page.goto("https://app.liftorbit.app/");
   await page.addScriptTag({content:js});
   const result=await page.evaluate(async kind=>{
    const request=()=>fetch("/api/plan",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({generations:10,population:12})});
    if(kind==="dedupe_concurrent"){
      const responses=await Promise.all([request(),request()]);
      return await Promise.all(responses.map(async r=>({status:r.status,body:await r.json()})));
    }
    if(kind==="cancel_502"){
      const controller=new AbortController();
      const promise=fetch("/api/plan",{method:"POST",headers:{"content-type":"application/json"},body:"{}",signal:controller.signal});
      setTimeout(()=>controller.abort(),380);
      try{const r=await promise;return {status:r.status,body:await r.json()}}
      catch(e){return {aborted:e.name==="AbortError",name:e.name}}
    }
    const r=await request();
    return {status:r.status,body:await r.json(),
     diagnostics:window.__PP_ASYNC_PLAN_TRANSPORT_STATUS__.state};
   },kind);
   if(kind==="auth_401"){
     assert.equal(result.status,401);
     assert.equal(result.body.error,"authentication_required");
     assert.equal(posts,1,"auth must not be retried");
   }else if(kind==="permanent_503"){
     assert.equal(result.status,503);
     assert.equal(result.body.error,"ga_start_server_temporarily_unavailable");
     assert.equal(posts,3,"must retry with bounded attempts");
   }else if(kind==="cancel_502"){
     assert.equal(result.aborted,true);
     assert.equal(posts,1,"Stop must cancel retries immediately");
   }else{
     if(Array.isArray(result)){
      assert.equal(result.length,2);
      assert(result.every(x=>x.status===200&&x.body.valid));
      assert.equal(posts,1,"one browser click group must submit one real POST");
     }else{
      assert.equal(result.status,200,name);
      assert.equal(result.body.valid,true,name);
      assert.equal(result.body.operations.length,1,name);
     }
     assert(posts=== (kind==="retry_502_then_202"?2:1),"must not submit duplicate job "+name);
   }
   assert.deepEqual(errors,[]);
   console.log("GA_START_RECOVERY_CHROME_PASS",name,JSON.stringify({posts,progressGets,result}));
  }finally{await page.close()}
 }
 try{
  for(const kind of ["normal_202","recover_502_running","bad_202_running","recover_409_running","retry_502_then_202","auth_401","permanent_503","cancel_502","dedupe_concurrent"]){
   await scenario(kind,kind);
  }
  console.log("GA_START_HTTP_502_HTML_RECONNECTION_AND_STOP_ALL_PASS");
 }finally{await browser.close()}
})().catch(e=>{console.error("GA_START_RECOVERY_CHROME_FAILED",String(e?.stack||e));process.exitCode=1});