'use strict';
(function(){
 const embedded=location.pathname.startsWith('/embed/');
 const privacy=()=>navigator.doNotTrack==='1'||navigator.globalPrivacyControl===true;
 const sent=new Set();
 function event(name){if(embedded||privacy()||sent.has(name))return;sent.add(name);fetch('/api/usage',{method:'POST',credentials:'omit',headers:{'content-type':'application/json'},body:JSON.stringify({event:name,source:location.pathname}),keepalive:true}).catch(()=>{});}
 const form=document.getElementById('lo-capacity-form');
 if(form){
  const actions=document.createElement('div');actions.className='lo-actions lo-export';
  actions.innerHTML='<button class="lo-button lo-secondary" type="button" id="lo-export-result">Save result as JSON</button><button class="lo-button lo-secondary" type="button" id="lo-print-result">Print / save PDF</button>';
  const result=document.getElementById('lo-results');result.appendChild(actions);
  form.addEventListener('input',()=>event('calculator_used'),{once:true});form.addEventListener('submit',()=>event('calculator_used'),{once:true});
  document.getElementById('lo-export-result').onclick=()=>{
   if(result.hidden||!form.checkValidity())return;
   const inputs=Object.fromEntries([...form.querySelectorAll('input')].map(e=>[e.name,Number(e.value)]));
   const summary={plannedLoad:document.getElementById('lo-load').textContent,availableHours:document.getElementById('lo-available').textContent,requiredHours:document.getElementById('lo-required').textContent,headroomLabel:document.getElementById('lo-headroom-label').textContent,headroom:document.getElementById('lo-headroom').textContent};
   const report={tool:'LiftOrbit production capacity calculator',createdAt:new Date().toISOString(),inputs,summary,limits:'Aggregate estimate for interchangeable machines, not a feasible schedule, OEE or delivery promise.'};
   const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='liftorbit-capacity-estimate.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);event('calculator_export');
  };
  document.getElementById('lo-print-result').onclick=()=>{if(!result.hidden)window.print()};
 }
 const panels=[...document.querySelectorAll('[data-tour-panel]')],tabs=[...document.querySelectorAll('[data-tour-step]')];
 if(panels.length){let active=0;
  function show(index){active=Math.max(0,Math.min(panels.length-1,index));panels.forEach((p,i)=>p.hidden=i!==active);tabs.forEach((t,i)=>t.setAttribute('aria-pressed',String(i===active)));document.getElementById('lo-tour-prev').disabled=active===0;document.getElementById('lo-tour-next').disabled=active===panels.length-1;document.getElementById('lo-tour-position').textContent='Step '+(active+1)+' of '+panels.length;event('demo_step_view')}
  tabs.forEach(t=>t.onclick=()=>show(Number(t.dataset.tourStep)));document.getElementById('lo-tour-prev').onclick=()=>show(active-1);document.getElementById('lo-tour-next').onclick=()=>show(active+1);show(0);
 }
 const copy=document.getElementById('lo-copy-embed');if(copy)copy.onclick=async()=>{const field=document.getElementById('lo-embed-code'),status=document.getElementById('lo-copy-status');try{await navigator.clipboard.writeText(field.value);status.textContent='Embed code copied.'}catch{field.focus();field.select();status.textContent='Select and copy the code above.'}};
})();
