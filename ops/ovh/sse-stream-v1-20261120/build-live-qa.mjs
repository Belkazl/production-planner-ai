import {readFileSync,writeFileSync} from "node:fs";
let s=readFileSync("ops/ovh/ga-start-recover-20261119/live-regression.mjs","utf8");
const one=(a,b,label)=>{
 const needle=s.split(a).length===2?a:a.trimStart();
 if(s.split(needle).length!==2)throw Error("SSE_LIVE_QA_ANCHOR_"+label+"_"+(s.split(needle).length-1));
 s=s.replace(needle,b);
};
const between=(a,b,lines,label)=>{
 const left=s.indexOf(a)>=0?a:a.trimStart();
 const right=s.indexOf(b,s.indexOf(left))>=0?b:b.trimStart();
 const i=s.indexOf(left),j=s.indexOf(right,i);
 if(i<0||j<=i||s.indexOf(left,i+1)>=0)throw Error("SSE_LIVE_QA_RANGE_"+label);
 s=s.slice(0,i)+lines.join("\n")+"\n"+s.slice(j);
};
one(' const firstStageResponseHeaders=[],firstStageVisibleSamples=[];',
 ' const firstStageResponseHeaders=[],firstStageVisibleSamples=[];\n const progressRequests=[],sseRequests=[],startResponses=[],streamResponses=[];',"request_arrays");
one(' page.on("request",r=>{if(new URL(r.url()).pathname==="/api/plan"&&r.method()==="POST")requests.push(Date.now())});',
 ' page.on("request",r=>{if(new URL(r.url()).pathname==="/api/plan"&&r.method()==="POST")requests.push(Date.now())});\n'+
 ' page.on("request",r=>{try{const p=new URL(r.url()).pathname;if(p==="/api/plan-progress")progressRequests.push(Date.now());if(p==="/api/plan-events")sseRequests.push(Date.now())}catch{}});\n'+
 ' page.on("response",r=>{try{const p=new URL(r.url()).pathname;if(p==="/api/plan"&&r.request().method()==="POST")startResponses.push(r.status());if(p==="/api/plan-events")streamResponses.push(r.status())}catch{}});',
 "network_observability");
between(' const guard=await page.evaluate(()=>({v4:',
 ' let suppressedUiProgressRequests=0;',
 [
 ' const guard=await page.evaluate(()=>({',
 '  sse:window.__PP_SSE_PROGRESS_V1__?.installed===true,',
 '  old:window.__PP_GA_PROGRESS_V5__?.installed===true,',
 '  stream:window.__PP_SSE_PROGRESS_V1__?.mode||null',
 ' }));',
 ' if(!guard.sse||guard.old)throw Error("SSE_EXCLUSIVE_CLIENT_NOT_ACTIVE_"+JSON.stringify(guard));',
 ' console.log("SSE_LIVE_GUARDS",JSON.stringify(guard));'
 ],"sse_guard");
one(' const epochs=Date.now();',[
 ' let initialSse=null;',
 ' try{',
 '  await page.waitForFunction(()=>{const s=window.__PP_SSE_PROGRESS_V1__?.state;',
 '   return s&&(s.events>0||s.completed)},null,{timeout:35000,polling:200});',
 '  initialSse=await page.evaluate(()=>window.__PP_SSE_PROGRESS_V1__?.state);',
 '  console.log("SSE_FIRST_REAL_WORKER_EVENT",JSON.stringify(initialSse));',
 ' }catch(e){',
 '  const state=await page.evaluate(()=>window.__PP_SSE_PROGRESS_V1__?.state||null);',
 '  throw Error("SSE_INITIAL_CONNECTION_NOT_ESTABLISHED_"+JSON.stringify({state,startResponses,streamResponses,postRequests:requests.length,sseRequests:sseRequests.length}));',
 ' }',
 ' let lostLine=0,interimMax=0,previewSamples=0,progressDuringRun=0;',
 ' const epochs=Date.now();'
 ].join("\n"),"first_real_event_before_QA_loop");
const oldState='nativeSmoothTarget:window.__PP_TRUTHFUL_SMOOTH_GA_PERCENT_V1__?.confirmedTarget,shed:window.__PP_GA_PROGRESS_LOAD_SHED_V1__?.state,v4:window.__PP_GA_PROGRESS_V4__?.state';
one(oldState,'sse:window.__PP_SSE_PROGRESS_V1__?.state',"status_bind");
between(
 '   progressState={phase:pageState?.v4?.finalDone?',
 '   lastProgress=progressState;',
 [
 '   progressState={phase:pageState?.sse?.completed?"completed":pageState?.backendPhase,',
 '    running:pageState?.sse?.active,percent:pageState?.sse?.percent,',
 '    busy:pageState?.sse?.active,bars:pageState?.bars,',
 '    visual100:pageState?.sse?.completed,',
 '    networkFailures:progressNetworkFailures.length,httpErrors:progressHttpErrors.length};'
 ],"progress_status");
between(
 '   if(pageState?.v4?.confirmed<=1&&pageState?.v4?.firstStage){',
 '    console.log("GA_LOAD_SHED_REAL_BROWSER_SAMPLE"',
 [
 '   if(pageState?.sse?.active){',
 '    progressDuringRun++;',
 '    if(!pageState.sse.lineVisible)lostLine++;',
 '    if(pageState.sse.previews>0){',
 '     previewSamples++;',
 '     interimMax=Math.max(interimMax,pageState.bars||0);',
 '    }',
 '   }',
 '   if(pageState?.sse?.completed&&pageState?.sse?.percent!==100)',
 '    throw Error("SSE_100_NOT_VISIBLE_"+JSON.stringify(pageState.sse));'
 ],"no_old_smoothing_guard");
one('   if(pageState?.v4?.finalDone)break;','   if(pageState?.sse?.completed)break;',"done_loop");
between(
 ' const built=firstStageResponseHeaders.filter',
 ' const persisted=await ctx.request.get',
 [
 ' const sse=await page.evaluate(()=>window.__PP_SSE_PROGRESS_V1__?.state||null);',
 ' console.log("SSE_LIVE_PROGRESS_AND_PREVIEW_SUMMARY",JSON.stringify({sse,',
 '  lostLine,interimMax,previewSamples,progressDuringRun,',
 '  progressRequests:progressRequests.length,sseRequests:sseRequests.length}));',
 ' if(!sse?.completed||sse.percent!==100||!sse.lineVisible||sse.events<2)',
 '  throw Error("SSE_REAL_WORKER_PERCENT_NOT_DONE_"+JSON.stringify(sse));',
 ' if(sse.paceMs!==250||(sse.terminalGap>=15&&',
 '     sse.terminalElapsedMs < (sse.terminalGap-1)*200))',
 '  throw Error("SSE_TERMINAL_PERCENT_BURST_REGRESSION_"+JSON.stringify(sse));',
 ' if(!sse.kpiUpdates||!sse.lastKpiMetrics||',
 '    !["duration_minutes","batch_count","operator_wait_minutes","machine_idle_minutes"]',
 '    .every(k=>Number.isFinite(Number(sse.lastKpiMetrics[k]))))',
 '  throw Error("SSE_REAL_PREVIEW_KPIS_NOT_REFRESHED_"+JSON.stringify(sse));',
 ' if(interimMax>140||lostLine>0||!sseRequests.length)',
 '  throw Error("SSE_INTERIM_BARS_OR_LINE_INVALID_"+JSON.stringify({interimMax,lostLine,sseRequests}));',
 ' if(sse.previews<1||sse.previewRows!==14||',
 '    sse.previewJobCount+sse.previewSetupCount>140)',
 '  throw Error("SSE_INTERIM_FIRST_TEN_OPERATIONS_PER_ROW_INVALID_"+JSON.stringify(sse));',
 ' if(sse.previewSetupCount<1)',
 '  throw Error("SSE_REAL_DEMO_CHANGEOVER_MISSING_IN_INTERIM_GANTT_"+JSON.stringify(sse));',
 ' console.log("SSE_REAL_FIRST_TEN_OPS_INCLUDING_SETUPS_SAMPLE",JSON.stringify({',
 '  rows:sse.previewRows,jobs:sse.previewJobCount,setups:sse.previewSetupCount}));',
 ' const periodicRequests=progressRequests.filter(t=>t>=epochs&&t<Date.now()-10000);',
 ' if(sse.networkFinalGets!==1||periodicRequests.length||progressRequests.length>9)',
 '  throw Error("SSE_BROWSER_IS_STILL_POLLING_"+JSON.stringify({progressRequests,periodicRequests,sse}));',
 ' if(errors.length)throw Error("SSE_BROWSER_ERRORS_"+JSON.stringify(errors.slice(0,4)));'
 ],"sse_acceptance");
between(
 ' await page.waitForTimeout(6200);',
 ' console.log("CERAMIC_DURABLE_PLAN_VERIFIED"',
 [
 ' await page.waitForTimeout(700);',
 ' const held=await page.evaluate(()=>({sse:window.__PP_SSE_PROGRESS_V1__?.state,',
 '   text:document.querySelector("#opt .pp-sse-label")?.textContent,',
 '   buttonDisabled:document.getElementById("opt")?.disabled}));',
 ' if(!held.sse?.completed||held.text!=="Continue · 100%"||held.buttonDisabled)',
 '  throw Error("SSE_FULL_PLAN_BUTTON_NOT_READY_"+JSON.stringify(held));',
 ' console.log("SSE_VISIBLE_FULL_100_VERIFIED",JSON.stringify(held));'
 ],"full_plan");
between(' await page.waitForFunction(()=>window.__PP_GA_PROGRESS_V4__',
 ' const secondResponse=await ctx.request.get',[
 ' await page.waitForFunction(()=>window.__PP_SSE_PROGRESS_V1__?.state?.completed===true&&',
 '   window.__PP_SSE_PROGRESS_V1__?.state?.percent===100,null,{timeout:175000,polling:700});'
 ],"second_100");
one('  v4:window.__PP_GA_PROGRESS_V4__?.state,\n  text:document.getElementById("opt")?.getAttribute("data-pp-ga-v4-label"),',
 '   sse:window.__PP_SSE_PROGRESS_V1__?.state,\n   text:document.querySelector("#opt .pp-sse-label")?.textContent,',
 "second_state");
one('     !secondUi.v4?.finalDone||!secondUi.text?.includes("100%")||',
 '     !secondUi.sse?.completed||secondUi.text!=="Continue · 100%"||',"second_ui_assert");
writeFileSync("ops/ovh/sse-stream-v1-20261120/_live-qa.mjs",s);
console.log("SSE_REAL_TWO_RUN_886_OP_QA_GENERATED",s.length);
