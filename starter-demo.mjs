import {createHash} from 'node:crypto';
// Synthetic English onboarding fixture. No existing customer project is copied.
export const STARTER_VERSION='starter-en-2026-10-16-v1';
export function createStarterModel(now=new Date()) {
 const start=new Date(now.getTime()+86400000).toISOString().slice(0,10)+'T08:00:00';
 const specifications=[['PRESS','Press 01','pressing',300],['DRY','Dryer 01','drying',45],['GLAZE','Glazing line','glazing',400],['KILN','Kiln 01','firing',60],['PACK','Packing station','packaging',300]];
 const equipment=specifications.map(([id,name,kind,time])=>({id,name,kind,capacity:200,capacity_unit:'m2',process_multiplier:1,timing_profile:['drying','firing'].includes(kind)?{timing_mode:'fixed',duration_min:time}:{timing_mode:'throughput',throughput_per_hour:time},capabilities:{max_parameters:{width_mm:1200},allowed_firing_recipes:['PS-01']}}));
 const employees=[['OP_PRESS','Press operator'],['OP_GLAZE','Glazing operator'],['OP_PACK','Packing operator']].map(([id,name])=>({id,name,role:name,shift:'day',capacity:1}));
 const orders=[[1001,100,'White','600x600'],[1002,120,'Beige','600x600'],[1003,80,'White','300x300']].map(([id,quantity,glaze_color,press_format])=>{const size=Number(press_format.split('x')[0]);const parameters={width_mm:size,length_mm:size,thickness_mm:9,mass_kg_m2:18,product_code:'SAMPLE-'+id,product_family:'porcelain_stoneware',finish:'matt',design_family:glaze_color,firing_recipe:'PS-01',press_family:'standard',glaze_color,press_format};return {id,product_code:'SAMPLE-'+id,quantity,area:quantity,unit:'m2',batch_quantity:200,technical_process_id:'TP_STARTER',process_hours:0.001,...parameters,parameters:{...parameters},production_parameters:{...parameters}}});
 const rr=(id,type,ref,quantity=1)=>({id,resource_type:type,type,match_mode:type==='equipment'?'any':'specific',resource_ref:ref,resource_refs:[ref],quantity,unit:type==='material'?'kg':type==='employee'?'person':'unit',consumption_rule:type==='material'?'per_m2':'during_operation',...(type==='equipment'?{kind:ref.slice(5)}:{})});
 const steps=[['PRESS','Pressing','pressing','OP_PRESS','press_format'],['DRY','Drying','drying',null,''],['GLAZE','Glazing','glazing','OP_GLAZE','glaze_color'],['KILN','Firing','firing',null,''],['PACK','Packing','packaging','OP_PACK','']];
 const operations=steps.map(([id,name,kind,employee,setup_parameter],i)=>({id:'STEP_'+id,sequence:i+1,name,duration_min:1,parallel_allowed:false,setup_parameter,resource_requirements:[rr('R_'+id,'equipment','kind:'+kind),...(employee?[rr('R_'+employee,'employee',employee)]:[]),...(id==='PRESS'?[rr('R_BODY','material','BODY',18.5)]:[]),...(id==='GLAZE'?[rr('R_GLAZE_MAT','material','GLAZE_MAT',0.65)]:[])]}));
 return {schema_version:'2.0',quantity_unit:'m2',start,objective:'duration',_starter_demo:STARTER_VERSION,source_text:'Synthetic ceramic workshop learning example: 3 orders, 5 machines, 3 operators and 2 materials. Timings are illustrative, not a validated ceramic process. Each account receives its own editable copy.',shifts:{day:[['00:00','00:00']]},operations:Object.fromEntries(['default_day','large_day','small_day','large_evening','small_evening'].map(k=>[k,{load:0,unload:0,changeover:0}])),orders,equipment,autoclaves:equipment.map(e=>({...e})),employees,materials:[{id:'BODY',name:'Ceramic body powder',unit:'kg',initial_stock:8000,deliveries:[],consumption_per_unit:18.5,order_ids:[1001,1002,1003]},{id:'GLAZE_MAT',name:'Glaze',unit:'kg',initial_stock:300,deliveries:[],consumption_per_unit:0.65,order_ids:[1001,1002,1003]}],constraints:[],technical_processes:[{id:'TP_STARTER',name:'Sample ceramic tile production',operations}],setup_rules:[{id:'PRESS_FORMAT',setup_parameter:'press_format',equipment_ref:'pressing',from_state:'*',to_state:'*',duration_min:20,employee_ref:'',employee_count:0,forbidden:false},{id:'GLAZE_COLOR',setup_parameter:'glaze_color',equipment_ref:'glazing',from_state:'*',to_state:'*',duration_min:15,employee_ref:'',employee_count:0,forbidden:false}],equipment_types:specifications.map(([,name,id])=>({id,name:{pressing:'Pressing',drying:'Drying',glazing:'Glazing',firing:'Firing',packaging:'Packing'}[id]})),role_catalog:employees.map(e=>({id:e.role,name:e.role}))};
}
export function planStarterStorage(storage,now=new Date(),id='demo_'+crypto.randomUUID()) {
 if(!storage||typeof storage!=='object'||Array.isArray(storage))throw Error('invalid_storage');
 for(const key of ['prodplan.projects.v2','prodplan.catalogs.v1']) {
  if(storage[key]){let rows;try{rows=JSON.parse(storage[key])}catch{throw Error('invalid_project_storage')}
   if(!Array.isArray(rows))throw Error('invalid_project_storage');
   if(rows.length)return {created:false,reason:'existing_projects'};
  }
 }
 if(storage['liftorbit.starter.seeded.v1'])return {created:false,reason:'already_initialized'};
 const t=now.toISOString(),model=createStarterModel(now);
 const project={id,name:'Sample workshop - try me',isDemo:true,demoTemplate:STARTER_VERSION,createdAt:t,updatedAt:t,revision:1,model,lastPlan:null,savedPlans:[],history:[],messages:[{role:'assistant',text:'Welcome! This is your private, editable example. Review the 3 orders, then use Start optimization to build a real plan. Change a quantity or a setup rule and compare the next result. All data and timings are synthetic.',at:t}]};
 return {created:true,project,storage:{...storage,'prodplan.projects.v2':JSON.stringify([project]),'prodplan.project.active.v2':id,'prodplan.ui.language.v1':'en','liftorbit.starter.seeded.v1':STARTER_VERSION}};
}
export function makeStarterHandler({handler,verify,sameOrigin,origin,ui='',loginUi='',fetcher=fetch}) {
 const locks=new Map();
 const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store','x-robots-tag':'noindex'}});
 const call=async(cookie,path,body)=>{
  const r=await fetcher(origin+path,{method:body===undefined?'GET':'POST',headers:{cookie,'accept':'application/json',...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'manual',signal:AbortSignal.timeout(25000)});
  if(!r.ok)throw Error('starter_upstream_'+r.status);
  const data=await r.json();if(data.ok===false)throw Error('starter_upstream_rejected');return data;
 };
 async function seed(cookie){
  // Only a fresh, empty account is seeded. Never update existing projects.
  const key=createHash('sha256').update(cookie).digest('hex');
  if(locks.has(key))return locks.get(key);
  const work=(async()=>{
   const before=await call(cookie,'/api/db-storage');
   const decision=planStarterStorage(before.storage);
   if(!decision.created)return {ok:true,created:false,reason:decision.reason};
   const check=await call(cookie,'/api/db-storage');
   if(JSON.stringify(check.storage)!==JSON.stringify(before.storage))return {ok:false,error:'workspace_changed_retry'};
   // The existing open-project flow imports the model after hydration.
   await call(cookie,'/api/db-storage',{storage:decision.storage});
   const saved=await call(cookie,'/api/db-storage');
   const rows=JSON.parse(saved.storage?.['prodplan.projects.v2']||'[]');
   if(!rows.some(p=>p.id===decision.project.id&&p.demoTemplate===STARTER_VERSION))throw Error('starter_save_not_confirmed');
   console.log(JSON.stringify({event:'starter_demo_created',template:STARTER_VERSION}));
   return {ok:true,created:true};
  })();
  locks.set(key,work);try{return await work}finally{locks.delete(key)}
 }
 return async function(req){
  const path=new URL(req.url).pathname;
  if(path==='/__onboarding_health'&&req.method==='GET')return json({ok:true,release:STARTER_VERSION});
  if(path==='/api/onboarding/starter'){
   if(req.method!=='POST')return json({error:'method_not_allowed'},405);
   if(!sameOrigin(req))return json({error:'cross_origin_forbidden'},403);
   if(!await verify(req))return json({error:'authentication_required'},401);
   try{return json(await seed(req.headers.get('cookie')||''))}catch{return json({error:'demo_not_ready_retry'},503)}
  }
  const r=await handler(req);
  if(path==='/api/auth/register'&&req.method==='POST'&&r.ok){
   const cookies=r.headers.getSetCookie?.()||[r.headers.get('set-cookie')||''];
   const cookie=cookies.map(v=>v.split(';')[0]).filter(Boolean).join('; ');
   let outcome='pending';
   if(cookie){try{const result=await seed(cookie);outcome=result.ok?(result.created?'created':result.reason):'pending'}catch{console.warn('STARTER_DEMO_PENDING')}}
   const h=new Headers(r.headers);h.set('x-liftorbit-starter',outcome);
   console.log(JSON.stringify({event:'registration_success',starter:outcome}));
   return new Response(r.body,{status:r.status,headers:h});
  }
  if(path==='/'&&req.method==='GET'&&r.headers.get('content-type')?.includes('text/html')){
   let html=await r.text();const loggedIn=html.includes('id="ppProtectedLogout"');
   html=html.replace('</body>',(loggedIn?ui:loginUi)+'</body>');
   const h=new Headers(r.headers);h.delete('content-length');h.set('cache-control','no-store');h.set('x-liftorbit-onboarding',STARTER_VERSION);
   return new Response(html,{status:r.status,headers:h});
  }
  if(path==='/api/plan'&&req.method==='POST'&&r.ok){
   try{const d=await r.clone().json();if(d.ok&&d.valid!==false&&!d.partial)console.log(JSON.stringify({event:'plan_created',template:STARTER_VERSION}));}catch{}
  }
  return r;
 };
}
