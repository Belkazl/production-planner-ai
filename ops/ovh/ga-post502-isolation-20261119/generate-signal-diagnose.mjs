import {readFileSync,writeFileSync} from "node:fs";
const original=readFileSync("ops/ovh/ga-start-recover-20261119/live-regression.mjs","utf8");
const a=" // Full second optimization on the SAME large-model account.";
const b=' if(errors.length)throw Error("BROWSER_ERRORS_"';
if(original.split(a).length!==2||original.split(b).length!==2)throw Error("BASE_DRIFT");
const start=original.indexOf(a),end=original.indexOf(b,start);
const insert=String.raw`
 // Capture whether the native button passes a stale AbortSignal. Remove only
 // that UI-level signal in this disposable QA account; all production stays unchanged.
 const first=await (await ctx.request.get(base+"/api/plan-progress?ppNoCache=1",{timeout:25000})).json();
 if(first.phase!=="completed"||first.result?.operations?.length<800)throw Error("FIRST_NOT_COMPLETE");
 await page.evaluate(()=>{
  window.__ppSignalQa={calls:[],events:[]};
  const nativeWindowFetch=window.fetch;
  window.fetch=function(input,init){
   try{
    const path=new URL(typeof input==="string"?input:input.url,location.origin).pathname;
    if(path==="/api/plan"&&(init?.method||input?.method||"GET").toUpperCase()==="POST"){
     const s=init?.signal||(input instanceof Request?input.signal:null);
     const prior={signalPresent:!!s,abortedAtDispatch:!!s?.aborted,kind:s?.constructor?.name||null,
       bodyLen:typeof init?.body==="string"?init.body.length:null};
     window.__ppSignalQa.calls.push(prior);
     return nativeWindowFetch(input,{...init,signal:undefined});
    }
   }catch(e){window.__ppSignalQa.events.push(String(e))}
   return nativeWindowFetch(input,init);
  }
 });
 page.on("response",r=>{if(new URL(r.url()).pathname==="/api/plan"&&r.request().method()==="POST")
  console.log("SIGNAL_TEST_NETWORK",JSON.stringify({status:r.status(),bytes:Number(r.headers()["content-length"]||0)}))});
 const gate=await page.evaluate(()=>({text:document.getElementById("opt")?.textContent,
   disabled:document.getElementById("opt")?.disabled}));
 if(gate.disabled||!/continue|продолж/i.test(gate.text||""))throw Error("NATIVE_NOT_CLICKABLE_"+JSON.stringify(gate));
 await page.locator("#opt").click({timeout:12000,noWaitAfter:true});
 const out=[];let newStarted=false;
 for(let i=0;i<30;i++){
  await page.waitForTimeout(4000);
  const sample=await page.evaluate(()=>({calls:window.__ppSignalQa.calls,events:window.__ppSignalQa.events,
    tr:window.__PP_ASYNC_PLAN_TRANSPORT_STATUS__?.state||null,
    ui:window.__PP_GA_PROGRESS_V4__?.state?.visible||null}));
  const p=await (await ctx.request.get(base+"/api/plan-progress?ppNoCache=1",{timeout:22000})).json();
  out.push({i,phase:p.phase,percent:p.percent,running:p.running,signal:sample.calls,
    telemetry:sample.tr,ui:sample.ui,rows:p.result?.operations?.length||0});
  if(i%3===0||p.phase==="running"||p.phase==="failed")
   console.log("SIGNAL_CONTINUE_SAMPLE",JSON.stringify(out.at(-1)));
  if(p.phase==="running"){newStarted=true;break;}
  if(p.phase==="failed"||p.phase==="cancelled")throw Error("SIGNAL_FRESH_FAILED_"+JSON.stringify(out.at(-1)));
 }
 console.log("SIGNAL_CONTINUE_SUMMARY",JSON.stringify({newStarted,last:out.at(-1)}));
 if(!newStarted)throw Error("SIGNAL_NEW_JOB_NOT_SEEN");
`;
writeFileSync("ops/ovh/ga-post502-isolation-20261119/_signal-diagnose.mjs",original.slice(0,start)+insert+original.slice(end));
