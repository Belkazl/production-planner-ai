import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=process.argv[2]; if(!root)throw Error('GA_START_FAST_RETRY_ROOT_REQUIRED');
execFileSync(process.execPath,['ops/ovh/ga-start-recover-20261119/patch.mjs',root],{stdio:'inherit'});
const file=resolve(root,'async-plan-transport.js');
let text=readFileSync(file,'utf8');
const once=(a,b)=>{if(text.split(a).length!==2)throw Error('FAST_RETRY_ANCHOR_DRIFT_'+a.slice(0,45));text=text.replace(a,b)};
once('async function progressOnce(){','async function progressOnce(signal){');
once('headers:{accept:"application/json"}});','headers:{accept:"application/json"},signal});');
once('prior=await progressOnce();','prior=await progressOnce(AbortSignal.timeout(3200));');
const from='   // On any uncertain start response, first probe the existing job.';
const to='   if(!retryableStatus(lastStatus)&&lastStatus!==409)return {status:lastStatus,data:lastData};';
const i=text.indexOf(from),j=text.indexOf(to,i);
if(i<0||j<=i||text.split(from).length!==2||text.split(to).length!==2)throw Error('FAST_RETRY_PROBE_REGION_DRIFT');
const updated=`   // A 502 can mean the first request was accepted. Check the account once,
   // with a hard timeout, before replaying the EXACT same request. The worker
   // rejects parallel active jobs, and an async replay joins that same job.
   abortIfStopped();
   await sleep(350);
   try{
    const cur=await progressOnce(AbortSignal.timeout(2500));
    if(cur.r.ok&&cur.data?.running){
     startTelemetry.recoveries++;
     startTelemetry.lastRecovery="joined_existing_job";
     return waitForPlan(signal);
    }
   }catch(e){if(signal?.aborted)throw e}
`;
text=text.slice(0,i)+updated+text.slice(j);
once('await sleep((attempt+1)*600);','await sleep(850+attempt*650);');
if(text.includes('for(let probe=0;probe<3;probe++)')||!text.includes('AbortSignal.timeout(2500)')||!text.includes('joined_existing_job'))throw Error('FAST_RETRY_GUARD');
writeFileSync(file,text);
console.log('GA_NATIVE_FAST_502_RETRY_READY',JSON.stringify({sha:createHash('sha256').update(text).digest('hex'),bytes:text.length}));
