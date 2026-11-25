import {chromium} from 'playwright-core';
import {randomUUID,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1600,height:1000}});
let phase='init';
const requests=[],responses=[],errors=[];
const safePhase=v=>['queued','loading_runtime','validating_model','installing_model','building_first_plan','optimizing','finalizing','completed','cancelled','failed','timed_out','invalid','stale','interrupted','idle'].includes(v)?v:null;
const path=url=>new URL(url).pathname;
page.on('pageerror',e=>errors.push(e.name||'Error'));
page.on('request',r=>{if(r.method()==='POST'&&['/api/optimizer-reset','/api/plan','/api/plan-stop','/api/stop'].includes(path(r.url())))requests.push(path(r.url()))});
page.on('response',async r=>{const p=path(r.url());if(r.request().method()!=='POST'||!['/api/optimizer-reset','/api/plan','/api/plan-stop','/api/stop'].includes(p))return;responses.push([p,r.status()])});
const api=(p,method='GET',data)=>page.evaluate(async({p,method,data})=>{const r=await fetch(p,{method,cache:'no-store',headers:{'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,body:await r.json().catch(()=>null)}},{p,method,data});
const state=()=>page.evaluate(()=>{
 const b=document.getElementById('ppOptimizerStartOver'),o=document.getElementById('opt'),s=window.__PP_STOP_DEBUG__?.()||{},f=window.__PP_FRESH_OPTIMIZER_DEBUG__?.()||{};
 return {restartExists:!!b,restartDisabled:!!b?.disabled,optDisabled:!!o?.disabled,running:!!s.running,stopped:!!s.stopped,reconnecting:!!s.reconnecting,resetting:!!f.resetting,pending:!!f.pending,freshMode:!!f.freshMode,flight:!!window.__ppOptimizationInFlight,hasOnclick:typeof b?.onclick==='function',primaryOnclick:typeof o?.onclick==='function',modelReady:typeof modelReady!=='undefined'&&!!modelReady,hasResult:typeof hasResult!=='undefined'&&!!hasResult,busy:typeof busy!=='undefined'&&!!busy,bars:document.querySelectorAll('.pg2-bar').length,primaryText:(o?.textContent||'').replace(/\s+/g,' ').trim().slice(0,60),pointer:b?document.elementFromPoint(b.getBoundingClientRect().x+b.offsetWidth/2,b.getBoundingClientRect().y+b.offsetHeight/2)===b:false};
});
async function report(label){
 let status=await api('/api/plan-progress?ppNoCache=1');let b=status.body||{};
 console.log('RESTART_DIAG '+label+' '+JSON.stringify({ui:await state(),server:{http:status.status,running:!!b.running,success:!!b.success,phase:safePhase(b.phase),percent:typeof b.percent==='number'?b.percent:null,job:typeof b.job_id==='string'?b.job_id.slice(0,8):null,error:typeof b.error==='string'?b.error.slice(0,70):null},requests,responses,errors:errors.slice(-5)}));
 return b;
}
async function clickFresh(label){
 phase=label;
 const before=await report(label+'_before');
 const n=requests.length;
 await page.locator('#ppOptimizerStartOver').click({timeout:10000,noWaitAfter:true});
 let last=null;
 for(let i=0;i<30;i++){
  await page.waitForTimeout(1000);
  last=await report(label+'_'+i);
  if(last.success&&last.result&&last.job_id!==before.job_id&&!last.running){
   await page.waitForFunction(()=>window.__PP_STOP_DEBUG__?.().running===false&&document.getElementById('ppOptimizerStartOver')?.disabled===false,null,{timeout:15000});
   assert(requests.slice(n).filter(x=>x==='/api/optimizer-reset').length===1);
   assert(requests.slice(n).filter(x=>x==='/api/plan').length===1);
   return last;
  }
  if(i>=5&&requests.length===n)throw Error('no_reset_request');
  if(i>=8&&last.phase==='cancelled'&&last.job_id===before.job_id&&requests.slice(n).includes('/api/plan'))throw Error('stale_terminal_job');
  if(['failed','invalid','timed_out'].includes(last.phase)&&last.job_id!==before.job_id)throw Error('worker_failed');
 }
 throw Error('no_new_completed_job');
}
try{
 await page.goto('https://app.liftorbit.app/',{waitUntil:'domcontentloaded',timeout:45000});
 const email='restart-qa-'+randomUUID().replaceAll('-','')+'@liftorbit.invalid',password=randomBytes(24).toString('base64url');
 assert.equal((await api('/api/auth/register','POST',{email,password,company:'Restart isolated QA'})).status,200);
 await page.reload({waitUntil:'domcontentloaded',timeout:45000});
 const id='prj_restart_'+randomUUID().replaceAll('-','').slice(0,13);
 const model={scheduler_mode:'resource',start:'2026-11-25T08:00:00',quantity_unit:'шт.',orders:Array.from({length:3},(_,i)=>({id:'O'+i,quantity:400+i*20,unit:'шт.',technical_process_id:'TP'})),equipment:[{id:'M',name:'Invented workstation',kind:'workstation',capacity:200,capacity_unit:'шт.',timing_profile:{timing_mode:'throughput',throughput_per_hour:60}}],employees:[{id:'E',name:'Invented operator',role:'operator',shift:'day'}],shifts:{day:[['08:00','12:00'],['13:00','17:00']]},materials:[],setup_rules:[],technical_processes:[{id:'TP',name:'Invented process',operations:[{id:'OP',name:'Invented work',sequence:1,duration_min:1,resource_requirements:[{resource_type:'equipment',resource_ref:'M',resource_refs:['M'],match_mode:'specific',quantity:1,unit:'шт.',consumption_rule:'during_operation'},{resource_type:'employee',resource_ref:'E',resource_refs:['E'],match_mode:'specific',quantity:1,unit:'чел.',consumption_rule:'during_operation'}]}]}]};
 const projects=JSON.stringify([{id,name:'Restart QA',model,revision:1}]);
 assert.equal((await api('/api/db-storage','POST',{storage:{'prodplan.projects.v2':projects,'prodplan.project.active.v2':id}})).status,200);
 await page.reload({waitUntil:'domcontentloaded',timeout:45000});
 await page.waitForFunction(()=>!!document.getElementById('ppOptimizerStartOver')&&window.__PP_STOP_DEBUG__?.().reconnecting===false,null,{timeout:30000});
 await page.locator('#ppOptimizerDepthSelect').selectOption('quick');
 const first=await clickFresh('first');
 const second=await clickFresh('second');
 assert.notEqual(first.job_id,second.job_id);
 phase='after_reload';
 await page.reload({waitUntil:'domcontentloaded',timeout:45000});
 await page.waitForFunction(()=>!!document.getElementById('ppOptimizerStartOver')&&window.__PP_STOP_DEBUG__?.().reconnecting===false,null,{timeout:30000});
 const third=await clickFresh('third_reload');
 assert.notEqual(second.job_id,third.job_id);
 console.log('RESTART_REAL_BUTTON_THREE_RUNS_PASS');
}catch(e){console.log('RESTART_DIAGNOSTIC_FAILED '+phase+' '+String(e?.message||e).split('\n')[0].slice(0,200));try{await report('failure')}catch{}process.exitCode=6}
finally{await browser.close()}
