import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

const script=readFileSync('stop-ui.js','utf8');
const best={
 ok:true,valid:true,partial:false,duration_minutes:4389,
 machine_idle_minutes:16815,operator_wait_minutes:413071,batch_count:118,
 operations:[{operation_id:'synthetic-1',order:'QA-1',start_min:0,end_min:60,equipment_ids:['EQ1']}]
};
const wait=ms=>new Promise(done=>setTimeout(done,ms));
function createFixture({stopStatus=200,ack=true,hasPlan=true}={}){
 const dom=new JSDOM('<!doctype html><html><head></head><body><button id="opt">Start optimization</button><span id="valid">GA ready</span><div id="validator"></div><div id="planView"><button data-mode="best">Best found</button><button data-mode="candidate">Candidate</button></div><span id="ppOptimizerCandidateStatus"></span></body></html>',{
  url:'https://app.liftorbit.app/',runScripts:'outside-only',pretendToBeVisual:true
 });
 const w=dom.window;
 w.Response=Response;
 let stopCalls=0,progressCalls=0, originalDone, originalLateFail=false, renders=0;
 w.renderPlan=()=>{renders++};
 w.renderKpisWithDelta=()=>{};
 const opt=w.document.getElementById('opt');
 opt.onclick=async ()=>{
  opt.disabled=true;opt.textContent='Optimization 19%';
  await new Promise(done=>{originalDone=done});
  if(originalLateFail){
   w.document.getElementById('valid').textContent='GA error';
   w.document.getElementById('validator').textContent='optimization_stopped';
  }
  opt.disabled=false;
 };
 w.fetch=async(input)=>{
  const url=String(input);
  if(url.includes('/api/optimizer-stop')){
   stopCalls++;
   const data=ack
    ?{ok:true,stopped:true,best_preview:hasPlan?best:null,
       variants:hasPlan?[{plan:best}]:[]}
    :{ok:false,error:'optimization_not_running'};
   return new Response(JSON.stringify(data),{
    status:stopStatus,headers:{'content-type':'application/json'}});
  }
  if(url.includes('/api/plan-progress')){
   progressCalls++;
   const data={ok:true,running:!stopCalls,phase:stopCalls?'cancelled':'running',
     best_preview:hasPlan?best:null,candidate_preview:hasPlan?best:null};
   return new Response(JSON.stringify(data),{
    status:200,headers:{'content-type':'application/json'}});
  }
  throw Error('Unexpected API route in stop test: '+url);
 };
 w.eval(script);
 return {
  w,opt,dom,best,
  get stop(){return w.document.getElementById('ppStopOptimizer')},
  get badge(){return w.document.getElementById('valid').textContent},
  get note(){return w.document.getElementById('validator').textContent},
  get debug(){return w.__PP_STOP_DEBUG__()},
  get renders(){return renders},
  get stopCalls(){return stopCalls},
  get progressCalls(){return progressCalls},
  completeOriginalWithLateError(){originalLateFail=true;originalDone()},
  close(){dom.window.close()}
 };
}

test('confirmed stop survives delayed optimization_stopped error and allows choosing best plan',async()=>{
 const q=createFixture();
 try{
  q.opt.click();
  assert.equal(q.debug.running,true);
  assert.equal(q.stop.disabled,false,'Stop available before first preview');
  assert.equal(q.stop.classList.contains('pp-on'),true);
  await q.stop.onclick();
  assert.equal(q.stopCalls,1);
  assert.equal(q.debug.running,false);
  assert.equal(q.stop.classList.contains('pp-on'),false);
  q.completeOriginalWithLateError();
  await wait(550);
  assert.match(q.badge,/остановлено/);
  assert.doesNotMatch(q.badge,/GA error/);
  assert.doesNotMatch(q.note,/optimization_stopped/);
  assert.equal(q.opt.disabled,false);
  assert.equal(q.w.document.querySelector('#ppStopModal.pp-open')!==null,true,
    'found plans selection must remain visible');
  q.w.document.querySelector('#ppStopModal.pp-open .pp-actions button').click();
  assert.equal(q.w.__ppOptimizerCommittedPlan.duration_minutes,4389);
  assert.equal(q.renders>0,true);
  assert.equal(q.opt.textContent,'Продолжить оптимизацию');
  console.log('STOP_CONFIRMED_LATE_GA_ERROR_RECOVERED');
 }finally{q.close()}
});

test('HTTP409 after already-cancelled worker is confirmed via scoped progress and unlocks UI',async()=>{
 const q=createFixture({stopStatus:409,ack:false,hasPlan:true});
 try{
  q.opt.click();
  assert.equal(q.debug.running,true);
  await q.stop.onclick();
  assert.equal(q.stopCalls,1);
  assert.equal(q.progressCalls>0,true);
  assert.equal(q.debug.running,false);
  assert.equal(q.stop.classList.contains('pp-on'),false);
  q.completeOriginalWithLateError();
  await wait(550);
  assert.match(q.badge,/остановлено/);
  assert.doesNotMatch(q.note,/optimization_stopped/);
  assert.equal(q.opt.disabled,false);
  console.log('STOP_409_ALREADY_CANCELLED_RECONCILED');
 }finally{q.close()}
});

test('Stop stays enabled before first candidate and does not require a plan',async()=>{
 const q=createFixture({hasPlan:false});
 try{
  q.opt.click();
  assert.equal(q.stop.disabled,false);
  await q.stop.onclick();
  assert.equal(q.debug.running,false);
  assert.equal(q.stop.classList.contains('pp-on'),false);
  assert.equal(q.opt.disabled,false);
  assert.equal(q.w.document.querySelector('#ppStopModal.pp-open'),null);
  assert.equal(q.stopCalls,1);
  console.log('STOP_WITHOUT_CANDIDATES_ACCEPTED');
 }finally{q.close()}
});
