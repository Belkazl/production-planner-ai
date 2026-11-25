export function ppAcceptedPlanRunFloor(env){
 const keys={duration:'duration_minutes',wait:'operator_wait_minutes',idle:'machine_idle_minutes',cycles:'batch_count'};
 const w=env.window,read=env.project;
 let scope=null,original=null,goal=null,best=null,blocked=0,restored=0,closed=true,comparable=true;
 const rows=p=>p?.generic_operations?.length?p.generic_operations:p?.operations||[];
 const valid=p=>p&&p.valid===true&&p.ok!==false&&p.partial!==true&&p._pp_preview_limited!==true&&
  rows(p).length&&Object.values(keys).every(k=>typeof p[k]==='number'&&Number.isFinite(p[k])&&p[k]>=0);
 const sameScope=()=>{const p=read();return !!p&&!!scope&&String(p.id)===scope.id&&Number(p.revision||0)===scope.revision};
 const context=p=>p?._pp_native_schedule_v1?.context||p?._pp_preview_native_context?.context||null;
 const different=(a,b)=>!!a&&!!b&&(a.model_key!==b.model_key||a.pin_key!==b.pin_key);
 const metric=(p,key)=>typeof p?.[key]==='number'&&Number.isFinite(p[key])&&p[key]>=0?p[key]:null;
 const epsilon=(a,b)=>1e-7*Math.max(1,Math.abs(a),Math.abs(b));
 const worse=(a,b)=>a>b+epsilon(a,b);
 function begin(){
  original=null;best=null;blocked=0;closed=false;comparable=true;
  const p=read();scope=p?{id:String(p.id),revision:Number(p.revision||0)}:null;
  goal=env.objective();const key=keys[goal];
  if(!p)return;
  const fresh=w.__ppFreshRestartMode===true&&String(w.__ppFreshRestartProject)===scope.id;
  if(w.__ppFreshRestartPending===true||(fresh&&!w.__ppFreshReferencePlan&&!valid(w.__ppOptimizerCommittedPlan)))return;
  const choices=[w.__ppOptimizerCommittedPlan,w.__ppTabPlan,fresh?w.__ppFreshReferencePlan:p.lastPlan];
  const prior=choices.find(x=>valid(x)&&(x._revision==null||Number(x._revision)===scope.revision));
  if(!prior)return;
  const orders=new Set((p.model?.orders||[]).map(o=>String(o.id)));
  if(!orders.size||!rows(prior).every(row=>{
   const id=row?.order??row?.order_id;
   return row&&(id!=null?orders.has(String(id)):row.is_setup===true||String(row.phase||row.type||'').toLowerCase()==='setup');
  }))return;
  try{original=JSON.parse(JSON.stringify(prior))}catch{return}
  best=key?metric(original,key):null;
 }
 function allowPreview(plan){
  if(closed||(scope&&!sameScope()))return false;
  const key=keys[goal];if(!key||!scope)return true;
  const value=metric(plan?._pp_preview_kpis,key);
  if(value===null){blocked++;return false}
  if(comparable&&original&&different(context(original),context(plan))){
   comparable=false;best=null;
  }
  if(best!==null&&worse(value,best)){blocked++;return false}
  if(best===null||value<best)best=value;
  return true;
 }
 function final(data){
  const candidate=data?.result;
  if(closed||!sameScope()||!valid(candidate)||!original||!comparable)return data;
  const key=keys[goal];if(!key||different(context(candidate),context(original)))return data;
  const a=metric(candidate,key),b=metric(original,key);
  if(a===null||b===null||!worse(a,b))return data;
  const prior={...original,ok:true,optimization_previous_best_preserved:true,
   optimization_termination_reason:'new_search_no_objective_improvement'};
  for(const k of ['optimization_run','total_generations','generations','population','runtime_ms'])
   if(Number.isFinite(candidate[k]))prior[k]=candidate[k];
  return {...data,result:prior,best_preview:prior,resume_state:prior.resume_state||null,optimization_previous_best_preserved:true};
 }
 function restore(){
  if(closed)return false;
  closed=true;
  if(!sameScope())return false;
  if(comparable&&original&&valid(original)){
   w.__ppOptimizationInFlight=false;
   w.__ppOptimizerCommittedPlan=original;w.__ppTabPlan=original;w.__ppGenericPlan=original;
   if(w.__ppFreshRestartMode===true&&String(w.__ppFreshRestartProject)===scope.id){
    w.__ppFreshReferencePlan=original;w.__ppFreshReferenceProject=scope.id;
   }
   env.render(original);
   w.__PP_KPI_SELECTED_REFERENCE_V2__?.select?.(original);
   env.kpis(original);
   restored++;
   return true;
  }
  if(w.__ppTabPlan?.partial===true||w.__ppGenericPlan?.partial===true)env.clear();
  return false;
 }
 return {begin,allowPreview,final,restore,close:()=>{closed=true},
  snapshot:()=>sameScope()&&comparable&&original?original:null,
  stats:()=>({blocked,restored,goal,acceptedDuration:comparable?original?.duration_minutes??null:null,best,closed,comparable})};
}