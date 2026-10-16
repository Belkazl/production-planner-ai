(function(){
'use strict';
if(window.__PP_STARTER_DEMO__)return;
window.__PP_STARTER_DEMO__={version:'starter-en-2026-10-16-v1'};
const store='prodplan.projects.v2',active='prodplan.project.active.v2';
const css=document.createElement('style');css.textContent='#loStarterGuide{margin:0 0 16px;padding:18px 20px;border:1px solid #cddfbe;border-radius:12px;background:#f1f7eb;color:#213b2e;font:13px/1.6 Inter,Arial,sans-serif}#loStarterGuide strong{display:block;font-size:16px;margin-bottom:5px}#loStarterGuide p{margin:4px 0 12px}#loStarterGuide button{background:white;color:#244b31;border:1px solid #b7ceaa;border-radius:7px;padding:9px 13px;cursor:pointer;font:600 12px Inter,Arial,sans-serif;margin:0 8px 5px 0}#loStarterGuide button:disabled{opacity:.5;cursor:default}#loStarterGuide button:focus-visible{outline:3px solid #2a69df;outline-offset:2px}#loStarterGuide [data-build]{background:#2860c9;color:white;border-color:#2860c9}#loStarterGuide small{display:block;color:#52634a}';document.head.appendChild(css);
let banner=null,lastMode='';
function projects(){try{return JSON.parse(localStorage.getItem(store)||'[]')}catch{return null}}
async function retry(button){
 button.disabled=true;button.textContent='Preparing your example...';
 try{
  const check=await fetch('/api/db-storage',{credentials:'same-origin',cache:'no-store'});if(!check.ok)throw Error('Session check failed. Please sign in again.');
  const r=await fetch('/api/onboarding/starter',{method:'POST',credentials:'same-origin'}),d=await r.json();
  if(!r.ok||!d.ok)throw Error('The example could not be saved. Your projects have not been replaced. Try again.');
  if(!d.created){button.textContent=d.reason==='already_initialized'?'Example was already created. Use Import to restore a copy.':'Your existing projects have been kept.';return;}
  location.reload();
 }catch(e){button.disabled=false;button.textContent='Try again';banner.querySelector('small').textContent=e.message;}
}
function mount(){
 const list=projects();if(!Array.isArray(list))return;
 const p=list.find(p=>p.id===localStorage.getItem(active));
 const isDemo=p&&p.demoTemplate==='starter-en-2026-10-16-v1';
 const empty=list.length===0&&!localStorage.getItem('liftorbit.starter.seeded.v1');
 const mode=isDemo?'demo':empty?'empty':'';
 const host=document.getElementById(isDemo?'planView':'sectionView');
 if(!mode||!host){if(banner)banner.remove();banner=null;lastMode='';return;}
 if(!banner||!banner.isConnected||mode!==lastMode){
  if(banner)banner.remove();banner=document.createElement('section');banner.id='loStarterGuide';banner.setAttribute('aria-label','Getting started');lastMode=mode;
  banner.innerHTML=isDemo?'<strong>Your own sample workshop</strong><p>3 orders, 5 machines, 3 operators and 2 materials. Start with the prepared data, then try changing an order quantity.</p><button type="button" data-orders>1. Review orders</button><button type="button" data-build>2. Build first plan</button><small>This is a separate editable demo. All timings are illustrative. Create your own production as a new project.</small>':'<strong>Try a small production example</strong><p>Start with an editable English demo instead of an empty workspace.</p><button type="button" data-retry>Create my example</button><small>The example will only be added while your project list is empty.</small>';
  host.prepend(banner);
  banner.querySelector('[data-retry]')?.addEventListener('click',e=>retry(e.currentTarget));
  banner.querySelector('[data-build]')?.addEventListener('click',()=>{const b=document.getElementById('opt');if(b&&!b.disabled)b.click()});
  banner.querySelector('[data-orders]')?.addEventListener('click',()=>{const b=[...document.querySelectorAll('.side .item')].find(e=>/^(Orders|\u0417\u0430\u043a\u0430\u0437\u044b)$/.test(e.textContent.trim()));if(b)b.click()});
 }
 const b=banner.querySelector('[data-build]'),opt=document.getElementById('opt');
 if(b&&opt){b.disabled=opt.disabled;const t=p.lastPlan?'2. Run optimization again':'2. Build first plan';if(b.textContent!==t)b.textContent=t;}
}
mount();setInterval(mount,1000);
})();
