import {readFileSync,writeFileSync} from 'node:fs';
const p='ops/ovh/ga-start-recover-20261119/live-regression.mjs';
const src=readFileSync(p,'utf8');
const start=' // Full second optimization on the SAME large-model account.';
const stop=' if(errors.length)throw Error("BROWSER_ERRORS_"';
if(src.split(start).length!==2||src.split(stop).length!==2)throw Error('HEADER_COMPARE_BASELINE_DRIFT');
const a=src.indexOf(start),b=src.indexOf(stop,a);
if(a<0||b<=a)throw Error('HEADER_COMPARE_ANCHOR_ORDER');
const fragment=String.raw`
 // Comparison only on a disposable 886-operation model / isolated account.
 const previous=await (await ctx.request.get(base+'/api/plan-progress?ppNoCache=1',{timeout:30000})).json();
 if(previous.phase!=='completed'||previous.result?.operations?.length<800)throw Error('FIRST_NOT_COMPLETED');
 const initialJob=previous.job_id;
 let originalNativeRaw=null;
 const sent=[],answers=[],failed=[];
 page.on('response',async response=>{
  try{
   if(new URL(response.url()).pathname==='/api/plan'&&response.request().method()==='POST'){
    const raw=await response.text();
    let body={};try{body=JSON.parse(raw)}catch{}
    answers.push({status:response.status(),contentType:response.headers()['content-type']||'',bytes:raw.length,started:body.started===true,job:body.job_id?.slice(0,8)||null,error:body.error||null});
    console.log('POST_NETWORK_ANSWER',JSON.stringify(answers.at(-1)));
   }
  }catch(e){console.log('ANSWER_READ_ERROR',String(e).slice(0,130))}
 });
 page.on('requestfailed',r=>{
  if(new URL(r.url()).pathname==='/api/plan'&&r.method()==='POST'){
   failed.push(String(r.failure()||'unknown'));
   console.log('POST_REQUEST_FAILED',String(r.failure()||'unknown').slice(0,130));
  }
 });
 await page.route('**/api/plan',async route=>{
  const req=route.request();
  if(req.method()!=='POST')return route.continue();
  const h=req.headers(), raw=req.postData()||'{}';
  const safe={index:sent.length+1,bytes:Buffer.byteLength(raw),url:new URL(req.url()).pathname,
    keys:Object.keys(JSON.parse(raw)).sort(),
    headers:{accept:h.accept||null,contentType:h['content-type']||null,origin:h.origin||null,
      referer:h.referer?.replace(/[?#].*$/,'')||null,fetchMode:h['sec-fetch-mode']||null,
      fetchSite:h['sec-fetch-site']||null,cacheControl:h['cache-control']||null,
      contentLength:h['content-length']||null,requestedWith:h['x-requested-with']||null,
      names:Object.keys(h).filter(k=>!/(cookie|auth|token|key)/i.test(k)).sort()}};
  sent.push(safe);
  if(originalNativeRaw===null)originalNativeRaw=raw;
  console.log('POST_REQUEST_SAFE',JSON.stringify(safe));
  return route.continue();
 });
 const nativeGate=await page.evaluate(()=>({disabled:document.getElementById('opt')?.disabled,
  title:document.getElementById('opt')?.textContent}));
 if(nativeGate.disabled||!/continue|продолж/i.test(nativeGate.title||''))throw Error('CONTINUE_NOT_CLICKABLE_'+JSON.stringify(nativeGate));
 await page.locator('#opt').click({timeout:12000,noWaitAfter:true});
 for(let i=0;i<20&&!answers.length&&!failed.length;i++)await page.waitForTimeout(1000);
 if(!sent.length)throw Error('NO_NATIVE_POST');
 if(!answers.length&&!failed.length)throw Error('NATIVE_NO_HTTP_RESPONSE_AFTER_20S');
 const afterNative=await (await ctx.request.get(base+'/api/plan-progress?ppNoCache=1',{timeout:25000})).json();
 const native={answer:answers[0]||null,failed,phase:afterNative.phase,running:afterNative.running,
  newJob:!!afterNative.job_id&&afterNative.job_id!==initialJob,
  percent:afterNative.percent};
 console.log('NATIVE_RESULT',JSON.stringify(native));
 if(native.answer?.status===202&&native.newJob){
  console.log('NATIVE_DIRECT_COMPARE_NOT_NEEDED_202_ALREADY_RUNNING');
 }else if(native.answer?.status>=500&&!native.newJob&&!afterNative.running){
  console.log('DIRECT_EXACT_REPLAY_BEGIN',JSON.stringify({bytes:Buffer.byteLength(originalNativeRaw)}));
  const direct=await page.evaluate(async raw=>{
    const res=await fetch('/api/plan',{method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'content-type':'application/json','accept':'application/json'},body:raw});
    const text=await res.text();let body={};try{body=JSON.parse(text)}catch{}
    return {status:res.status,bytes:text.length,contentType:res.headers.get('content-type'),
      started:body.started===true,job:body.job_id?.slice(0,8)||null,error:body.error||null};
  },originalNativeRaw);
  console.log('DIRECT_EXACT_REPLAY_ANSWER',JSON.stringify(direct));
  const postDirect=await (await ctx.request.get(base+'/api/plan-progress?ppNoCache=1',{timeout:25000})).json();
  console.log('DIRECT_EXACT_REPLAY_STATE',JSON.stringify({phase:postDirect.phase,running:postDirect.running,
    percent:postDirect.percent,newJob:!!postDirect.job_id&&postDirect.job_id!==initialJob}));
  if(direct.status!==202||direct.started!==true||!postDirect.job_id||postDirect.job_id===initialJob)
    throw Error('DIRECT_REPLAY_FAILED_'+JSON.stringify({direct,phase:postDirect.phase}));
  console.log('NATIVE_5XX_DIRECT_SAME_BODY_202_CONFIRMED');
 }else{
  console.log('NATIVE_UNEXPECTED_STATE',JSON.stringify(native));
  throw Error('NATIVE_UNEXPECTED_STATE');
 }
`;
const out=src.slice(0,a)+fragment+src.slice(b);
const file='ops/ovh/ga-post502-isolation-20261119/_native-header-compare.mjs';
writeFileSync(file,out);
console.log('NATIVE_COMPARE_SCRIPT_READY',out.length);
