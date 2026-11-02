// CPU-intensive setup-aware scheduling runs in an isolated Bun OS process per task.
// This module does NOT replace the upstream Python GA; it isolates the local search.
const PP_WORKER_CAP=Math.max(1,Math.min(8,Number(Bun.env.PP_WORKER_LIMIT||4)||4));
const PP_WORKER_TIMEOUT_MS=Math.max(5000,Math.min(180000,Number(Bun.env.PP_WORKER_TIMEOUT_MS||90000)||90000));
const PP_WORKER_MAX_BYTES=4_000_000;
const ppQueue=[];
let ppSlots=0;
export const ppWorkerMetrics={started:0,finished:0,cancelled:0,failed:0,timedOut:0,active:0,peak:0,pids:[]};
function ppWorkerAbortError(){const error=new Error("worker_cancelled");error.name="AbortError";return error;}
async function ppTakeSlot(signal){
 if(signal?.aborted)throw ppWorkerAbortError();
 if(ppSlots<PP_WORKER_CAP&&ppQueue.length===0){ppSlots++;return;}
 return new Promise((resolve,reject)=>{
  const entry={resolve,reject,signal,onAbort:null};
  entry.onAbort=()=>{const i=ppQueue.indexOf(entry);if(i!==-1)ppQueue.splice(i,1);reject(ppWorkerAbortError());};
  if(signal)signal.addEventListener("abort",entry.onAbort,{once:true});
  ppQueue.push(entry);
  if(signal?.aborted)entry.onAbort();
 });
}
function ppReleaseSlot(){
 ppSlots=Math.max(0,ppSlots-1);
 while(ppQueue.length){
  const item=ppQueue.shift();
  item.signal?.removeEventListener("abort",item.onAbort);
  if(item.signal?.aborted){item.reject(ppWorkerAbortError());continue;}
  ppSlots++;item.resolve();break;
 }
}
export function ppWorkerSummary(){
 return {...ppWorkerMetrics,queued:ppQueue.length,limit:PP_WORKER_CAP,activePids:ppWorkerMetrics.pids.slice(-12)};
}
export async function runIsolatedSetupSearch(base,model,options={},signal){
 let slot=false,child=null,timeout=null,abortListener=null,cancelled=false,timedOut=false;
 const began=performance.now();
 try{
  await ppTakeSlot(signal);slot=true;
  if(signal?.aborted)throw ppWorkerAbortError();
  const data={kind:"setup_search",base,model,options:{
   iterations:options.iterations||48,seed:options.seed||1729,objective:options.objective||"duration",
   ...(Bun.env.PP_WORKER_TEST==="1"&&options.testHoldMs?{testHoldMs:options.testHoldMs}:{})
  }};
  const raw=JSON.stringify(data);
  if(raw.length>PP_WORKER_MAX_BYTES)throw Error("worker_payload_exceeds_limit");
  child=Bun.spawn({
   cmd:[process.execPath,"run","ga-worker-core.ts"],
   cwd:process.cwd(),stdin:"pipe",stdout:"pipe",stderr:"pipe",
   env:{PATH:process.env.PATH||"/usr/local/bin:/usr/bin:/bin",HOME:process.env.HOME||"/tmp",PP_WORKER_TEST:Bun.env.PP_WORKER_TEST==="1"?"1":"0"}
  });
  ppWorkerMetrics.started++;ppWorkerMetrics.active++;
  ppWorkerMetrics.peak=Math.max(ppWorkerMetrics.active,ppWorkerMetrics.peak);
  ppWorkerMetrics.pids.push(child.pid);
  if(ppWorkerMetrics.pids.length>32)ppWorkerMetrics.pids.shift();
  abortListener=()=>{cancelled=true;try{child?.kill("SIGKILL")}catch{}};
  if(signal)signal.addEventListener("abort",abortListener,{once:true});
  if(signal?.aborted)abortListener();
  timeout=setTimeout(()=>{timedOut=true;try{child?.kill("SIGKILL")}catch{}},PP_WORKER_TIMEOUT_MS);
  const outPromise=new Response(child.stdout).text();
  const errPromise=new Response(child.stderr).text();
  const stdin=child.stdin;
  await stdin.write(raw);
  await stdin.end();
  const [exitCode,out,err]=await Promise.all([child.exited,outPromise,errPromise]);
  if(cancelled||signal?.aborted)throw ppWorkerAbortError();
  if(timedOut)throw Error("worker_timeout");
  if(exitCode!==0)throw Error("worker_exit_"+exitCode+":"+err.slice(0,320));
  if(out.length>10_000_000)throw Error("worker_result_exceeds_limit");
  const parsed=JSON.parse(out);
  if(!parsed.ok||!parsed.result?.best_preview?.operations?.length)throw Error("worker_invalid_plan_result");
  ppWorkerMetrics.finished++;
  console.log("PP_ISOLATED_SETUP_DONE",JSON.stringify({pid:parsed.pid,elapsedMs:Math.round(performance.now()-began),iterations:parsed.result.iterations,active:ppWorkerMetrics.active}));
  return parsed.result;
 }catch(error){
  if(error?.name==="AbortError"||cancelled||signal?.aborted)ppWorkerMetrics.cancelled++;
  else if(timedOut)ppWorkerMetrics.timedOut++;
  else ppWorkerMetrics.failed++;
  if(child)try{child.kill("SIGKILL")}catch{}
  throw error;
 }finally{
  if(timeout!==null)clearTimeout(timeout);
  if(signal&&abortListener)signal.removeEventListener("abort",abortListener);
  if(child)ppWorkerMetrics.active=Math.max(0,ppWorkerMetrics.active-1);
  if(slot)ppReleaseSlot();
 }
}
