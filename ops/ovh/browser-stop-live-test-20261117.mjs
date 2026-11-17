// Visual/browser regression for real Stop optimization control in production.
// Operates only a disposable account and synthetic equipment, never real users.
import {chromium} from 'playwright';
import {randomUUID,randomBytes} from 'node:crypto';
const BASE='https://app.liftorbit.app';
const rq=(type,ref)=>({resource_type:type,resource_ref:ref,resource_refs:[ref],match_mode:'specific',quantity:1});
const model={
 scheduler_mode:'resource',start:'2026-11-17T08:00:00',
 equipment:Array.from({length:14},(_,i)=>({id:'B_EQ'+i,name:'Synthetic equipment',kind:'workstation',capacity:600,capacity_unit:'m2'})),
 employees:Array.from({length:5},(_,i)=>({id:'B_EM'+i,name:'Synthetic employee',shift:'day'})),
 shifts:{day:[['08:00','12:00'],['13:00','17:00']]},
 orders:Array.from({length:12},(_,i)=>({id:'B_O'+i,quantity:7200,unit:'m2',technical_process_id:'B_TP'})),
 technical_processes:[{id:'B_TP',name:'Synthetic process',operations:Array.from({length:7},(_,i)=>({
   id:'B_OP'+i,name:'Work stage',sequence:i+1,duration_min:30,
   resource_requirements:[rq('equipment','B_EQ'+i),rq('employee','B_EM'+i%5)]
 }))}],materials:[],setup_rules:[]
};
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1760,height:980}});
const errs=[],responses=[],requests=[];
page.on('pageerror',e=>errs.push(String(e).slice(0,180)));
page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')errs.push((m.type()+': '+m.text()).slice(0,170))});
page.on('response',res=>{if(/\/api\/(?:optimizer-stop|plan-progress|plan)(?:\?|$)/.test(res.url()))responses.push({path:new URL(res.url()).pathname,status:res.status(),contentType:(res.headers()['content-type']||'').slice(0,45)})});
page.on('request',req=>{if(/\/api\/optimizer-stop/.test(req.url()))requests.push({method:req.method(),path:new URL(req.url()).pathname})});
const snapshot=()=>page.evaluate(()=>({
 url:location.pathname,stopPresent:!!document.getElementById('ppStopOptimizer'),
 stopVisible:(()=>{const e=document.getElementById('ppStopOptimizer');return !!e&&getComputedStyle(e).display!=='none'})(),
 stopDisabled:document.getElementById('ppStopOptimizer')?.disabled,
 stopText:document.getElementById('ppStopOptimizer')?.textContent,
 primaryDisabled:document.getElementById('opt')?.disabled,
 primaryText:document.getElementById('opt')?.textContent,
 status:document.getElementById('valid')?.textContent?.slice(0,110),
 modalOpen:!!document.querySelector('#ppStopModal.pp-open'),
 debug:window.__PP_STOP_DEBUG__?.(),
 fresh:window.__PP_FRESH_OPTIMIZER_DEBUG__?.()?.pending,
 hasLocalModel:typeof model!=='undefined'&&!!model&&Array.isArray(model.orders)?model.orders.length:null
}));
let started=false,stopped=false;
try{
 await page.goto(BASE,{waitUntil:'domcontentloaded',timeout:60000});
 const email='stop-browser-'+randomUUID().replaceAll('-','')+'@liftorbit.invalid';
 const pass=randomBytes(36).toString('base64url');
 const register=await page.evaluate(async ({email,pass})=>{
   const r=await fetch('/api/auth/register',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:pass,company:'Test stop control only'})});
   return {status:r.status,ok:r.ok};
 },{email,pass});
 if(register.status!==200)throw Error('test_registration_failed_'+register.status);
 const project='test-stop-'+randomUUID().replaceAll('-','');
 const saved=await page.evaluate(async ({project,model})=>{
  const r=await fetch('/api/db-storage',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({storage:{
   'prodplan.projects.v2':JSON.stringify([{id:project,name:'Synthetic stop QA',model}]),
   'prodplan.project.active.v2':project}})});
  return {status:r.status,ok:r.ok};
 },{project,model});
 if(saved.status!==200)throw Error('test_model_storage_failed_'+saved.status);
 await page.goto(BASE,{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForSelector('#opt',{timeout:30000});
 const before=await snapshot();
 console.log('STOP_BROWSER_BEFORE',JSON.stringify(before));
 await page.evaluate(({project,model})=>{
   localStorage.setItem('prodplan.project.active.v2',project);
   localStorage.setItem('prodplan.projects.v2',JSON.stringify([{id:project,name:'Synthetic stop QA',revision:1,model}]));
   try{
     document.body.classList.remove('projects-mode');
     document.getElementById('planView').style.display='block';
     document.getElementById('sectionView').style.display='none';
   }catch{}
   try{window.model=model}catch{}
   try{modelReady=true;hasResult=false;busy=false}catch{}
   const b=document.getElementById('opt');b.disabled=false;b.textContent='Start optimization';
 },{project,model});
 const prepared=await snapshot();
 console.log('STOP_BROWSER_PREPARED',JSON.stringify(prepared));
 const btn=page.locator('#opt');
 await btn.click({force:true,timeout:10000,noWaitAfter:true});
 await page.waitForTimeout(1300);
 const during=await snapshot();
 console.log('STOP_BROWSER_DURING',JSON.stringify(during));
 started=!!during.debug?.running;
 if(!started)throw Error('UI_did_not_start_GA');
 await page.waitForTimeout(3300);
 const afterPoll=await snapshot();
 console.log('STOP_BROWSER_AFTER_POLL',JSON.stringify(afterPoll));
 const stop=page.locator('#ppStopOptimizer');
 await stop.click({force:true,timeout:10000,noWaitAfter:true});
 await page.waitForTimeout(5600);
 const afterClick=await snapshot();
 console.log('STOP_BROWSER_AFTER_CLICK',JSON.stringify(afterClick));
 console.log('STOP_BROWSER_FETCH_REQUESTS',JSON.stringify(requests));
 console.log('STOP_BROWSER_API_RESPONSES',JSON.stringify(responses.slice(-16)));
 console.log('STOP_BROWSER_PAGE_ERRORS',JSON.stringify(errs.slice(-6)));
 stopped=!afterClick.debug?.running && requests.length>0 && responses.some(x=>x.path==='/api/optimizer-stop'&&x.status===200);
 if(!stopped)throw Error('STOP_CLICK_FAILED');
 if(afterClick.modalOpen){
  const choose=page.locator('#ppStopModal.pp-open .pp-actions button').first();
  await choose.click({timeout:5000});
 }
 const final=await snapshot();
 console.log('STOP_BROWSER_FINAL',JSON.stringify(final));
 if(final.debug?.running)throw Error('STOP_GA_STILL_RUNNING');
 console.log('STOP_BROWSER_LIVE_ACCEPTANCE_PASS');
} catch(e){
 console.log('STOP_BROWSER_FAILURE',e.name,String(e.message).slice(0,150));
 console.log('STOP_BROWSER_REQUESTS',JSON.stringify(requests));
 console.log('STOP_BROWSER_RESPONSES',JSON.stringify(responses.slice(-16)));
 console.log('STOP_BROWSER_ERRORS',JSON.stringify(errs.slice(-10)));
 process.exitCode=1;
} finally{
 // Server-side cleanup is same-origin, scoped to this newly created account.
 if(started&&!stopped){try{await page.evaluate(()=>fetch('/api/optimizer-stop',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.status))}catch{}}
 await browser.close();
}
