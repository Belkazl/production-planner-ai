import {readFileSync,writeFileSync} from "node:fs";
let s=readFileSync("ops/ovh/ga-start-recover-20261119/live-regression.mjs","utf8");
const deployedGuard=[
 ' if(process.env.FREEZE_TEST_MODE==="deployed"){',
 '  const single=await page.evaluate(()=>window.__PP_SINGLE_GA_PROGRESS_RENDERER_V1__);',
 '  if(!single?.installed||!single.legacyObserverStopped)throw Error("DEPLOYED_SINGLE_PROGRESS_MISSING");',
 '  console.log("LIVE_FREEZE_DEPLOYED_SINGLE_PROGRESS",JSON.stringify(single));',
 ' }'
].join("\n");
const v5Guard=[
 ' if(process.env.FREEZE_TEST_MODE==="deployed"){',
 '  const single=await page.evaluate(()=>window.__PP_GA_PROGRESS_V5__?.installed);',
 '  if(single!==true)throw Error("DEPLOYED_V5_SINGLE_PROGRESS_MISSING");',
 '  console.log("LIVE_FREEZE_DEPLOYED_V5_SINGLE_PROGRESS",single);',
 ' }'
].join("\n");
const one=(a,b,n)=>{
 if(s.split(a).length!==2)throw Error("V5_QA_ANCHOR_"+n+"_"+(s.split(a).length-1));
 s=s.replace(a,b);
};
const between=(a,b,lines,n)=>{
 const i=s.indexOf(a),j=s.indexOf(b,i);
 if(i<0||j<=i||s.indexOf(a,i+1)>=0)throw Error("V5_QA_RANGE_"+n);
 s=s.slice(0,i)+lines.join("\n")+"\n"+s.slice(j);
};
one(deployedGuard,v5Guard,"deployed_guard");
between(
 " const guard=await page.evaluate(()=>({v4:window.__PP_GA_PROGRESS_V4__?.installed===true",
 " let suppressedUiProgressRequests=0;",
 [
 ' const guard=await page.evaluate(()=>({',
 '  v5:window.__PP_GA_PROGRESS_V5__?.installed===true,',
 '  light:window.__PP_FOUR_SECOND_PREVIEW__?.version===2,',
 '  old:!!window.__PP_TRUTHFUL_SMOOTH_GA_PERCENT_V1__?.installed,',
 '  nativeStatus:!!window.__PP_STOP_DEBUG__',
 ' }));',
 ' if(!guard.v5||!guard.light||guard.old)',
 '  throw Error("V5_EXCLUSIVE_GA_PROGRESS_MISSING_"+JSON.stringify(guard));',
 ' console.log("GA_V5_LIVE_GUARDS",JSON.stringify(guard));'
 ],"guards");
one(" const epochs=Date.now();",
 " let interimDetailsChecked=false,interimMax=0,lineLost=0,previewPaintMax=0;\n const epochs=Date.now();",
 "metrics");
one("nativeSmoothTarget:window.__PP_TRUTHFUL_SMOOTH_GA_PERCENT_V1__?.confirmedTarget,shed:window.__PP_GA_PROGRESS_LOAD_SHED_V1__?.state,v4:window.__PP_GA_PROGRESS_V4__?.state",
 "v5:window.__PP_GA_PROGRESS_V5__?.state,preview:window.__PP_FOUR_SECOND_PREVIEW__?.state,v4:window.__PP_GA_PROGRESS_V4__?.state",
 "sample");
between(
 "  // An underlying native Continue label is allowed ONLY when the CSS owner",
 '    console.log("GA_LOAD_SHED_REAL_BROWSER_SAMPLE"',
 [
 '  if(pageState?.v5?.running&&pageState.v5.lineVisible!==true)lineLost++;',
 '  if(pageState?.v5?.running&&pageState?.optimizerRunning===true&&pageState?.preview?.active===true&&pageState?.preview?.previews>0){',
 '   interimMax=Math.max(interimMax,pageState.bars||0);',
 '   previewPaintMax=Math.max(previewPaintMax,pageState.preview.maxPaintMs||0);',
 '   if(!interimDetailsChecked&&pageState?.v5?.interimDialogBlocked){',
 '    const clickCheck=await page.evaluate(()=>{',
 '     const bar=document.querySelector("#ppGanttToolV2 .pg2-bar");',
 '     if(!bar)return null;',
 '     const before=window.__PP_GA_PROGRESS_V5__?.state.suppressedDialogs||0;',
 '     bar.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true}));',
 '     return(window.__PP_GA_PROGRESS_V5__?.state.suppressedDialogs||0)-before;',
 '    });',
 '    if(clickCheck>0)interimDetailsChecked=true;',
 '   }',
 '  }',
 '  if(pageState&&/continue|продолж/i.test(String(pageState.percent||""))&&!pageState.v4?.finalDone){',
 '   await page.waitForTimeout(300);',
 '   const transition=await page.evaluate(()=>window.__PP_GA_PROGRESS_V5__?.state);',
 '   if(transition?.phase!=="idle"&&transition?.phase!=="completed"&&!transition?.lineVisible)',
 '    throw Error("V5_PROGRESS_LINE_LOST_WHILE_COMPLETING_"+JSON.stringify(transition));',
 '  }'
 ],"early_continue");
between(
 " const built=firstStageResponseHeaders.filter",
 " const persisted=await ctx.request.get",
 [
 ' const v5=await page.evaluate(()=>window.__PP_GA_PROGRESS_V5__?.state||null);',
 ' const preview=await page.evaluate(()=>window.__PP_FOUR_SECOND_PREVIEW__?.state||null);',
 ' console.log("GA_V5_LIVE_SUMMARY",JSON.stringify({v5,preview,interimMax,lineLost,interimDetailsChecked,previewPaintMax}));',
 ' if(!v5?.finalDone||!v5?.has100||!v5?.visible?.includes("100%"))',
 '  throw Error("V5_UNVERIFIED_FINAL_100_"+JSON.stringify(v5));',
 ' if(!preview||preview.version!==2||preview.previews<2||preview.activity<4||',
 '    preview.light<8||preview.maxPaintMs>500)',
 '  throw Error("V5_4SECOND_PREVIEW_UNHEALTHY_"+JSON.stringify(preview));',
 ' if(interimMax>140||lineLost>0||!interimDetailsChecked)',
 '  throw Error("V5_INTERIM_DIALOG_OR_LINE_INVALID_"+JSON.stringify({interimMax,lineLost,interimDetailsChecked}));',
 ' if(progressNetworkFailures.length||progressHttpErrors.length)',
 '  throw Error("V5_NETWORK_FAILURES_"+JSON.stringify({progressNetworkFailures,progressHttpErrors}));'
 ],"checks");
const tag='getAttribute("data-pp-ga-v4-label")';
if(s.split(tag).length!==3)throw Error("V5_TWO_BUTTON_LABEL_REFS_EXPECTED");
s=s.replaceAll(tag,'getAttribute("data-pp-ga-v5")');
writeFileSync("ops/ovh/single-progress-v5-20261120/_live-qa.mjs",s);
console.log("V5_TWO_RUN_PRODUCTION_QA_GENERATED",s.length);
