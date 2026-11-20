import {readFileSync,writeFileSync} from "node:fs";
const source="ops/ovh/ga-start-recover-20261119/live-regression.mjs";
let s=readFileSync(source,"utf8");
function replaceOne(a,b,label){
 if(s.split(a).length!==2)throw Error("PROBE_SOURCE_DRIFT_"+label);
 s=s.replace(a,b);
}
replaceOne("const page=await ctx.newPage();",`const page=await ctx.newPage();
const cdp=await ctx.newCDPSession(page);
await cdp.send('Network.enable');
let networkPolls=0;
cdp.on('Network.requestWillBeSent',event=>{
 try{
  const url=new URL(event.request.url);
  if(url.pathname!=='/api/plan-progress')return;
  networkPolls++;
  if(networkPolls>45)return;
  const initiator=event.initiator||{};
  const frames=initiator.stack?.callFrames||initiator.stack?.parent?.callFrames||[];
  console.log('NATIVE_STATUS_NETWORK_INITIATOR',JSON.stringify({
   number:networkPolls,queryKeys:[...url.searchParams.keys()],
   method:event.request.method,trigger:initiator.type,
   stack:frames.slice(0,6).map(x=>({name:x.functionName,script:x.url.split('/').slice(-2).join('/'),
    line:x.lineNumber+1,column:x.columnNumber+1}))
  }));
 }catch(error){console.log('NATIVE_STATUS_TRACE_ERROR',String(error))}
});`,"cdp");
replaceOne('if(!guard.v4||!guard.shed)throw Error("LIVE_ADAPTIVE_GA_PROGRESS_NOT_INSTALLED_"+JSON.stringify(guard));',
 'if(!guard.v4)throw Error("LIVE_ADAPTIVE_GA_PROGRESS_NOT_INSTALLED_"+JSON.stringify(guard));',"compat_guard");
replaceOne("for(let i=0;i<48;i++){","for(let i=0;i<5;i++){","short_run");
replaceOne(" const afterModel=await page.evaluate(async()=>{",
" console.log('NATIVE_STATUS_TRACE_TOTAL',networkPolls);\n throw Error('NETWORK_PROBE_FINISHED');\n const afterModel=await page.evaluate(async()=>{","early_exit");
replaceOne(' console.log("LIVE_FREEZE_FAILED",String(e?.stack||e).slice(0,1000));\n process.exitCode=1;',
 ' if(String(e?.message||e).includes("NETWORK_PROBE_FINISHED")){console.log("NETWORK_PROBE_COMPLETE_WITH_CLEANUP")}else{console.log("LIVE_FREEZE_FAILED",String(e?.stack||e).slice(0,1000));process.exitCode=1;}','completion');
writeFileSync("ops/ovh/sse-stream-v1-20261120/_network-initiator-probe.mjs",s);
console.log("NETWORK_INITIATOR_PROBE_GENERATED",s.length);
