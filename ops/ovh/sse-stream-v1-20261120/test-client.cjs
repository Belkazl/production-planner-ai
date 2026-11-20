const {chromium}=require("playwright-core");
const assert=require("node:assert/strict");
const fs=require("node:fs");
(async()=>{
 const browser=await chromium.launch({headless:true,
  executablePath:process.env.CHROME_PATH||"/usr/bin/google-chrome",
  args:["--no-sandbox","--disable-dev-shm-usage"]});
 try{
  const page=await browser.newPage();
  const html='<!doctype html><html><body>'+
   '<button id="opt" class="pp-opt-running" style="width:250px;height:42px;background:#8cacf1;color:white">Optimization</button>'+
   '<div id="ppGanttToolV2"><div class="pg2-row"><div class="pg2-lane" style="position:relative;width:800px">'+
   '<button class="pg2-bar" style="width:30px">Pressing</button></div></div></div></body></html>';
  await page.route("https://app.liftorbit.test/",route=>route.fulfill({status:200,contentType:"text/html",body:html}));
  await page.goto("https://app.liftorbit.test/",{waitUntil:"domcontentloaded"});
  await page.evaluate(()=>{
   window.__PP_UNIFIED_GANTT_V2__={activeMode:0};
   window.__unit={calls:[],render:0,dialogs:0};
   window.renderPlan=p=>{window.__unit.render++;window.__unit.lastOps=p.operations.length};
   document.querySelector(".pg2-bar").addEventListener("click",()=>window.__unit.dialogs++);
   const full=Array.from({length:886},(_,i)=>({order:"A",start_min:i*3,end_min:i*3+1,equipment_ids:["E"]}));
   window.__unit.full={ok:true,running:false,success:true,phase:"completed",
    done:100,total:100,percent:100,result:{valid:true,operations:full}};
   window.fetch=async(input,init)=>{
    window.__unit.calls.push(String(input));
    return new Response(JSON.stringify(window.__unit.full),{status:200,
     headers:{"content-type":"application/json"}});
   };
   window.EventSource=class{
    constructor(url){this.url=url;this.listeners=new Map();this.closed=false;
     this.readyState=0;
     window.__unit.sse=this;window.__unit.streams=(window.__unit.streams||0)+1;
     setTimeout(()=>{
       if(this.closed)return;
       if(window.__unit.streams===1){this.readyState=2;this.send("error",{});}
       else{this.readyState=1;this.send("open",{});}
     },5);
    }
    addEventListener(name,fn){const v=this.listeners.get(name)||[];v.push(fn);this.listeners.set(name,v)}
    close(){this.closed=true;this.readyState=2}
    send(name,data){for(const fn of this.listeners.get(name)||[])
      fn({type:name,data:typeof data==="string"?data:JSON.stringify(data)})}
   };
  });
  await page.addScriptTag({content:fs.readFileSync(
   "ops/ovh/sse-stream-v1-20261120/frontend.js.txt","utf8")});
  await page.waitForFunction(()=>window.__PP_SSE_PROGRESS_V1__?.state?.connected===true&&window.__unit.streams>=2,null,{timeout:8000});
  const ready=await page.evaluate(()=>window.__PP_SSE_PROGRESS_V1__.state);
  assert.equal(ready.connected,true,"Must reconnect after early HTTP 409 before GA job exists");
  assert.ok(ready.reconnects>=1,"Startup 409 retry tested");
  const initial=await page.evaluate(()=>window.__PP_SSE_PROGRESS_V1__.state);
  assert.equal(initial.percent,0);
  assert.equal(initial.lineVisible,true);
  assert.equal(await page.locator("#opt .pp-sse-label").innerText(),"0%");
  await page.evaluate(()=>{
   window.__unit.sse.send("progress",{job_id:"job-A",percent:30,phase:"running"});
   window.__unit.sse.send("progress",{job_id:"job-A",percent:30,phase:"running"});
  });
  await page.waitForFunction(()=>window.__PP_SSE_PROGRESS_V1__.state.percent===30,null,{timeout:5500});
  assert.equal((await page.evaluate(()=>window.__PP_SSE_PROGRESS_V1__.state)).percent,30);
  assert.equal(await page.locator("#opt .pp-sse-label").innerText(),"30%");
  await page.evaluate(()=>document.getElementById("opt").textContent="Preparing...");
  await page.waitForTimeout(220);
  assert.equal(await page.locator("#opt .pp-sse-label").innerText(),"30%",
   "native button rewrite must not erase the progress");
  await page.evaluate(()=>{
   const plan={partial:true,_pp_preview_limited:true,
    operations:[{order:"A",start_min:10,end_min:15,equipment_ids:["E"]}]};
   window.__unit.sse.send("preview",{job_id:"job-A",plan});
   window.__unit.sse.send("preview",{job_id:"job-A",plan});
  });
  await page.waitForTimeout(120);
  assert.equal(await page.evaluate(()=>window.__unit.render),1,"duplicate preview must not redraw");
  await page.evaluate(()=>{
   document.querySelector(".pg2-bar").dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true}))
  });
  assert.equal(await page.evaluate(()=>window.__unit.dialogs),0,"interim operation detail blocked");
  await page.evaluate(()=>window.__unit.sse.send("progress",
   {job_id:"job-A",percent:70,phase:"running"}));
  await page.waitForFunction(()=>window.__PP_SSE_PROGRESS_V1__.state.percent===70,null,{timeout:5500});
  assert.equal(await page.locator("#opt .pp-sse-label").innerText(),"70%");
  // Old native wait loops may still run; they must receive memory data instead
  // of producing any browser-to-server progress request.
  await page.evaluate(async()=>{
   for(let i=0;i<35;i++){
    const r=await fetch("/api/plan-progress?ppNoCache=1",{cache:"no-store"});
    const p=await r.json();
    if(p.percent!==70||p.result)throw Error("native_status_cache_invalid");
   }
  });
  assert.equal((await page.evaluate(()=>window.__unit.calls)).length,0,
   "No network API requests during optimization");
  await page.evaluate(()=>window.__unit.sse.send("complete",
   {job_id:"job-A",percent:100,verified:true}));
  await page.waitForFunction(()=>window.__PP_SSE_PROGRESS_V1__.state.completed,null,{
   timeout:9000});
  assert.equal(await page.locator("#opt .pp-sse-label").innerText(),"100%");
  const after=await page.evaluate(()=>({
   state:window.__PP_SSE_PROGRESS_V1__.state,
   calls:window.__unit.calls.slice(),
   result:window.__unit.full,
   dialogs:window.__unit.dialogs
  }));
  assert.equal(after.calls.length,1,"one full-plan GET at the verified end");
  assert.equal(after.state.networkFinalGets,1);
  assert.equal(after.result.result.operations.length,886);
  await page.evaluate(()=>document.querySelector(".pg2-bar").dispatchEvent(
   new MouseEvent("click",{bubbles:true,cancelable:true})));
  assert.equal(await page.evaluate(()=>window.__unit.dialogs),1,"final details available");
  await page.evaluate(async()=>{
   const r=await fetch("/api/plan-progress");
   const data=await r.json();
   if(data.percent!==100||data.result.operations.length!==886)
    throw Error("native_final_plan_missing");
  });
  assert.equal((await page.evaluate(()=>window.__unit.calls)).length,1,
   "native full plan returned from memory, no new API call");
  await page.evaluate(()=>window.dispatchEvent(new Event("pp:optimizer-stopped")));
  const final=await page.evaluate(()=>window.__PP_SSE_PROGRESS_V1__.state);
  assert.equal(final.active,false);
  assert.equal(final.lineVisible,false);
  console.log("SSE_BROWSER_NO_POLL_SMOOTH_0_30_70_100_140_LIMIT_FINAL_886_DETAILS_PASS",
    JSON.stringify({calls:after.calls.length,previews:after.state.previews,events:after.state.events}));
 }finally{await browser.close()}
})().catch(e=>{console.error("SSE_BROWSER_TEST_FAILED",e);process.exitCode=1});
