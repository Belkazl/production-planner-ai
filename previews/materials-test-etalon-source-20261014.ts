// APS scheduling experiment: reserve real setup time before each resource operation.
// Uses the upstream optimizer's batch durations and fixed resource assignments, but
// reschedules the full resource-constrained sequence. Read-only against upstream.
const sid = x => String(x ?? '').trim();
const num = x => Number(x);
const EPS = 0.000001;
const copy = x => structuredClone(x);
function ensure(c, message, data={}) { if (!c) { const e=new Error(message); e.details=data; throw e; } }
function machineMatches(rule, machine) {
  const x=sid(rule.equipment_ref || '*').toLowerCase(), kind=sid(machine.kind).toLowerCase();
  return ["*",sid(machine.id).toLowerCase(),sid(machine.name).toLowerCase(),kind,"kind:"+kind].includes(x);
}
function parameter(order, key) { return sid(order?.parameters?.[key] ?? order?.production_parameters?.[key] ?? order?.[key]); }
function dateAt(base, minute) {
  if(!base)return undefined;
  const naive=!/[zZ]$|[+-]\d\d:\d\d$/.test(base);
  const epoch=Date.parse(naive?base+'Z':base);
  if(!Number.isFinite(epoch))return undefined;
  const result=new Date(epoch+minute*60000).toISOString();
  return naive?result.replace(/\.\d{3}Z$/,''):result;
}
function rand32(seed) { let a=(Number(seed)>>>0)||0x1234abcd;return ()=>{a+=0x6d2b79f5;let x=a;x=Math.imul(x^(x>>>15),x|1);x^=x+Math.imul(x^(x>>>7),x|61);return ((x^(x>>>14))>>>0)/4294967296;} }
function unique(xs) { return [...new Set((xs||[]).map(sid).filter(Boolean))]; }
function equipmentOf(op) { return unique([...(op.equipment_ids||[]),...(op.resources||[]).filter(r=>r.resource_type==='equipment').map(r=>r.id)]); }
function employeeOf(op) { return unique([...(op.employee_ids||[]),...(op.resources||[]).filter(r=>r.resource_type==='employee').map(r=>r.id)]); }
function buildGroups(base) {
  const rows=(base?.operations||base?.generic_operations||[]).filter(x=>!x.is_setup);
  ensure(rows.length>0,'no_production_operations');
  const buckets=new Map();
  for(const op of rows) {
    const key=sid(op.batch_id||`${sid(op.order)}.${op.batch||1}`);
    if(!buckets.has(key))buckets.set(key,[]);
    buckets.get(key).push(op);
  }
  const jobs=[...buckets].map(([key,ops])=>({key,ops:ops.sort((a,b)=>num(a.sequence)-num(b.sequence)||num(a.start_min)-num(b.start_min)),index:0,ready:0}));
  for(const job of jobs)for(const op of job.ops) {
    ensure(num(op.duration_min)>=0 && Number.isFinite(num(op.duration_min)),'invalid_production_duration',{batch:job.key,op:op.operation_id});
    ensure(equipmentOf(op).length||employeeOf(op).length,'no_resource_assignments',{batch:job.key,op:op.operation_id});
  }
  return {jobs,rows};
}
function setupFor(machine,oldOrder,newOrder,rules) {
  if(!oldOrder) return [];
  const applicable=rules.filter(r=>machineMatches(r,machine));
  const params=unique(applicable.map(x=>x.setup_parameter));
  let changes=[];
  for(const key of params) {
    const from=parameter(oldOrder,key),to=parameter(newOrder,key);
    if(!from||!to||from===to)continue;
    let chosen=null,rank=-1;
    for(const r of applicable){
      if(sid(r.setup_parameter)!==key)continue;
      const f=sid(r.from_state||'*'),t=sid(r.to_state||'*');
      if((f!=='*'&&f!==from)||(t!=='*'&&t!==to))continue;
      const specificity=(f==='*'?0:1)+(t==='*'?0:1);
      if(specificity>rank){chosen=r;rank=specificity;}
    }
    ensure(chosen!==null,'setup_transition_rule_missing',{machine:machine.id,key,from,to});
    ensure(!chosen.forbidden,'setup_transition_forbidden',{machine:machine.id,key,from,to,rule:chosen.id});
    const duration=num(chosen.duration_min);
    ensure(Number.isFinite(duration)&&duration>=0,'setup_duration_invalid',{rule:chosen.id});
    if(duration>EPS)changes.push({rule:chosen,key,from,to,duration});
  }
  return changes;
}
function chooseEmployees(rule, employees, free, at) {
  const count=Math.max(0,Math.trunc(num(rule.employee_count)||0));
  if(!count)return {ids:[],start:at};
  const ref=sid(rule.employee_ref);
  let pool=employees;
  if(ref.toLowerCase().startsWith('role:'))pool=pool.filter(e=>sid(e.role).toLowerCase()===ref.slice(5).trim().toLowerCase());
  else if(ref)pool=pool.filter(e=>sid(e.id)===ref||sid(e.name)===ref);
  ensure(pool.length>=count,'setup_employee_count_unavailable',{rule:rule.id,requested:count,available:pool.length});
  const sorted=pool.slice().sort((a,b)=>(free.get(sid(a.id))||0)-(free.get(sid(b.id))||0));
  const picks=sorted.slice(0,count).map(e=>sid(e.id));
  return {ids:picks,start:Math.max(at,...picks.map(id=>free.get(id)||0))};
}
function operationDuration(op) { return Math.max(0,num(op.duration_min)); }
export function scheduleWithSetup(base,model,options={}) {
  ensure(model&&Array.isArray(model.orders)&&Array.isArray(model.setup_rules),'bad_model');
  const {jobs,rows}=buildGroups(base),orders=new Map(model.orders.map(o=>[sid(o.id),o]));
  const machines=new Map((model.equipment?.length?model.equipment:model.autoclaves||[]).map(e=>[sid(e.id),e]));
  const rules=model.setup_rules;
  const employees=model.employees||[];
  const eqFree=new Map(),empFree=new Map(),eqPrevious=new Map(),setupRows=[],scheduled=[],sequence=[];
  const rng=rand32(options.seed||1),strength=Math.max(0,num(options.randomness)||0);
  let remaining=rows.length;
  for(let step=0;step<rows.length;step++){
    let winner=null,lowest=Infinity;
    for(let i=0;i<jobs.length;i++){
      const job=jobs[i];if(job.index>=job.ops.length)continue;
      const op=job.ops[job.index],order=orders.get(sid(op.order));
      ensure(order,'unknown_order',{order:op.order});
      let at=job.ready,work=operationDuration(op);
      for(const eid of employeeOf(op))at=Math.max(at,empFree.get(eid)||0);
      for(const id of equipmentOf(op)){
        const machine=machines.get(id);ensure(machine,'unknown_equipment',{id});
        const last=eqPrevious.get(id),changes=setupFor(machine,last&&orders.get(last),order,rules);
        const prep=changes.reduce((s,c)=>s+c.duration,0);
        at=Math.max(at,(eqFree.get(id)||0)+prep);
      }
      let score=at+work;
      // Prefer operations likely to unblock the next stage, with randomized exploration.
      const mode=options.mode||'earliest_finish';
      if(mode==='earliest_start')score=at;
      else if(mode==='longest_first')score=at-work*0.5;
      else if(mode==='baseline')score=Number(op.start_min)+work*0.2;
      else if(mode==='balanced')score=at+work*0.2+job.ready*0.05;
      score+=(rng()-0.5)*strength;
      if(score<lowest){lowest=score;winner=i;}
    }
    ensure(winner!==null,'deadlocked_job_shop');
    const job=jobs[winner],op=job.ops[job.index],order=orders.get(sid(op.order));
    const qids=equipmentOf(op),eids=employeeOf(op),duration=operationDuration(op);
    const machineEnds=[];
    for(const id of qids){
      const machine=machines.get(id),previous=eqPrevious.get(id);
      const changes=setupFor(machine,previous&&orders.get(previous),order,rules);
      let cursor=eqFree.get(id)||0;
      for(const c of changes){
        const allocation=chooseEmployees(c.rule,employees,empFree,cursor);
        const st=Math.max(cursor,allocation.start),en=st+c.duration;
        const newRow={
          order:op.order, technical_process_id:op.technical_process_id,
          technical_process_name:op.technical_process_name,
          operation_id:`setup:${sid(c.rule.id)}:${id}:${job.key}:${setupRows.length+1}`,
          operation_name:'Переналадка: '+c.key,sequence:num(op.sequence)-0.001,
          is_setup:true,phase:'setup',type:'setup',setup_rule_id:c.rule.id,
          setup_parameter:c.key,from_state:c.from,to_state:c.to,
          start_min:st,end_min:en,duration_min:c.duration,
          employee_ids:allocation.ids,equipment_ids:[id],materials:[],
          resources:[{resource_type:'equipment',id,name:machine.name||id},...allocation.ids.map(eid=>({resource_type:'employee',id:eid,name:employees.find(e=>sid(e.id)===eid)?.name||eid}))],
          batch:op.batch,batch_id:op.batch_id,batch_count:op.batch_count,
          batch_quantity:op.batch_quantity,batch_capacity:op.batch_capacity,batch_unit:op.batch_unit,
          start:dateAt(base.start,st),end:dateAt(base.start,en)
        };
        setupRows.push(newRow);
        for(const eid of allocation.ids)empFree.set(eid,en);
        cursor=en;
      }
      machineEnds.push(cursor);
    }
    const start=Math.max(job.ready,...eids.map(id=>empFree.get(id)||0),...machineEnds,0),end=start+duration;
    const row={...copy(op),start_min:start,end_min:end,duration_min:duration,start:dateAt(base.start,start),end:dateAt(base.start,end)};
    scheduled.push(row);sequence.push(job.key);
    for(const id of eids)empFree.set(id,end);
    for(const id of qids){eqFree.set(id,end);eqPrevious.set(id,sid(op.order));}
    job.ready=end;job.index++;remaining--;
  }
  ensure(remaining===0,'incomplete_job_shop',{remaining});
  const combined=[...scheduled,...setupRows].sort((a,b)=>a.start_min-b.start_min||a.end_min-b.end_min);
  const makespan=Math.max(0,...combined.map(x=>x.end_min));
  const summary=validateSetupPlan(combined,model,rows.length,setupRows.length);
  ensure(summary.valid,'schedule_validation_failed',{errors:summary.errors});
  const batches=[];
  const priorBatchMap=new Map((base.batches||[]).map(b=>[sid(b.batch_id),b]));
  const byBatch=new Map();
  for(const op of scheduled){const key=sid(op.batch_id||`${sid(op.order)}.${op.batch||1}`);if(!byBatch.has(key))byBatch.set(key,[]);byBatch.get(key).push(op);}
  for(const [key,ops] of byBatch){
    const old=priorBatchMap.get(key)||{};
    batches.push({...old,order:ops[0].order,batch:ops[0].batch,batch_id:key,batch_count:ops[0].batch_count,
      start_min:Math.min(...ops.map(o=>o.start_min)),end_min:Math.max(...ops.map(o=>o.end_min)),
      equipment_ids:unique(ops.flatMap(o=>equipmentOf(o)))});
  }
  const out={...copy(base),ok:true,generic_schedule:true,valid:true,validation_errors:[],
    duration_minutes:Math.round(makespan*1000000)/1000000,
    finish:dateAt(base.start,makespan),operation_count:combined.length,batch_count:batches.length,
    generic_operations:combined,operations:combined,batches,
    setup_operation_count:setupRows.length,
    setup_duration_total_minutes:Math.round(setupRows.reduce((s,x)=>s+x.duration_min,0)*1000000)/1000000,
    setup_enrichment_stage:'scheduler_reservation',objective:model.objective||'duration'
  };
  // The resource busy time cannot count setup as idle.
  const eqUsage=new Map();for(const row of combined)for(const id of equipmentOf(row)){
    if(!eqUsage.has(id))eqUsage.set(id,[]);eqUsage.get(id).push(row);
  }
  let idle=0;for(const ops of eqUsage.values()){ops.sort((a,b)=>a.start_min-b.start_min);for(let i=1;i<ops.length;i++)idle+=Math.max(0,ops[i].start_min-ops[i-1].end_min);}
  out.machine_idle_minutes=Math.round(idle*1000000)/1000000;
  return {plan:out,summary:{...summary,makespan,production_operations:scheduled.length,setup_operations:setupRows.length,setup_minutes:out.setup_duration_total_minutes,batch_count:batches.length}};
}
export function validateSetupPlan(rows,model,expectedProduction,expectedSetup) {
  const errors=[],byMachine=new Map(),byEmployee=new Map(),jobs=new Map();
  const machineMap=new Map((model.equipment||[]).map(e=>[sid(e.id),e]));
  for(const op of rows){
    if(!Number.isFinite(num(op.start_min))||!Number.isFinite(num(op.end_min))||op.end_min+EPS<op.start_min)errors.push('bad_interval');
    if(op.is_setup&&(!op.setup_rule_id||op.duration_min<=0||Math.abs(op.end_min-op.start_min-op.duration_min)>EPS))errors.push('bad_setup');
    if(!op.is_setup){const key=sid(op.batch_id||`${sid(op.order)}.${op.batch||1}`);if(!jobs.has(key))jobs.set(key,[]);jobs.get(key).push(op);}
    for(const id of equipmentOf(op)){if(!machineMap.has(id))errors.push('unknown_machine:'+id);if(!byMachine.has(id))byMachine.set(id,[]);byMachine.get(id).push(op)}
    for(const id of employeeOf(op)){if(!byEmployee.has(id))byEmployee.set(id,[]);byEmployee.get(id).push(op)}
  }
  for(const [key,map] of [['equipment',byMachine],['employee',byEmployee]])for(const [id,ops] of map){
    ops.sort((a,b)=>a.start_min-b.start_min);
    for(let i=1;i<ops.length;i++)if(ops[i].start_min+EPS<ops[i-1].end_min)errors.push(`${key}_overlap:${id}`);
  }
  for(const [batch,ops] of jobs){ops.sort((a,b)=>num(a.sequence)-num(b.sequence));for(let i=1;i<ops.length;i++)if(ops[i].start_min+EPS<ops[i-1].end_min)errors.push('precedence:'+batch)}
  const prod=rows.filter(x=>!x.is_setup).length,setups=rows.length-prod;
  if(expectedProduction!==undefined&&prod!==expectedProduction)errors.push('lost_operations');
  if(expectedSetup!==undefined&&setups!==expectedSetup)errors.push('setup_count_mismatch');
  // Independently verify consecutive machine transitions have the right reserved setup IDs.
  const orders=new Map((model.orders||[]).map(o=>[sid(o.id),o]));
  for(const [id,events] of byMachine){
    const machine=machineMap.get(id);if(!machine)continue;
    let previousOrder=null;
    const blocks=[];
    for(const item of events){
      if(item.is_setup){blocks.push(item);continue;}
      const next=orders.get(sid(item.order));
      if(previousOrder){
        try{
          const req=setupFor(machine,previousOrder,next,model.setup_rules||[]);
          if(req.length!==blocks.length)errors.push('missing_setup:'+id);
          else for(let i=0;i<req.length;i++)if(sid(req[i].rule.id)!==sid(blocks[i].setup_rule_id)||Math.abs(req[i].duration-blocks[i].duration_min)>EPS)errors.push('wrong_setup_rule:'+id);
        }catch(e){errors.push(e.message+':'+id)}
      }else if(blocks.length)errors.push('setup_before_first_use:'+id);
      blocks.length=0;previousOrder=next;
    }
  }
  return {valid:errors.length===0,errors:[...new Set(errors)],equipment_count:byMachine.size,employee_count:byEmployee.size};
}

function ppObjective(goal){return ['duration','idle','wait','cycles','balanced'].includes(goal)?goal:'duration'}
function ppObjectiveKey(goal){return ({idle:'machine_idle_minutes',wait:'operator_wait_minutes',cycles:'batch_count',duration:'duration_minutes',balanced:'duration_minutes'})[ppObjective(goal)]}
function ppObjectiveBetter(a,b,goal){
 if(!a||a.valid===false||a.partial)return false;
 if(!b)return true;
 const key=ppObjectiveKey(goal),x=Number(a[key]),y=Number(b[key]);
 if(!Number.isFinite(x))return false;if(!Number.isFinite(y))return true;
 if(x<y-0.01)return true;if(x>y+0.01)return false;
 let improved=false;
 for(const k of ['duration_minutes','machine_idle_minutes','operator_wait_minutes','batch_count']){
  if(k===key)continue;
  const v=Number(a[k]),w=Number(b[k]);
  if(!Number.isFinite(v)||!Number.isFinite(w))continue;
  if(v>w+0.01)return false;
  if(v<w-0.01)improved=true;
 }
 return improved;
}
export async function searchWithSetup(base,model, options={}, report=()=>{}) {
  const iterations=Math.min(300,Math.max(1,Math.trunc(num(options.iterations)||100))), seed=options.seed||1729;
  const goal=ppObjective(options.objective||base.objective||model.objective);
  let best=null,bestSummary=null,candidate=null,candidateSummary=null,invalid=0;
  const modes=['earliest_finish','earliest_start','balanced','longest_first','baseline'];
  const started=performance.now();
  for(let i=0;i<iterations;i++){
    try {
      const mode=modes[i%modes.length];
      const randomness=i===0?0:i%7===0?250:15+((i*17)%160);
      const next=scheduleWithSetup(base,model,{mode,randomness,seed:seed+i*18313});
      candidate={...next.plan,objective:goal};candidateSummary=next.summary;
      if(ppObjectiveBetter(candidate,best,goal)){best=candidate;bestSummary=next.summary;}
    }catch(e){invalid++;if(!best&&i===iterations-1)throw e;}
    if(i===0||i%10===0||i===iterations-1){report({done:i+1,total:iterations,candidate_preview:candidate,best_preview:best,running:i<iterations-1,phase:'setup_aware_schedule',invalid});if(i>0&&i%10===0)await new Promise(resolve=>setTimeout(resolve,0));}
  }
  ensure(best!==null,'no_valid_setup_aware_plan',{invalid,iterations});
  const runtime_ms=Math.round(performance.now()-started);
  return {ok:true,valid:true,success:true,candidate_preview:candidate,best_preview:best,
    best_summary:bestSummary,candidate_summary:candidateSummary,
    iterations,invalid_trials:invalid,runtime_ms,objective:goal};
}



// Production-compatibility bridge, tested independently. Other API routes are untouched.
const UPSTREAM=(typeof Bun!=="undefined"&&Bun.env?.APS_UPSTREAM)||"https://production-planner-gateway-production.up.railway.app";
const REV="setups-bridge-20261010-objective-v1";
const modelCache={at:0,model:null};
function modelSignature(model){return JSON.stringify([model.start,(model.orders||[]).map(o=>[o.id,o.parameters]),model.setup_rules,(model.equipment||[]).map(e=>[e.id,e.kind])])}

function upstreamUrl(req){const u=new URL(req.url);return UPSTREAM+u.pathname+u.search}
function relayHeaders(req){const h=new Headers(req.headers);for(const n of ["host","content-length","connection","x-forwarded-host"])h.delete(n);return h}
function jsonifyBridge(x,status=200){return Response.json(x,{status,headers:{"cache-control":"no-store","x-aps-bridge":REV}})}
function rawResponse(r){const h=new Headers(r.headers);for(const key of ["content-encoding","content-length","transfer-encoding"])h.delete(key);h.set("x-aps-bridge",REV);return new Response(r.body,{status:r.status,headers:h})}
async function proxy(req){const method=req.method;const opts={method,headers:relayHeaders(req),redirect:"manual",signal:AbortSignal.timeout(350000)};if(!["GET","HEAD"].includes(method))opts.body=await req.arrayBuffer();const r=await fetch(upstreamUrl(req),opts);return rawResponse(r)}
async function loadModel(req){if(modelCache.model&&Date.now()-modelCache.at<1200)return modelCache.model;const h=relayHeaders(req);const r=await fetch(UPSTREAM+"/api/model",{headers:h,signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error("model_fetch_"+r.status);const j=await r.json();if(!j.model||!j.model.orders)throw Error("bad_model");modelCache.model=j.model;modelCache.at=Date.now();return j.model}
function convertOne(base,model,seed){if(!base?.operations?.length)return base;if(base.operations.some(o=>o.is_setup===true))return base;if(!(model.setup_rules||[]).length)return base;const next=scheduleWithSetup(base,model,{seed,mode:"earliest_finish"}).plan;const v=validateSetupPlan(next.operations,model,base.operations.length);if(!v.valid)throw Error("setup_plan_invalid:"+v.errors.slice(0,3).join(","));return {...base,...next,valid:base.valid!==false,validation_errors:base.valid===false?base.validation_errors||[]:[],aps_setup_bridge:REV}}

function setupSearchSeed(plan){const run=Number(plan?.optimization_run||0),gen=Number(plan?.total_generations||0);if(!Number.isFinite(run)||run<1)return 1729;return ((Math.imul(run>>>0,2654435761)^Math.imul((Number.isFinite(gen)?gen:0)>>>0,2246822519))>>>0)||1729}
const FINAL_CACHE=new Map();
function finalFingerprint(plan,model,objective='duration'){return JSON.stringify([ppObjective(objective),model,plan?.start,plan?.duration_minutes,plan?.operations,plan?.batches])}
function cachedFinal(plan,model,goal='duration'){const key=finalFingerprint(plan,model,goal);const c=FINAL_CACHE.get(key);if(c&&Date.now()-c.at<120000)return c.plan;return null}
function saveFinal(base,model,plan,goal='duration'){if(FINAL_CACHE.size>30)FINAL_CACHE.clear();FINAL_CACHE.set(finalFingerprint(base,model,goal),{plan,at:Date.now()})}

let ppRunSequence=0,ppActiveObjectiveRun=null;
function ppBeginObjectiveRun(goal,model){
 const state={id:++ppRunSequence,goal:ppObjective(goal),modelKey:modelSignature(model),created:Date.now(),completed:false,seenRunning:false,best:null,observed:0};
 ppActiveObjectiveRun=state;
 if(typeof ppProgressThrottle!=='undefined'){ppProgressThrottle.response=null;ppProgressThrottle.at=0;}
 console.log('APS_OBJECTIVE_RUN_START',JSON.stringify({id:state.id,objective:state.goal}));
 return state;
}
function ppObjectiveRunForModel(model){
 const state=ppActiveObjectiveRun;
 return state&&Date.now()-state.created<900000&&state.modelKey===modelSignature(model)?state:null;
}
function ppObserveObjectiveCandidate(state,candidate){
 if(!state||!candidate?.operations?.length||candidate.valid===false||candidate.partial)return;
 if(ppObjectiveBetter(candidate,state.best,state.goal)){
  state.best=copy(candidate);
  state.best.objective=state.goal;
  state.observed++;
 }
}
function ppPreferObservedObjectivePlan(state,chosen,expectedCount){
 if(state&&state.best&&state.best.operations.filter(o=>!o.is_setup).length===expectedCount&&ppObjectiveBetter(state.best,chosen,state.goal)){
  const selected=copy(state.best);
  selected.objective=state.goal;
  return selected;
 }
 return chosen;
}
async function progress(req){
 const r=await fetch(upstreamUrl(req),{headers:relayHeaders(req),signal:AbortSignal.timeout(30000)});
 if(!r.ok)return rawResponse(r);
 const data=await r.json();if(!data?.ok||!(data.candidate_preview||data.best_preview))return jsonifyBridge(data);
 try{
  const model=await loadModel(req),state=ppObjectiveRunForModel(model);
  const goal=state?.goal||ppObjective(model.objective);
  if(state&&data.running)state.seenRunning=true;
  const shouldObserve=!!(state&&(data.running||state.seenRunning||state.completed));
  if(data.candidate_preview){
   data.candidate_preview=convertOne(data.candidate_preview,model,13);
   data.candidate_preview.objective=goal;
   if(shouldObserve)ppObserveObjectiveCandidate(state,data.candidate_preview);
  }
  if(data.best_preview){
   const base=data.best_preview;
   if(data.running){data.best_preview=convertOne(base,model,37)}
   else if(data.success && base?.operations?.length && (model.setup_rules||[]).length && !base.operations.some(x=>x.is_setup)){
    let chosen=cachedFinal(base,model,goal);
    if(!chosen){
     const result=await searchWithSetup(base,model,{iterations:48,seed:setupSearchSeed(base),objective:goal});
     chosen={...base,...result.best_preview,aps_setup_bridge:REV,objective:goal};
     saveFinal(base,model,chosen,goal);
    }
    data.best_preview=chosen;
   }else data.best_preview=convertOne(base,model,37);
   data.best_preview.objective=goal;
   if(shouldObserve){
    ppObserveObjectiveCandidate(state,data.best_preview);
    data.best_preview=ppPreferObservedObjectivePlan(state,data.best_preview,data.best_preview.operations?.filter(o=>!o.is_setup).length||0);
   }
  }
  data.objective=goal;
  data.aps_setup_bridge=REV;
 }catch(e){data.aps_setup_bridge_error=String(e);console.error("APS_BRIDGE_PROGRESS_FAILED",String(e))}
 return jsonifyBridge(data);
}

async function plan(req){const requestBody=await req.arrayBuffer();let input={};try{input=JSON.parse(new TextDecoder().decode(requestBody))}catch{}
const model=await loadModel(req);
const goal=ppObjective(input.objective||model.objective),state=ppBeginObjectiveRun(goal,model);
const r=await fetch(upstreamUrl(req),{method:"POST",headers:relayHeaders(req),body:requestBody,signal:AbortSignal.timeout(350000)});if(!r.ok){state.completed=true;return rawResponse(r)}
const data=await r.json();if(!data?.ok||!data.operations?.length||!(model.setup_rules||[]).length){state.completed=true;return jsonifyBridge(data)}
if((input.locked_operations||[]).length){state.completed=true;data.aps_setup_bridge_skipped="manual_locks_preserved";return jsonifyBridge(data)}
try{
 const count=48,result=await searchWithSetup(data,model,{iterations:count,seed:setupSearchSeed(data),objective:goal});
 const choice=ppPreferObservedObjectivePlan(state,result.best_preview,data.operations.length);
 const out={...data,...choice,valid:data.valid!==false,objective:goal,aps_setup_bridge:REV,source_ga_duration_minutes:data.duration_minutes,setup_aware_search_count:count};
 saveFinal(data,model,out,goal);state.completed=true;
 console.log("APS_BRIDGE_PLAN_PASS",JSON.stringify({goal,source:data.duration_minutes,computed:out.duration_minutes,idle:out.machine_idle_minutes,setup:out.setup_operation_count,production:out.operations.filter(o=>!o.is_setup).length,seen:state.observed}));
 return jsonifyBridge(out);
}catch(e){state.completed=true;console.error("APS_BRIDGE_PLAN_FAILED",String(e));return jsonifyBridge({ok:false,error:"setup_bridge_failed",detail:String(e.message||e)},422)}
}
const PP_GANTT_INLINE="\n<style id=\"pp-gantt-tool-v2-css\">\n#ppGanttToolV2{width:max-content;min-width:100%;font-family:Inter,system-ui,-apple-system,\"Segoe UI\",Arial,sans-serif;color:#1c2b43}\n#ppGanttToolV2[hidden]{display:none!important}\n#ppGanttToolV2 .pg2-axis,#ppGanttToolV2 .pg2-row{display:flex;min-width:100%;box-sizing:border-box}\n#ppGanttToolV2 .pg2-axis{min-height:55px;position:sticky;top:0;background:#f8fbff;z-index:12;border-bottom:1px solid #dce4ee}\n#ppGanttToolV2 .pg2-row{height:54px;border-bottom:1px solid #e5ecf5}\n#ppGanttToolV2 .pg2-name{position:sticky;left:0;z-index:6;background:#fff;flex:0 0 212px;width:212px;max-width:212px;display:flex;align-items:center;gap:8px;padding:7px 10px;border-right:1px solid #dce4ee;box-sizing:border-box;box-shadow:2px 0 3px #10284608}\n#ppGanttToolV2 .pg2-axis>.pg2-name{background:#f8fbff;color:#536680;font-size:12px;font-weight:700;z-index:14}\n#ppGanttToolV2 .pg2-number{width:24px;height:24px;display:grid;place-items:center;flex-shrink:0;background:#ecf3ff;border-radius:7px;color:#3271cc;font-weight:700;font-size:10px}\n#ppGanttToolV2 .pg2-title{font-size:11px;font-weight:750;line-height:1.3;white-space:normal;overflow:hidden;text-overflow:ellipsis;max-height:30px}\n#ppGanttToolV2 .pg2-sub{font-size:10px;color:#8392a8;font-weight:400;line-height:1.2;margin-top:2px}\n#ppGanttToolV2 .pg2-axis-track,#ppGanttToolV2 .pg2-lane{position:relative;flex:none;box-sizing:border-box}\n#ppGanttToolV2 .pg2-axis-track{height:55px;background:#f8fbff}\n#ppGanttToolV2 .pg2-lane{height:53px;background:#fff}\n#ppGanttToolV2 .pg2-row:nth-child(odd) .pg2-lane{background:#fcfdff}\n#ppGanttToolV2 .pg2-tick{position:absolute;top:0;bottom:0;border-left:1px solid #dce5f0;white-space:nowrap;padding:6px 5px;font-size:11px;color:#435a76;pointer-events:none}\n#ppGanttToolV2 .pg2-tick b{display:block;font-size:11px;line-height:17px}\n#ppGanttToolV2 .pg2-tick small{font-size:10px;color:#8b99ad}\n#ppGanttToolV2 .pg2-grid{position:absolute;top:0;bottom:0;border-left:1px solid #eef2f8;pointer-events:none}\n#ppGanttToolV2 .pg2-grid.pg2-day{border-left-color:#c9d7eb}\n#ppGanttToolV2 .pg2-bar{position:absolute;top:10px;height:32px;min-width:2px;border-radius:5px;border:1px solid #10274433;display:flex;align-items:center;padding:0 5px;box-sizing:border-box;white-space:nowrap;overflow:hidden;font-size:10px;font-weight:700;color:#fff;cursor:help;box-shadow:0 1px 3px #0a24531a}\n#ppGanttToolV2 .pg2-bar:hover,#ppGanttToolV2 .pg2-bar:focus{z-index:3;outline:2px solid #6096f5;outline-offset:1px;filter:brightness(.94)}\n#ppGanttToolV2 .pg2-setup{background:#141e2e!important;border:1px solid #060c16!important;color:#fff!important;z-index:2}\n#ppGanttToolV2 .pg2-blocked{height:24px;top:15px;background:#fff1f0;border:1px dashed #d83c37;color:#9e2420;font-size:10px}\n#ppGanttToolV2 .pg2-footer{position:sticky;left:0;width:100%;box-sizing:border-box;border-top:1px solid #e2eaf5;padding:8px 12px;background:#f9fbff;display:flex;gap:16px;align-items:center;color:#5b6f8b;font-size:11px}\n#ppGanttToolV2 .pg2-key{display:inline-block;width:11px;height:11px;border-radius:3px;background:#141e2e;vertical-align:-1px;margin-right:3px}\n</style>\n<script id=\"pp-gantt-tool-v2-script\">\n(function(){\n\"use strict\";\nif(window.__PP_GANTT_TOOL_V2__)return;\nvar root=document.getElementById(\"ganttScroll\"),legacy=document.getElementById(\"timeline\");\nif(!root||!legacy||typeof renderPlan!==\"function\"){console.warn(\"PP_GANTT_V2_UNAVAILABLE\");return}\nvar stage=document.createElement(\"div\");stage.id=\"ppGanttToolV2\";stage.hidden=true;legacy.insertAdjacentElement(\"afterend\",stage);\nvar last=null,scale=1,version=\"equipment-gantt-component-v2-20261009\";\nvar palette=[\"#4d8ffa\",\"#25aea3\",\"#9272dd\",\"#e6ab34\",\"#e56e96\",\"#16a9cf\",\"#58a769\",\"#8d9cc9\"];\nfunction node(cls,txt){var e=document.createElement(\"div\");if(cls)e.className=cls;if(txt!==undefined)e.textContent=String(txt);return e}\nfunction number(x,def){var n=Number(x);return Number.isFinite(n)?n:(def||0)}\nfunction sign(x){return String(x==null?\"\":x).trim()}\nfunction ids(v){return(Array.isArray(v)?v:[]).map(sign)}\nfunction chooseRows(p){var a=Array.isArray(p.operations)?p.operations:[],b=Array.isArray(p.generic_operations)?p.generic_operations:[];return a.some(function(o){return o&&o.is_setup===true})?a:(b.length?b:a)}\nfunction tint(key){var s=sign(key),n=0;for(var i=0;i<s.length;i++)n=(n*31+s.charCodeAt(i))>>>0;return palette[n%palette.length]}\nfunction clock(start,m){var d=new Date(start);if(isNaN(d.getTime()))return \"+\"+Math.floor(m/60)+\" ч\";d=new Date(d.getTime()+m*60000);return String(d.getDate()).padStart(2,\"0\")+\".\"+String(d.getMonth()+1).padStart(2,\"0\")+\" \"+String(d.getHours()).padStart(2,\"0\")+\":\"+String(d.getMinutes()).padStart(2,\"0\")}\nfunction draw(p){\nif(!p||typeof p!==\"object\")return;\nvar equipment=(typeof model!==\"undefined\"&&model)?((model.equipment&&model.equipment.length)?model.equipment:(model.autoclaves||[])):[];\nvar ops=chooseRows(p).filter(function(o){return o&&number(o.end_min)>number(o.start_min)});\nif(!equipment.length||!ops.length){stage.hidden=true;legacy.style.removeProperty(\"display\");return}\nlast=p;\nvar duration=Math.max(number(p.duration_minutes),ops.reduce(function(a,o){return Math.max(a,number(o.end_min))},0));\nvar maxMinutes=Math.max(1440,Math.ceil((duration+180)/240)*240);\nvar px=0.62*scale,width=Math.round(px*maxMinutes);\nvar frag=document.createDocumentFragment(),axis=node(\"pg2-axis\"),axisName=node(\"pg2-name\",\"Оборудование\"),axisTrack=node(\"pg2-axis-track\");\naxisTrack.style.width=width+\"px\";\nfor(var t=0;t<=maxMinutes;t+=240){var tick=node(\"pg2-tick\"),strong=node(\"\",\"\"+clock(p.start,t)),hint=node(\"\",\"+\"+Math.round(t/60)+\" ч\");tick.style.left=Math.round(px*t)+\"px\";strong.style.fontWeight=\"750\";hint.style.color=\"#8291a7\";hint.style.fontSize=\"10px\";hint.style.display=\"block\";tick.append(strong,hint);axisTrack.appendChild(tick)}\naxis.append(axisName,axisTrack);frag.appendChild(axis);\nvar setupCount=0;\nequipment.forEach(function(eq,i){\n var row=node(\"pg2-row\"),name=node(\"pg2-name\"),nr=node(\"pg2-number\",i+1),info=node(\"\"),title=node(\"pg2-title\",eq.name||eq.id||(\"Оборудование \"+(i+1))),sub=node(\"pg2-sub\",eq.kind||eq.capacity_unit||((eq.capacity||\"\")?\"Объём \"+eq.capacity:\"\"));\n info.append(title,sub);name.append(nr,info);\n var lane=node(\"pg2-lane\");lane.style.width=width+\"px\";\n for(var t=0;t<=maxMinutes;t+=240){var grid=node(\"pg2-grid\"+(t%1440===0?\" pg2-day\":\"\"));grid.style.left=Math.round(t*px)+\"px\";lane.appendChild(grid)}\n var local=ops.filter(function(o){var ids1=ids(o.equipment_ids);if(!ids1.length&&Array.isArray(o.resources))ids1=o.resources.filter(function(r){return r&&r.resource_type===\"equipment\"}).map(function(r){return sign(r.id)});\n return ids1.includes(sign(eq.id))||ids1.includes(sign(eq.name))});\n local.forEach(function(o){\n  var start=number(o.start_min),end=number(o.end_min),isSetup=o.is_setup===true||/переналад/i.test(sign(o.operation_name||o.name)),bar=node(\"pg2-bar\"+(isSetup?\" pg2-setup\":\"\"));\n  if(isSetup)setupCount++;\n  bar.style.left=Math.round(px*start)+\"px\";bar.style.width=Math.max(2,Math.round(px*(end-start)))+\"px\";\n  if(!isSetup)bar.style.background=tint(o.order||o.operation_id||o.operation_name);\n  var opName=sign(o.operation_name||o.name||(isSetup?\"Переналадка\":\"Операция\"));\n  var label=isSetup?\"Переналадка\":(sign(o.order)?(\"З\"+sign(o.order)):opName);\n  if(end-start>80/px)bar.textContent=label;else if(!isSetup&&end-start>30/px)bar.textContent=sign(o.order);\n  var desc=(isSetup?\"Переналадка · \":\"\")+opName+\" · \"+(o.order?\"Заказ \"+o.order+\" · \":\"\")+(o.batch?\"Партия \"+o.batch+\" · \":\"\")+clock(p.start,start)+\" — \"+clock(p.start,end)+\" · \"+Math.round(end-start)+\" мин\";\n  bar.title=desc;bar.setAttribute(\"aria-label\",desc);bar.tabIndex=0;\n  lane.appendChild(bar);\n });row.append(name,lane);frag.appendChild(row)\n});\nif(Array.isArray(p.blocked_orders))p.blocked_orders.forEach(function(o){\n var row=node(\"pg2-row\"),name=node(\"pg2-name\",\"Заказ \"+sign(o.order)),lane=node(\"pg2-lane\");lane.style.width=width+\"px\";\n var b=node(\"pg2-bar pg2-blocked\",\"Ожидание материала\");b.style.left=\"8px\";b.style.width=\"250px\";b.title=JSON.stringify((o.materials||[]).map(function(m){return m.name||m.id}));lane.appendChild(b);row.append(name,lane);frag.appendChild(row)\n});\nvar footer=node(\"pg2-footer\"),legend=node(\"\");legend.innerHTML='<span class=\"pg2-key\"></span> Переналадка — отдельная операция';var status=node(\"\",ops.length+\" операций · \"+setupCount+\" переналадок · масштаб \"+Math.round(scale*100)+\"%\");\nfooter.append(legend,status);frag.appendChild(footer);\nstage.replaceChildren(frag);stage.hidden=false;legacy.style.setProperty(\"display\",\"none\",\"important\");\nwindow.__PP_GANTT_TOOL_V2__={version:version,operations:ops.length,setups:setupCount,zoom:scale};\n}\nvar originalRender=renderPlan;\nrenderPlan=function(p){var result=originalRender.apply(this,arguments);try{draw(p)}catch(err){console.error(\"PP_GANTT_COMPONENT_DRAW\",err);stage.hidden=true;legacy.style.removeProperty(\"display\")}return result};\nif(typeof clearPlan===\"function\"){var originalClear=clearPlan;clearPlan=function(){last=null;stage.hidden=true;legacy.style.removeProperty(\"display\");return originalClear.apply(this,arguments)}}\nfunction zoomTo(v){scale=Math.max(.5,Math.min(2.5,Math.round(v*100)/100));var label=document.getElementById(\"zoomLabel\");if(label)label.textContent=Math.round(scale*100)+\"%\";if(last)draw(last)}\n[[\"zoomIn\",.25],[\"zoomOut\",-.25],[\"zoomLabel\",0]].forEach(function(spec){var b=document.getElementById(spec[0]);if(!b)return;\n b.addEventListener(\"click\",function(ev){if(stage.hidden)return;ev.preventDefault();ev.stopImmediatePropagation();zoomTo(spec[1]===0?1:scale+spec[1])},true)});\nif(window.__ppTabPlan)try{draw(window.__ppTabPlan)}catch(e){console.warn(\"PP_GANTT_BOOT_RESTORE\",e)}\nwindow.__PP_GANTT_TOOL_V2_INSTALLED__=true;\nconsole.log(\"PP_GANTT_TOOL_V2_READY\",version);\n})();\n</script>";
const PP_SECONDARY_GANTTS_INLINE="\n<style id=\"pp3-secondary-gantts-css\">\n#ppTabsView .pp3-card{position:relative;background:#fff;border:1px solid #dce6f2;border-radius:11px;overflow:hidden;color:#172948;font-family:Inter,system-ui,-apple-system,\"Segoe UI\",Arial,sans-serif;margin:0 0 12px}\n#ppTabsView .pp3-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 15px;background:#fff;border-bottom:1px solid #e6edf6;flex-wrap:wrap}\n#ppTabsView .pp3-head h3{margin:0!important;font-size:12px!important;font-weight:750!important;line-height:18px;color:#213850}\n#ppTabsView .pp3-summary{color:#788aa2;font-size:11px;margin-left:10px;font-weight:450}\n#ppTabsView .pp3-zoom{display:flex;align-items:center;border:1px solid #dce6f2;border-radius:7px;overflow:hidden;background:#fff}\n#ppTabsView .pp3-zoom button{min-width:31px;height:28px;padding:0 8px;background:#fff;border:0;color:#344d70;cursor:pointer;font-weight:700;font-size:12px}\n#ppTabsView .pp3-zoom button:hover{background:#edf4ff}\n#ppTabsView .pp3-zoom button:focus-visible{outline:2px solid #6d9bf1;outline-offset:-2px}\n#ppTabsView .pp3-zoom span{padding:0 8px;min-width:47px;text-align:center;font-size:11px;color:#446080;border-left:1px solid #e4eaf2;border-right:1px solid #e4eaf2;font-variant-numeric:tabular-nums}\n#ppTabsView .pp3-scroll{overflow:auto;max-height:685px;position:relative;width:100%}\n#ppTabsView .pp3-canvas{min-width:100%;width:max-content;position:relative}\n#ppTabsView .pp3-axis,#ppTabsView .pp3-row{display:flex;align-items:stretch;min-width:100%;box-sizing:border-box;margin:0!important}\n#ppTabsView .pp3-axis{min-height:54px;position:sticky;top:0;z-index:11;background:#f7faff;border-bottom:1px solid #dce5f1}\n#ppTabsView .pp3-row{height:54px;border-bottom:1px solid #e7edf5}\n#ppTabsView .pp3-label{width:218px;flex:0 0 218px;box-sizing:border-box;position:sticky;left:0;z-index:5;border-right:1px solid #dde5f1;background:#fff;padding:7px 11px;display:flex;align-items:center;gap:9px;box-shadow:2px 0 3px #1b2c4710}\n#ppTabsView .pp3-axis>.pp3-label{background:#f7faff;z-index:13;color:#556e8c;font-size:11px;font-weight:750}\n#ppTabsView .pp3-num{height:23px;width:23px;border-radius:7px;background:#edf4ff;color:#3274d6;display:grid;place-items:center;font-size:10px;font-weight:750;flex:0 0 23px}\n#ppTabsView .pp3-label-info{display:block;min-width:0;overflow:hidden}\n#ppTabsView .pp3-label-info b{display:block;font-size:11px;line-height:1.3;font-weight:750;color:#233a55;white-space:normal;max-height:30px;overflow:hidden}\n#ppTabsView .pp3-label-info small{display:block;font-size:10px;color:#8293a9;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:3px}\n#ppTabsView .pp3-axis-track,#ppTabsView .pp3-lane{position:relative;flex:none;box-sizing:border-box}\n#ppTabsView .pp3-axis-track{height:54px;background:#f7faff}\n#ppTabsView .pp3-lane{height:53px;background:#fff}\n#ppTabsView .pp3-row:nth-child(even) .pp3-lane{background:#fcfdff}\n#ppTabsView .pp3-tick{position:absolute;top:0;bottom:0;padding:5px 4px;white-space:nowrap;border-left:1px solid #dce6f2;font-size:11px;color:#446080;pointer-events:none}\n#ppTabsView .pp3-tick b{display:block;font-weight:750;font-size:11px;line-height:16px}\n#ppTabsView .pp3-tick small{display:block;color:#8393a8;font-size:10px}\n#ppTabsView .pp3-grid{position:absolute;top:0;bottom:0;border-left:1px solid #edf2f8;pointer-events:none}\n#ppTabsView .pp3-grid.pp3-day{border-left-color:#c7d8ee}\n#ppTabsView .pp3-bar{position:absolute;top:11px;height:30px;min-width:3px;border-radius:5px;border:1px solid #14254328;color:#fff;white-space:nowrap;overflow:hidden;font-weight:700;font-size:10px;display:flex;align-items:center;padding:0 5px;box-sizing:border-box;cursor:help;box-shadow:0 1px 2px #112c4d14}\n#ppTabsView .pp3-bar:hover,#ppTabsView .pp3-bar:focus{outline:2px solid #6b9ef3;outline-offset:1px;z-index:4;filter:brightness(.92)}\n#ppTabsView .pp3-bar.pp3-setup{background:#141e2e!important;border-color:#0d1420!important;color:#fff;z-index:2}\n#ppTabsView .pp3-bar.pp3-delivery{background:#299d71!important;border-color:#1a815b!important;min-width:9px;z-index:2}\n#ppTabsView .pp3-bar.pp3-consumption{background:#d3a044!important;border-color:#b98a2c!important;min-width:9px;z-index:2}\n#ppTabsView .pp3-footer{border-top:1px solid #e4edf7;background:#f9fbfe;padding:9px 13px;display:flex;gap:16px;align-items:center;flex-wrap:wrap;color:#546985;font-size:11px}\n#ppTabsView .pp3-dot{display:inline-block;width:10px;height:10px;border-radius:3px;background:#141e2e;vertical-align:-1px;margin-right:4px}\n#ppTabsView .pp3-empty{padding:30px 18px;color:#657b99;text-align:center;font-size:12px}\n#ppTabsView .pp3-card+.ppcards{margin-top:8px}\n</style>\n\n<script id=\"pp3-secondary-gantts-js\">\n(function(){\n\"use strict\";\nif(window.__PP_SECONDARY_GANTTS_V3__)return;\nvar view=document.getElementById(\"ppTabsView\"),tabs=document.querySelector(\".tabs\");\nif(!view||!tabs||typeof model===\"undefined\"){console.warn(\"PP_SECONDARY_GANTTS_NO_TARGET\");return}\nvar VER=\"secondary-gantts-v3.1-employee-fix-20261009\",z={1:1,2:1,3:1},mounting=false,scheduled=false;\nvar colors=[\"#4d8ffa\",\"#25aea3\",\"#9272dd\",\"#e6ab34\",\"#e56e96\",\"#16a9cf\",\"#58a769\",\"#8d9cc9\"];\nvar make=(tag,cls,txt)=>{var n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=String(txt);return n};\nfunction str(x){return String(x==null?\"\":x).trim()}\nfunction num(x,d){var v=Number(x);return Number.isFinite(v)?v:(d||0)}\nfunction normId(x){return str(x).replace(/^__ppb__(.+?)__\\d+$/,\"$1\")}\nfunction orderId(o){var v=normId(o.order??o.order_id??\"\");if(!v&&o.batch_id)v=str(o.batch_id).split(\".\")[0];return v}\nfunction hash(k){var n=0,s=str(k);for(var i=0;i<s.length;i++)n=(n*31+s.charCodeAt(i))>>>0;return colors[n%colors.length]}\nfunction opsOf(p){var a=Array.isArray(p.operations)?p.operations:[],b=Array.isArray(p.generic_operations)?p.generic_operations:[];return (a.some(x=>x&&x.is_setup===true)?a:(b.length?b:a)).filter(x=>x&&num(x.end_min)>num(x.start_min))}\nfunction assigned(o,kind){var idField=kind===\"employee\"?\"employee_ids\":\"equipment_ids\",array=Array.isArray(o[idField])?o[idField]:[];if(!array.length&&kind===\"employee\"&&o.employee_id!=null)array=[o.employee_id];if(!array.length&&Array.isArray(o.resources))array=o.resources.filter(r=>r&&r.resource_type===kind).map(r=>r.id);return array.map(str)}\nfunction isSetup(o){return o.is_setup===true||/переналад/i.test(str(o.operation_name||o.name))}\nfunction dateClock(p,m){var d=new Date(p.start);if(isNaN(d.getTime()))return \"Д\"+(Math.floor(m/1440)+1)+\" \"+String(Math.floor(m%1440/60)).padStart(2,\"0\")+\":\"+String(Math.floor(m%60)).padStart(2,\"0\");d=new Date(d.getTime()+m*60000);return String(d.getDate()).padStart(2,\"0\")+\".\"+String(d.getMonth()+1).padStart(2,\"0\")+\" \"+String(d.getHours()).padStart(2,\"0\")+\":\"+String(d.getMinutes()).padStart(2,\"0\")}\nfunction getActive(){var t=[...tabs.querySelectorAll(\":scope>div\")];return t.findIndex(x=>x.classList.contains(\"a\"))}\nfunction getPlan(){if(window.__ppTabPlan&&typeof window.__ppTabPlan===\"object\")return window.__ppTabPlan;if(window.__ppManualPlan&&typeof window.__ppManualPlan===\"object\")return window.__ppManualPlan;try{var aid=localStorage.getItem(\"prodplan.project.active.v2\"),list=JSON.parse(localStorage.getItem(\"prodplan.projects.v2\")||\"[]\");var q=list.find(x=>x.id===aid);if(q&&q.lastPlan)return q.lastPlan}catch(e){}return null}\nfunction startRelative(p,at){var epoch=Date.parse(at||\"\");var zero=Date.parse(p.start||\"\");return Number.isFinite(epoch)&&Number.isFinite(zero)?(epoch-zero)/60000:NaN}\nfunction row(label,sub,events){return{label:label,sub:sub,events:events||[]}}\nfunction employeeRows(m,p,ops){return (m.employees||[]).map(function(e){var ee=ops.filter(o=>assigned(o,\"employee\").includes(str(e.id))||assigned(o,\"employee\").includes(str(e.name)));return row(str(e.name||e.id||\"Сотрудник\"),[str(e.role||\"Оператор\"),str(e.shift||\"\")].filter(Boolean).join(\" · \"),ee.map(x=>({start:num(x.start_min),end:num(x.end_min),op:x})))})}\nfunction orderRows(m,p,ops){\nvar result=[],orders=m.orders||[];\norders.forEach(function(o){\n var id=str(o.id),local=ops.filter(x=>orderId(x)===id),map=new Map();\n local.forEach(function(op){var key=str(op.batch_id||(id+\".\"+(op.batch??op.batch_index??1)));if(!map.has(key))map.set(key,[]);map.get(key).push(op)});\n if(!map.size){result.push(row(\"Заказ \"+id,str(o.quantity||o.area||\"\")+\" \"+str(o.unit||m.quantity_unit||\"\"),[]));return}\n [...map.entries()].sort((a,b)=>{var x=num(a[1][0]?.start_min),y=num(b[1][0]?.start_min);return x-y}).forEach(function(pair){\n var label=pair[0].startsWith(id+\".\")?\"Заказ \"+pair[0]:\"Заказ \"+id+\" · \"+pair[0],first=pair[1][0],sub=\"Партия \"+str(first.batch||1),amount=first.batch_quantity||first.quantity||null;\n if(amount)sub+=\" · \"+amount+\" \"+str(o.unit||m.quantity_unit||\"\");\n result.push(row(label,sub,pair[1].map(x=>({start:num(x.start_min),end:num(x.end_min),op:x}))));\n });\n});\nreturn result\n}\nfunction materialsOf(m){\nvar items=Array.isArray(m.materials)&&m.materials.length?m.materials:(m.material?[m.material]:[]);\nreturn items.filter(Boolean)\n}\nfunction materialRows(m,p,ops){\nvar materials=materialsOf(m),orders=m.orders||[],batches=Array.isArray(p.batches)?p.batches:[];\nreturn materials.map(function(mat){\n var id=str(mat.id||mat.name||\"Материал\"),unit=str(mat.unit||\"кг\"),initial=(mat.initial_stock??mat.initial_stock_kg),events=[];\n var deliveries=Array.isArray(mat.deliveries)?mat.deliveries:((mat.delivery_at||mat.delivery_kg)?[{at:mat.delivery_at,quantity:mat.delivery_kg}]:[]);\n deliveries.forEach(function(d){var at=startRelative(p,d.at||d.delivery_at);if(!Number.isFinite(at)||at<0)return;events.push({start:at,end:at,kind:\"delivery\",caption:\"Поставка\",desc:\"Поставка · \"+str(mat.name||id)+\" · \"+(d.quantity??d.delivery_kg??\"—\")+\" \"+unit+\" · \"+dateClock(p,at)})});\n ops.forEach(function(o){var resources=Array.isArray(o.resources)?o.resources:[];resources.filter(r=>r&&r.resource_type===\"material\"&&(str(r.id)===id||str(r.name)===str(mat.name))).forEach(function(r){events.push({start:num(o.start_min),end:num(o.start_min),kind:\"consumption\",caption:\"Расход\",desc:\"Расход · \"+str(mat.name||id)+(r.quantity!=null?\" · \"+r.quantity+\" \"+unit:\"\")+\" · Заказ \"+orderId(o)+\" · \"+dateClock(p,num(o.start_min))})})});\n if(!events.some(e=>e.kind===\"consumption\")){batches.forEach(function(b){\n var oid=str(b.order??b.order_id),ord=orders.find(o=>str(o.id)===oid);\n var mapped=(ord&&str(ord.material_id)===id)||(Array.isArray(mat.order_ids)&&mat.order_ids.map(str).includes(oid));\n if(!mapped)return;\n var st=num(b.start_min),qty=(b.material_kg??null),v=qty!=null?qty:((b.quantity??b.area)!=null&&mat.consumption_per_unit!=null?num(b.quantity??b.area)*num(mat.consumption_per_unit):null);\n events.push({start:st,end:st,kind:\"consumption\",caption:\"Расход\",desc:\"Расход · \"+str(mat.name||id)+(v!=null?\" · \"+Math.round(v*100)/100+\" \"+unit:\"\")+\" · Заказ \"+oid+\" · \"+dateClock(p,st)})\n }) }\n var s=initial!=null?\"Остаток: \"+initial+\" \"+unit:\"Ед.: \"+unit;\n return row(str(mat.name||id),s,events.sort((a,b)=>a.start-b.start))\n})\n}\nfunction chart(mode,m,p){\nvar ops=opsOf(p),rows=mode===1?employeeRows(m,p,ops):(mode===3?orderRows(m,p,ops):materialRows(m,p,ops));\nvar title=mode===1?\"Гант сотрудников\":mode===2?\"Гант материалов\":\"Гант заказов\",scale=z[mode],max=Math.max(num(p.duration_minutes),...ops.map(x=>num(x.end_min)),1440);\nvar range=Math.max(1440,Math.ceil((max+180)/240)*240),px=.62*scale,width=Math.max(790,Math.ceil(range*px));\nvar outer=make(\"div\",\"pp3-card\");outer.dataset.pp3Gantt=String(mode);\nvar head=make(\"div\",\"pp3-head\"),left=make(\"div\",\"\"),heading=make(\"h3\",\"\",title),stats=make(\"span\",\"pp3-summary\",rows.length+\" строк · \"+(mode===2?\"поставки и расход\":ops.length+\" операций\"));\nleft.append(heading,stats);\nvar zoom=make(\"div\",\"pp3-zoom\"),minus=make(\"button\",\"\",\"−\"),value=make(\"span\",\"\",Math.round(scale*100)+\"%\"),plus=make(\"button\",\"\",\"+\");\nminus.type=\"button\";plus.type=\"button\";minus.setAttribute(\"aria-label\",\"Уменьшить масштаб\");plus.setAttribute(\"aria-label\",\"Увеличить масштаб\");\nzoom.append(minus,value,plus);head.append(left,zoom);outer.appendChild(head);\nvar scroll=make(\"div\",\"pp3-scroll\"),canvas=make(\"div\",\"pp3-canvas\");\nif(!rows.length){scroll.appendChild(make(\"div\",\"pp3-empty\",mode===2?\"Для этого производства материалы не заданы. Добавьте материалы в разделе производства.\":\"Для этого раздела ещё нет данных.\"));outer.appendChild(scroll);minus.disabled=true;plus.disabled=true;minus.title=\"Нет операций для масштабирования\";plus.title=\"Нет операций для масштабирования\";window.__PP_SECONDARY_GANTTS_V3__.last={mode:mode,rows:0,ops:0,setups:0,materials:materialsOf(m).length,deliveries:0,consumptions:0,scale:z[mode]};return outer}\nvar axis=make(\"div\",\"pp3-axis\"),axlabel=make(\"div\",\"pp3-label\",\"Ресурс / время\"),track=make(\"div\",\"pp3-axis-track\");track.style.width=width+\"px\";\nfor(var t=0;t<=range;t+=240){var tick=make(\"div\",\"pp3-tick\"),a=make(\"b\",\"\",dateClock(p,t)),b=make(\"small\",\"\",(\"+\"+Math.round(t/60)+\" ч\"));tick.style.left=Math.round(t*px)+\"px\";tick.append(a,b);track.appendChild(tick)}\naxis.append(axlabel,track);canvas.appendChild(axis);\nvar opCount=0,setupCount=0,deliveries=0,consumptions=0;\nrows.forEach(function(r,i){var line=make(\"div\",\"pp3-row\"),label=make(\"div\",\"pp3-label\"),number=make(\"span\",\"pp3-num\",i+1),info=make(\"span\",\"pp3-label-info\"),main=make(\"b\",\"\",r.label),sub=make(\"small\",\"\",r.sub);info.append(main,sub);label.append(number,info);\nvar lane=make(\"div\",\"pp3-lane\");lane.style.width=width+\"px\";\nfor(var t=0;t<=range;t+=240){var grid=make(\"div\",\"pp3-grid\"+(t%1440===0?\" pp3-day\":\"\"));grid.style.left=Math.round(t*px)+\"px\";lane.appendChild(grid)}\nr.events.forEach(function(e){\nvar st=num(e.start),en=num(e.end),material=e.kind===\"delivery\"||e.kind===\"consumption\",setup=!material&&isSetup(e.op||{});\nvar bar=make(\"div\",\"pp3-bar\"+(setup?\" pp3-setup\":\"\")+(material?\" pp3-\"+e.kind:\"\"));\nbar.style.left=Math.round(st*px)+\"px\";bar.style.width=(material?Math.max(9,Math.round(12*scale)):Math.max(3,Math.round(Math.max(0,en-st)*px)))+\"px\";\nif(material){if(e.kind===\"delivery\")deliveries++;else consumptions++}\nelse{opCount++;if(setup)setupCount++;bar.style.background=hash(orderId(e.op)||e.op.operation_id||e.op.operation_name);\nif((en-st)*px>64)bar.textContent=setup?\"Переналадка\":\"З\"+orderId(e.op)}\nbar.title=material?e.desc:[str(e.op.operation_name||e.op.name||(setup?\"Переналадка\":\"Операция\")),orderId(e.op)?\"Заказ \"+orderId(e.op):\"\",e.op.batch?\"Партия \"+e.op.batch:\"\",dateClock(p,st)+\" — \"+dateClock(p,en),Math.round(en-st)+\" мин\"].filter(Boolean).join(\" · \");\nbar.setAttribute(\"aria-label\",bar.title);bar.tabIndex=0;lane.appendChild(bar)\n});line.append(label,lane);canvas.appendChild(line)\n});\nscroll.appendChild(canvas);outer.appendChild(scroll);\nvar footer=make(\"div\",\"pp3-footer\");\nif(mode===2){var legend=make(\"span\",\"\");legend.innerHTML='<span class=\"pp3-dot\" style=\"background:#299d71\"></span> Поставка　<span class=\"pp3-dot\" style=\"background:#d3a044\"></span> Расход';footer.append(legend,make(\"span\",\"\",deliveries+\" поставок · \"+consumptions+\" событий расхода\"))}\nelse{var legend=make(\"span\",\"\");legend.innerHTML='<span class=\"pp3-dot\"></span> Переналадка — отдельная операция';footer.append(legend,make(\"span\",\"\",opCount+\" операций · \"+setupCount+\" переналадок\"))}\nfooter.appendChild(make(\"span\",\"\",Math.round(scale*100)+\"%\"));outer.appendChild(footer);\nfunction zoomTo(n){z[mode]=Math.min(2.5,Math.max(.5,Math.round(n*100)/100));var pos=scroll.scrollLeft;var next=chart(mode,m,p);outer.replaceWith(next);var nextScroll=next.querySelector(\".pp3-scroll\");if(nextScroll)nextScroll.scrollLeft=pos}\nminus.addEventListener(\"click\",function(e){e.preventDefault();e.stopPropagation();zoomTo(z[mode]-.25)});\nplus.addEventListener(\"click\",function(e){e.preventDefault();e.stopPropagation();zoomTo(z[mode]+.25)});\nwindow.__PP_SECONDARY_GANTTS_V3__.last={mode:mode,rows:rows.length,ops:opCount,setups:setupCount,materials:materialsOf(m).length,deliveries:deliveries,consumptions:consumptions,scale:z[mode]};\nreturn outer\n}\nfunction upgrade(){\nif(mounting)return;\nvar mode=getActive();if(mode!==1&&mode!==2&&mode!==3)return;\nvar p=getPlan(),m=model;if(!p||!m)return;\nvar existing=view.querySelector(\"[data-pp3-gantt]\");\nif(existing&&Number(existing.dataset.pp3Gantt)===mode)return;\nvar old=view.querySelector(\".ppt.ppTabGantt\");\nif(mode!==2&&!old&&!existing)return;\nmounting=true;attempts++;lastMode=mode;\ntry{\nvar panel=chart(mode,m,p);\nif(mode===2&&view.querySelector(\".ppcards\")){if(existing)existing.replaceWith(panel);else view.insertBefore(panel,view.firstChild)}\nelse{view.replaceChildren(panel)}\nlastFailure=\"\";\n}catch(e){lastFailure=String(e&&e.stack||e);console.error(\"PP_SECONDARY_GANTT_FAILED\",e)}\nfinally{mounting=false}\n}\nvar attempts=0,lastFailure=\"\",lastMode=-1;\nfunction requestUpgrade(){\n if(scheduled)return;\n scheduled=true;\n queueMicrotask(function(){scheduled=false;upgrade()})\n}\nvar observer=new MutationObserver(function(){if(mounting)return;requestUpgrade()});\nobserver.observe(view,{childList:true});\nobserver.observe(tabs,{subtree:true,attributes:true,attributeFilter:[\"class\"]});\nfunction delayedUpgrade(){\n requestUpgrade();\n setTimeout(upgrade,0);\n setTimeout(upgrade,90);\n setTimeout(upgrade,300);\n}\ntabs.addEventListener(\"click\",delayedUpgrade,true);\ntabs.addEventListener(\"pointerup\",delayedUpgrade,true);\nwindow.addEventListener(\"popstate\",delayedUpgrade);\nsetInterval(function(){\n var mode=getActive(), old=!!view.querySelector(\".ppt.ppTabGantt\"),current=view.querySelector(\"[data-pp3-gantt]\");\n if((mode===1||mode===2||mode===3)&&((old&&!current)||(mode===2&&!current))){upgrade()}\n},900);\nwindow.__PP_SECONDARY_GANTTS_V3__={version:VER,installed:true,last:null,update:upgrade,renderMode:function(mode,plan){return chart(mode,model,plan)},diagnose:function(){return{tab:getActive(),oldEmployee:!!view.querySelector(\".ppt.ppTabGantt\"),newGantt:!!view.querySelector(\"[data-pp3-gantt]\"),newGanttMode:view.querySelector(\"[data-pp3-gantt]\")?.dataset.pp3Gantt,attempts:attempts,lastFailure:lastFailure}}};\nvar prevRefresh=window.__ppTabsRefresh;\nif(typeof prevRefresh===\"function\")window.__ppTabsRefresh=function(){var res=prevRefresh.apply(this,arguments);delayedUpgrade();return res};\nupgrade();\nconsole.log(\"PP_SECONDARY_GANTTS_V3_READY\",VER);\n})();\n</script>";
function ppOptimizerNoRegressionHtml(input){
let html=input,checks=[];
const a=html.indexOf("function ppIncumbentDecision(a,b){"),b=html.indexOf("function ppIncumbentRejectText(d){",a);
if(a<0||b<=a||!html.slice(a,b).includes("duration_minutes"))throw Error("PP_OPT_ETALON_DECISION_ANCHOR_MISSING");
html=html.slice(0,a)+"function ppIncumbentDecision(a,b){\n if(!a||!b)return{accept:true};\n if(a.valid===false)return{accept:false,reason:'invalid'};\n if(a.partial&&!b.partial)return{accept:false,reason:'partial'};\n const n=x=>Number(x),epsilon=0.01;\n const objectives={duration:'duration_minutes',wait:'operator_wait_minutes',idle:'machine_idle_minutes',cycles:'batch_count'};\n const currentObjective=window.__ppOptimizerObjectiveAtStart||(typeof window.ppOptimizerObjective==='function'?window.ppOptimizerObjective():null)||(model&&model.objective)||'duration';\n const selected=objectives[currentObjective]||'duration_minutes';\n const labels={duration_minutes:'длительность',batch_count:'циклы',operator_wait_minutes:'ожидание оператора',machine_idle_minutes:'простой оборудования'};\n const x=n(a[selected]),y=n(b[selected]);\n if(!Number.isFinite(x)||!Number.isFinite(y))return{accept:false,reason:'invalid'};\n if(x>y+epsilon)return{accept:false,reason:'worse',worse:[labels[selected]]};\n if(x<y-epsilon)return{accept:true};\n const other=Object.keys(labels).filter(k=>k!==selected),w=[],better=[];\n for(const k of other){const av=n(a[k]),bv=n(b[k]);if(!Number.isFinite(av)||!Number.isFinite(bv))continue;if(av>bv+epsilon)w.push(labels[k]);if(av<bv-epsilon)better.push(k)}\n if(w.length)return{accept:false,reason:'worse',worse:w};\n return better.length?{accept:true}:{accept:false,reason:'equal',worse:[]};\n}"+"\n"+html.slice(b);
for(const pair of [["const cont=hasResult;opt.textContent=","const cont=hasResult;const ppOriginal=cont?ppIncumbentCurrentPlan():null;const ppInc=ppOriginal?JSON.parse(JSON.stringify(ppOriginal)):null;window.__ppOptimizerCommittedPlan=ppInc;window.__ppOptimizerObjectiveAtStart=(typeof window.ppOptimizerObjective==='function'?window.ppOptimizerObjective():(model&&model.objective)||'duration');window.__ppOptimizationInFlight=true;opt.textContent="],["const ppInc=cont?ppIncumbentCurrentPlan():null,ppDec=cont&&ppInc?ppIncumbentDecision(d,ppInc):{accept:true};","const ppDec=cont&&ppInc?ppIncumbentDecision(d,ppInc):{accept:true};"],["if(!ppDec.accept){const ppMsg=","if(!ppDec.accept){if(ppInc){window.__ppOptimizerCommittedPlan=ppInc;renderPlan(ppInc);renderKpisWithDelta(ppInc)}const ppMsg="],["renderPlan(d);renderKpisWithDelta(d);if(d.partial)","window.__ppOptimizerCommittedPlan=d;renderPlan(d);renderKpisWithDelta(d);if(d.partial)"],["}finally{busy=false;opt.disabled=false;opt.textContent=","}finally{window.__ppOptimizationInFlight=false;busy=false;opt.disabled=false;opt.textContent="],["function clearPlan(){q('ganttContent')","function clearPlan(){window.__ppOptimizerCommittedPlan=null;window.__ppOptimizationInFlight=false;q('ganttContent')"],["window.__ppTabPlan=p;window.__ppGenericPlan=p;","const ppShownCommitted=window.__ppOptimizerCommittedPlan;const ppPreviewWas=typeof previousKpiMetrics==='undefined'?undefined:(previousKpiMetrics?{...previousKpiMetrics}:null);if(!window.__ppOptimizationInFlight&&ppShownCommitted)p=ppShownCommitted;window.__ppTabPlan=p;window.__ppGenericPlan=p;"],["else if(typeof window.renderKpisWithDelta==='function')window.renderKpisWithDelta(p);\n     let a=","else if(typeof window.renderKpisWithDelta==='function')window.renderKpisWithDelta(p);\n     if(window.__ppOptimizationInFlight){if(ppShownCommitted){window.__ppTabPlan=ppShownCommitted;window.__ppGenericPlan=ppShownCommitted;}if(typeof previousKpiMetrics!=='undefined')previousKpiMetrics=ppPreviewWas}\n     let a="],["if(my===token&&best)show(best);","if(my===token){const committed=window.__ppOptimizerCommittedPlan;if(committed){if(typeof renderPlan==='function')renderPlan(committed);else if(typeof window.renderPlan==='function')window.renderPlan(committed);window.__ppTabPlan=committed;window.__ppGenericPlan=committed}}"]]){
  const count=html.split(pair[0]).length-1;
  if(count!==1)throw Error("PP_OPT_ETALON_REPLACEMENT_COUNT_"+checks.length+":"+count);
  html=html.replace(pair[0],pair[1]);checks.push(count)
}
// Isolate and patch only the existing live progress widget, not any other application UI.
const liveStart=html.indexOf('<script id="ppLivePanelV2">'),liveEnd=html.indexOf('</script>',liveStart);
if(liveStart<0||liveEnd<=liveStart)throw Error("PP_LIVE_PROGRESS_WIDGET_MISSING");
let live=html.slice(liveStart,liveEnd);
const changes=[
 ["let timer=null,token=0,mode='candidate',best=null,candidate=null;","let timer=null,token=0,mode='best',best=null,candidate=null;"],
 ["if(!p)return;\n   try{","if(!p)return;\n   const incumbent=window.__ppOptimizerCommittedPlan;\n   if(window.__ppOptimizationInFlight&&incumbent){\n     const goal=window.__ppOptimizerObjectiveAtStart||'duration';\n     const key=({duration:'duration_minutes',wait:'operator_wait_minutes',idle:'machine_idle_minutes',cycles:'batch_count'})[goal]||'duration_minutes';\n     const cv=Number(p[key]),bv=Number(incumbent[key]);\n     if(p.valid===false||(p.partial&&!incumbent.partial)||!Number.isFinite(cv)||!Number.isFinite(bv)||cv>=bv-0.01)p=incumbent;\n   }\n   try{"],
 ["let my=++token;best=null;candidate=null;mode='candidate';","let my=++token;best=null;candidate=null;mode='best';"],
 ["b.dataset.mode==='candidate'","b.dataset.mode==='best'"],
 ["if(my===token){const committed=window.__ppOptimizerCommittedPlan;if(committed){if(typeof renderPlan==='function')renderPlan(committed);else if(typeof window.renderPlan==='function')window.renderPlan(committed);window.__ppTabPlan=committed;window.__ppGenericPlan=committed}}",
 "if(my===token){token++;const committed=window.__ppOptimizerCommittedPlan;if(committed){if(typeof renderPlan==='function')renderPlan(committed);else if(typeof window.renderPlan==='function')window.renderPlan(committed);window.__ppTabPlan=committed;window.__ppGenericPlan=committed;if(typeof previousKpiMetrics!=='undefined'){previousKpiMetrics={duration:Number(committed.duration_minutes||0),cycles:Number(committed.batch_count||0),wait:Number(committed.operator_wait_minutes||0),idle:Number(committed.machine_idle_minutes||0)}}if(typeof renderKpisWithDelta==='function')renderKpisWithDelta(committed)}}"]
];
for(let k=0;k<changes.length;k++){
 const [a,b]=changes[k],count=live.split(a).length-1;
 if(count!==1)throw Error("PP_LIVE_MONOTONIC_PATCH_ANCHOR_"+k+"_COUNT_"+count);
 live=live.replace(a,b)
}
html=html.slice(0,liveStart)+live+html.slice(liveEnd);
const ppStatusUpdates=[
["q('valid').textContent='GA: улучшения нет';","q('valid').textContent='GA: запуск '+(d.optimization_run||'?')+' завершён';"],
["q('validator').textContent=ppMsg;q('meta').textContent=","q('validator').textContent=ppMsg+' Всего проверено '+(d.total_generations||0)+' поколений. Лучший план '+Math.round(Number(ppInc.duration_minutes))+' мин сохранён; следующая итерация продолжит поиск.';q('meta').textContent="]
];
for(const [from,to] of ppStatusUpdates){const count=html.split(from).length-1;if(count!==1)throw Error("PP_OPT_STATUS_PATCH_COUNT_"+count);html=html.replace(from,to)}
if(html===input||!html.includes("window.__ppOptimizerCommittedPlan=d"))throw Error("PP_OPT_ETALON_PATCH_EMPTY");
return html
}

function ppStrictOptimizerHtml(h){
 const changes=[
  [
   "hasResult=false;opt.textContent='Запустить оптимизацию'\n }catch(e){clearPlan()}",
   "hasResult=!!(p.lastPlan&&p.lastPlan.valid!==false&&(p.lastPlan.operations||p.lastPlan.generic_operations||[]).length&&(!Number.isFinite(Number(p.lastPlan._revision))||Number(p.lastPlan._revision)===Number(p.revision)));opt.textContent=hasResult?'Продолжить оптимизацию':'Запустить оптимизацию';if(hasResult)window.__ppOptimizerCommittedPlan=p.lastPlan;\n }catch(e){clearPlan()}"
  ],
  [
   "function ppIncumbentCurrentPlan(){if(window.__ppTabPlan&&typeof window.__ppTabPlan==='object')return window.__ppTabPlan;if(window.__ppManualPlan&&typeof window.__ppManualPlan==='object')return window.__ppManualPlan;try{const id=localStorage.getItem('prodplan.project.active.v2'),a=JSON.parse(localStorage.getItem('prodplan.projects.v2')||'[]'),p=a.find(x=>x&&x.id===id);return p&&p.lastPlan?p.lastPlan:null}catch(e){return null}}",
   "function ppIncumbentCurrentPlan(){let saved=null;try{const id=localStorage.getItem('prodplan.project.active.v2'),list=JSON.parse(localStorage.getItem('prodplan.projects.v2')||'[]'),pr=list.find(x=>x&&x.id===id);if(pr&&pr.lastPlan&&(!Number.isFinite(Number(pr.lastPlan._revision))||Number(pr.lastPlan._revision)===Number(pr.revision)))saved=pr.lastPlan;}catch(e){}const manual=window.__ppManualPlan;const shown=window.__ppTabPlan;const locked=manual&&(manual.operations||manual.generic_operations||[]).some(x=>x&&x.manual_locked);if(locked)return manual;const candidates=[shown,saved].filter(x=>x&&x.valid!==false&&Number.isFinite(Number(x.duration_minutes))&&Number(x.duration_minutes)>=0&&(x.operations||x.generic_operations||[]).length);if(!candidates.length)return null;const goal=(typeof window.ppOptimizerObjective==='function'?window.ppOptimizerObjective():null)||(model&&model.objective)||'duration';const key=({duration:'duration_minutes',wait:'operator_wait_minutes',idle:'machine_idle_minutes',cycles:'batch_count'})[goal]||'duration_minutes';return candidates.reduce((a,b)=>Number(b[key])<Number(a[key])-0.01?b:a)}"
  ],
  [
   "const cont=hasResult;const ppOriginal=cont?ppIncumbentCurrentPlan():null;",
   "const ppOriginal=ppIncumbentCurrentPlan();const cont=hasResult||!!ppOriginal;"
  ],
  [
   "function clearPlan(){window.__ppOptimizerCommittedPlan=null;window.__ppOptimizationInFlight=false;q('ganttContent')",
   "function clearPlan(){window.__ppOptimizerCommittedPlan=null;window.__ppOptimizationInFlight=false;window.__ppTabPlan=null;window.__ppGenericPlan=null;window.__ppManualPlan=null;q('ganttContent')"
  ],
  [
   "window.ppProjectAfterPlan=function(d){\n const id=active();if(!id)return;\n mutate(id,x=>{",
   "window.ppProjectAfterPlan=function(d){\n const id=active();if(!id)return;\n const entry=find(id),prev=entry&&entry.lastPlan,goal=window.__ppOptimizerObjectiveAtStart||(typeof window.ppOptimizerObjective==='function'?window.ppOptimizerObjective():null)||(model&&model.objective)||'duration';\n const key=({duration:'duration_minutes',wait:'operator_wait_minutes',idle:'machine_idle_minutes',cycles:'batch_count'})[goal]||'duration_minutes';\n if(prev&&prev.valid!==false&&Number(prev._revision??entry.revision)===Number(entry.revision)&&d&&(!d.ok||d.valid===false||(!prev.partial&&d.partial)||!(Number.isFinite(Number(d[key]))&&Number(d[key])>=0)||Number(d[key])>Number(prev[key])+0.01)){\n  window.__ppOptimizerCommittedPlan=prev;window.__ppTabPlan=prev;window.__ppGenericPlan=prev;\n  try{if(typeof renderPlan==='function')renderPlan(prev);if(typeof renderKpisWithDelta==='function')renderKpisWithDelta(prev)}catch(e){console.warn('PP_SAVE_GUARD_RESTORE',e)}\n  const note=document.getElementById('validator');if(note)note.textContent='Новый вариант отклонён: лучший сохранённый план не ухудшен.';\n  console.warn('PP_OPT_SAVE_REGRESSION_PREVENTED',String(prev.duration_minutes),String(d.duration_minutes));return;\n }\n mutate(id,x=>{"
  ]
 ];
 for(let i=0;i<changes.length;i++){const from=changes[i][0],to=changes[i][1];const n=h.split(from).length-1;if(n!==1)throw Error("PP_STRICT_OPT_ANCHOR_"+i+"_COUNT_"+n);h=h.replace(from,to)}
 return h
}


function ppLiveMotionHtml(html){
 const start=html.indexOf('<script id="ppLivePanelV2">'),end=html.indexOf('</script>',start);
 if(start<0||end<=start)throw Error("PP_MOTION_LIVE_SCRIPT_MISSING");
 let script=html.slice(start,end);
 const rep=(a,b,label)=>{const n=script.split(a).length-1;if(n!==1)throw Error("PP_MOTION_ANCHOR_"+label+"_COUNT_"+n);script=script.replace(a,b)};
 rep("let timer=null,token=0,mode='best',best=null,candidate=null;","let timer=null,token=0,mode='candidate',best=null,candidate=null;","initial");
 rep("let my=++token;best=null;candidate=null;mode='best';","let my=++token;best=null;candidate=null;mode='candidate';","run");
 rep("b.dataset.mode==='best'","b.dataset.mode==='candidate'","button");
 rep("if(window.__ppOptimizationInFlight&&incumbent){","if(window.__ppOptimizationInFlight&&incumbent&&mode==='best'){","clamp_only_best");
 rep("   try{\n     const ppShownCommitted=","   try{\n"+"\n     let note=document.getElementById('ppOptimizerCandidateStatus');\n     if(!note){const toolbar=document.querySelector('#planView .toolbar')||document.querySelector('.toolbar');if(toolbar){note=document.createElement('div');note.id='ppOptimizerCandidateStatus';note.setAttribute('role','status');note.style.cssText='display:none;padding:9px 12px;margin:8px 0;border:1px solid #b7cee9;border-radius:9px;background:#f1f7ff;color:#24436c;font:600 12px/1.5 system-ui,sans-serif;white-space:normal;';toolbar.insertAdjacentElement('afterend',note);}}\n     if(note&&window.__ppOptimizationInFlight){const now=Number(p.duration_minutes),saved=Number(incumbent?.duration_minutes);note.textContent=(mode==='candidate'?'Тестируемый вариант':'Лучший найденный')+': '+(Number.isFinite(now)?Math.round(now)+' мин':'—')+(Number.isFinite(saved)?' · Принятый план: '+Math.round(saved)+' мин':'')+' · Временный просмотр, не сохранён';note.style.display='block';}\n     window.__PP_LIVE_MOTION_STATE__={mode,previewDuration:p.duration_minutes,acceptedDuration:incumbent?.duration_minutes,running:!!window.__ppOptimizationInFlight,at:Date.now()};\n"+"     const ppShownCommitted=","show_badge");
 const reset="if(window.__ppOptimizationInFlight){if(ppShownCommitted){window.__ppTabPlan=ppShownCommitted;window.__ppGenericPlan=ppShownCommitted;}if(typeof previousKpiMetrics!=='undefined')previousKpiMetrics=ppPreviewWas}";
 rep(reset,"","move_restore");
 rep("else if(a&&typeof window.overrideSecondary==='function')window.overrideSecondary(a);","else if(a&&typeof window.overrideSecondary==='function')window.overrideSecondary(a);\n     "+reset,"restore_after_secondary");
 rep("if(my===token){token++;const committed=window.__ppOptimizerCommittedPlan;if(committed){","if(my===token){token++;const note=document.getElementById('ppOptimizerCandidateStatus');if(note)note.style.display='none';const committed=window.__ppOptimizerCommittedPlan;if(committed){","finish_hide");
 const result=html.slice(0,start)+script+html.slice(end);
 if(!result.includes("PP_LIVE_MOTION_STATE__")||result.includes("let my=++token;best=null;candidate=null;mode='best';"))throw Error("PP_MOTION_OUTPUT_INVALID");
 return result
}
function ppEquipmentEditorFixHtml(html){
  const head="  function equipmentRow(a,idx){";
  const pos=html.indexOf(head);
  if(pos<0||html.indexOf(head,pos+1)!==-1)throw Error("PP_EQUIP_EDITOR_FUNCTION_MISSING_OR_DUPLICATE");
  const selectOpen="'<td><select class=\"pp-edit-select\" data-f=\"kind\">";
  const selectEnd="</select></td>'+";
  const begin=html.indexOf(selectOpen,pos),end=html.indexOf(selectEnd,begin);
  if(begin<0||end<0||end-begin>850||!html.slice(begin,end).includes("a.kind"))throw Error("PP_EQUIP_EDITOR_LEGACY_OPTIONS_ANCHOR_MISSING");
  const old=html.slice(begin,end+selectEnd.length);
  const next="'<td><select class=\"pp-edit-select\" data-f=\"kind\">'+ppEquipmentKindOptions(a)+'</select></td>'+";
  html=html.slice(0,begin)+next+html.slice(end+selectEnd.length);
  html=html.slice(0,pos)+"  function ppEquipmentKindOptions(a){\n    const label={pressing:'Прессование',drying:'Сушка',glazing:'Глазурование',decoration:'Цифровая декорация',firing:'Обжиг',sorting:'Сортировка',packaging:'Упаковка',large:'Большой',small:'Малый',other:'Другой'};\n    const keys=[];\n    for(const e of (model.autoclaves||model.equipment||[]))if(e&&e.kind)keys.push(String(e.kind));\n    for(const tp of (model.technical_processes||[]))\n      for(const op of (tp.operations||[]))\n        for(const req of (op.resource_requirements||[])){\n          const ref=String(req.resource_ref||'');\n          if(req.resource_type==='equipment'&&ref.startsWith('kind:'))keys.push(ref.slice(5));\n        }\n    keys.push('pressing','drying','glazing','decoration','firing','sorting','packaging','large','small','other',String(a.kind||''));\n    return [...new Set(keys.filter(Boolean))].map(k=>'<option value=\"'+esc(k)+'\" '+(String(a.kind||'')===k?'selected':'')+'>'+esc(label[k]||k)+'</option>').join('');\n  }\n"+html.slice(pos);
  const baseOld="const idx=Number(r.dataset.idx),base=idx>=0?clone((model.autoclaves||[])[idx]||{}):{};";
  const baseNew="const idx=Number(r.dataset.idx),base=idx>=0?clone((model.equipment||[])[idx]||(model.autoclaves||[])[idx]||{}):{};";
  const equipmentSaveAt=html.indexOf("}else if(name==='Оборудование'){",html.indexOf("  function collectAndSave(name){"));
  if(equipmentSaveAt<0||html.indexOf(baseOld,equipmentSaveAt)<0||html.indexOf(baseOld,equipmentSaveAt)>equipmentSaveAt+450)throw Error("PP_EQUIP_PRESERVE_SAVE_ANCHOR_MISSING");
  html=html.slice(0,equipmentSaveAt)+html.slice(equipmentSaveAt).replace(baseOld,baseNew);
  if(!html.includes(baseNew))throw Error("PP_EQUIP_PRESERVE_SAVE_FAILED");
  if(html.includes(old)||!html.includes("ppEquipmentKindOptions(a)"))throw Error("PP_EQUIP_EDITOR_FIX_FAILED");
  return html;
}

function ppReliablePollingHtml(html){
 const start=html.indexOf('<script id="ppLivePanelV2">'),end=html.indexOf('</script>',start);
 if(start<0||end<=start)throw Error("PP_RELIABLE_POLL_WIDGET_NOT_FOUND");
 let script=html.slice(start,end);
 const replaceOne=(from,to,label)=>{const count=script.split(from).length-1;if(count!==1)throw Error("PP_RELIABLE_POLL_"+label+"_ANCHOR_"+count);script=script.replace(from,to)};
 replaceOne("let timer=null,token=0,mode='candidate',best=null,candidate=null;","let timer=null,token=0,mode='candidate',best=null,candidate=null,polling=false;","guard");
 replaceOne("async function poll(my){\n   try{","async function poll(my){\n   if(polling)return;\n   polling=true;\n   try{","poll_start");
 replaceOne("   }catch(e){}\n }\n function stop(){if(timer){clearInterval(timer);timer=null}}","   }catch(e){}finally{polling=false}\n }\n function stop(){if(timer){clearTimeout(timer);timer=null}}","poll_finish");
 replaceOne("stop();timer=setInterval(()=>poll(my),120);setTimeout(()=>poll(my),10);","stop();const next=async()=>{if(my!==token)return;await poll(my);if(my===token)timer=setTimeout(next,1400)};timer=setTimeout(next,50);","sequential");
 replaceOne("stop();try{await poll(my)}catch(_){}","stop();","fast_finish");
 return html.slice(0,start)+script+html.slice(end);
}

function ppKpiBaselineHtml(html){
 const replaceOnce=(before,after,label)=>{const count=html.split(before).length-1;if(count!==1)throw Error("PP_KPI_"+label+"_ANCHOR_"+count);html=html.replace(before,after)};
 replaceOnce(
  "const prev=previousKpiMetrics;\n  renderKpiDelta('durDelta'",
  "const ppBase=window.__ppKpiBaselinePlan;\n  const prev=ppBase?{duration:Number(ppBase.duration_minutes),cycles:Number(ppBase.batch_count),wait:Number(ppBase.operator_wait_minutes),idle:Number(ppBase.machine_idle_minutes)}:previousKpiMetrics;\n  renderKpiDelta('durDelta'",
  "stable_previous"
 );
 replaceOnce(
  "window.__ppOptimizerCommittedPlan=ppInc;window.__ppOptimizerObjectiveAtStart=",
  "window.__ppOptimizerCommittedPlan=ppInc;window.__ppKpiBaselinePlan=ppInc&&ppInc.valid!==false?{duration_minutes:ppInc.duration_minutes,batch_count:ppInc.batch_count,operator_wait_minutes:ppInc.operator_wait_minutes,machine_idle_minutes:ppInc.machine_idle_minutes}:null;window.__ppOptimizerObjectiveAtStart=",
  "capture_start"
 );
 replaceOnce(
  "function clearPlan(){window.__ppOptimizerCommittedPlan=null;",
  "function clearPlan(){window.__ppKpiBaselinePlan=null;window.__ppOptimizerCommittedPlan=null;",
  "reset_no_plan"
 );
 replaceOnce(
  "function restorePlan(p){",
  "function restorePlan(p){window.__ppKpiBaselinePlan=null;",
  "reset_open_plan"
 );
 if(!html.includes("window.__ppKpiBaselinePlan=ppInc")||!html.includes("const ppBase=window.__ppKpiBaselinePlan"))throw Error("PP_KPI_PATCH_BROKEN");
 return html;
}

function ppGaStableProgressHtml(html){
 const a=html.indexOf('<script id="ppRealOptProgressV1">'),z=html.indexOf('</script>',a);
 if(a<0||z<=a)throw Error("PP_GA_PROGRESS_WIDGET_MISSING");
 let part=html.slice(a,z);
 function swap(oldtext,newtext,tag){
  const n=part.split(oldtext).length-1;
  if(n!==1)throw Error("PP_GA_PROGRESS_"+tag+"_ANCHOR_"+n);
  part=part.replace(oldtext,newtext);
 }
 swap("let timer=null,token=0,last=null;","let timer=null,token=0,last=null,polling=false;","guard");
 swap("if(!d||!d.running)return;\n   const pct=Math.max(0,Math.min(99,Number(d.percent)||0));",
 "if(!d||!(d.running||d.success===true))return;\n   const reported=d.success===true?100:Math.max(0,Math.min(99,Number(d.percent)||0));\n   const pct=Math.max(Number(last?.percent)||0,reported);","paint_done");
 swap("btn.textContent='Оптимизация '+pct+'%';","btn.textContent=d.success===true?'Оптимизация 100% · завершаю...':'Оптимизация '+pct+'%';","paint_text");
 swap("last=d;","last={...d,percent:pct};","monotone_pct");
 swap("async function poll(my){\n   try{","async function poll(my){\n   if(polling)return;polling=true;\n   try{","poll_start");
 swap("   }catch(e){}\n }\n function stop(){if(timer){clearInterval(timer);timer=null}}",
 "   }catch(e){}finally{polling=false}\n }\n function stop(){if(timer){clearTimeout(timer);timer=null}}","poll_finish");
 swap("const my=++token;last=null;stop();\n   timer=setInterval(()=>poll(my),220);\n   setTimeout(()=>poll(my),20);",
 "if(btn.disabled||window.__ppOptimizationInFlight)return;\n   const my=++token;last=null;stop();\n   const next=async()=>{if(my!==token)return;await poll(my);if(my===token)timer=setTimeout(next,1700)};\n   timer=setTimeout(next,75);","single_flight");
 return html.slice(0,a)+part+html.slice(z);
}
async function serveGanttUi(req){const r=await fetch(UPSTREAM+"/",{headers:relayHeaders(req),signal:AbortSignal.timeout(20000)});if(!r.ok)return rawResponse(r);const h=await r.text();const pp3Mode=new URL(req.url).searchParams.get("ppGantt");const pp3Old="if(active===names[1])view.innerHTML=renderEmployees(plan)+ppUnifiedLegend();";const pp3New='if(active===names[1]){var pp3=window.__PP_SECONDARY_GANTTS_V3__;if(pp3&&typeof pp3.renderMode==="function"){view.replaceChildren(pp3.renderMode(1,plan))}else view.innerHTML=renderEmployees(plan)+ppUnifiedLegend()}';const pp3Html=(pp3Mode!=="equiponly"&&h.includes(pp3Old))?h.replace(pp3Old,pp3New):h;const ppOptGuard=(new URL(req.url).searchParams.get("ppOptGuard")!=="off");const ppUiHtml=ppOptGuard?ppOptimizerNoRegressionHtml(pp3Html):pp3Html;const ppStrictPreview=new URL(req.url).searchParams.get("ppStrict")!=="off";const ppStrictHtml=ppStrictPreview?ppStrictOptimizerHtml(ppUiHtml):ppUiHtml;const ppMotionPreview=(new URL(req.url).searchParams.get("ppMotion")!=="off");const ppMotionHtml=ppMotionPreview?ppLiveMotionHtml(ppStrictHtml):ppStrictHtml;const ppEquipPreview=new URL(req.url).searchParams.get("ppEquipFix")!=="off";const ppEquipHtml=ppEquipPreview?ppEquipmentEditorFixHtml(ppMotionHtml):ppMotionHtml;const ppPollPreview=new URL(req.url).searchParams.get("ppPoll")!=="off";const ppPollHtml=ppPollPreview?ppReliablePollingHtml(ppEquipHtml):ppEquipHtml;const ppKpiPreview=new URL(req.url).searchParams.get("ppKpi")!=="off";const ppKpiHtml=ppKpiPreview?ppKpiBaselineHtml(ppPollHtml):ppPollHtml;const ppGaPollPreview=new URL(req.url).searchParams.get("ppGaPoll")!=="off";const ppGaPollHtml=ppGaPollPreview?ppGaStableProgressHtml(ppKpiHtml):ppKpiHtml;if(!pp3Html.includes('id="ganttScroll"')||!h.includes('</body>'))return new Response(h,{status:r.status,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","x-pp-gantt-component":"upstream-unchanged"}});return new Response(ppGaPollHtml.replace('</body>',(PP_GANTT_INLINE+(new URL(req.url).searchParams.get("ppGantt")!=="equiponly"?PP_SECONDARY_GANTTS_INLINE:""))+'</body>'),{status:200,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","x-pp-gantt-component":"component-v2-preview"}})}
async function guardRepairedProjectStorage(req){
  try{
    const body=await req.clone().json();
    const raw=body?.storage?.["prodplan.projects.v2"];
    if(typeof raw==="string"){
      const rows=JSON.parse(raw);
      const ceramic=Array.isArray(rows)?rows.find(p=>p&&p.id==="prj_mugww6lr_kanzz5"):null;
      if(ceramic&&Number(ceramic.revision)<50){
        console.warn("PP_REPAIRED_MODEL_STALE_WRITE_BLOCKED",ceramic.revision);
        return jsonifyBridge({ok:false,error:"project_version_outdated",project:"Керамика",required_revision:50},409);
      }
    }
  }catch(e){console.warn("PP_STORAGE_GUARD_PARSE_SKIPPED",String(e).slice(0,120))}
  return proxy(req);
}

const ppProgressThrottle={promise:null,response:null,at:0,shared:0,served:0};
async function ppCachedProgress(req){
 const now=Date.now();
 if(ppProgressThrottle.response&&now-ppProgressThrottle.at<1200){
   ppProgressThrottle.served++;
   const response=ppProgressThrottle.response.clone();
   response.headers.set("x-pp-progress-cache","hit");
   return response;
 }
 if(ppProgressThrottle.promise){
   ppProgressThrottle.shared++;
   const response=(await ppProgressThrottle.promise).clone();
   response.headers.set("x-pp-progress-cache","shared");
   return response;
 }
 const task=(async()=>{
   const result=await progress(req);
   if(result.ok){
     ppProgressThrottle.at=Date.now();
     ppProgressThrottle.response=result.clone();
   }
   return result;
 })();
 ppProgressThrottle.promise=task;
 try{
   const response=(await task).clone();
   response.headers.set("x-pp-progress-cache","fresh");
   return response;
 }finally{if(ppProgressThrottle.promise===task)ppProgressThrottle.promise=null;}
}
const ppMtPreload="<script id=\"ppmt-sandbox-guards\">\n(function(){\n\"use strict\";\nconst state=new Map();\nconst store=Storage.prototype;\nconst get=store.getItem,set=store.setItem,remove=store.removeItem,clear=store.clear;\nfunction protect(key){return String(key).startsWith(\"prodplan.\")||String(key).startsWith(\"pp.\");}\nstore.getItem=function(key){if(this===localStorage&&protect(key))return state.has(String(key))?state.get(String(key)):null;return get.call(this,key)};\nstore.setItem=function(key,val){if(this===localStorage&&protect(key)){state.set(String(key),String(val));return;}return set.call(this,key,val)};\nstore.removeItem=function(key){if(this===localStorage&&protect(key)){state.delete(String(key));return;}return remove.call(this,key)};\nconst fetchOrig=window.fetch.bind(window);\nwindow.fetch=function(input,options){\n const url=new URL(typeof input===\"string\"?input:input.url,location.href);\n const method=String(options?.method||input?.method||\"GET\").toUpperCase();\n if(url.origin===location.origin&&![\"GET\",\"HEAD\"].includes(method)){\n  return Promise.resolve(new Response(JSON.stringify({ok:false,error:\"materials_preview_is_read_only\"}),{status:403,headers:{\"content-type\":\"application/json\"}}));\n }\n return fetchOrig(input,options)\n};\ndocument.addEventListener(\"submit\",e=>{e.preventDefault();e.stopImmediatePropagation()},true);\n})();\n</script>";
const ppMtUI="\n<style id=\"ppmt-style\">\n#ppmt-bar{position:sticky;top:0;z-index:2147483000;background:#122a49;color:white;padding:12px 16px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;font:13px Arial;box-shadow:0 3px 16px #182b4d3d}\n#ppmt-bar strong{font-size:15px;color:#fff}#ppmt-bar small{color:#bed0e6}#ppmt-bar button{cursor:pointer;background:#fff;color:#183962;border:1px solid #a3bedf;padding:9px 13px;border-radius:7px;font:600 12px Arial}\n#ppmt-bar button[data-current=true]{background:#3082e9;color:#fff;border-color:#3082e9}#ppmt-bar .ppmt-counter{margin-left:auto;color:#c9d9ef;font-size:11px}\n#ppmt-bar .ppmt-note{background:#304a68;padding:7px 10px;color:#ffe19c;border-radius:6px;font-size:11px}\n#ppmt-state{padding:12px 16px;background:#eaf4ff;border:1px solid #cadef9;margin:9px 12px;border-radius:8px;font:12px/1.5 Arial,sans-serif;color:#304863}\nbody #ppmt-bar+section{margin-top:0}#sectionView,#ppTabsView{min-height:160px}\n@media(max-width:770px){#ppmt-bar{gap:5px;padding:8px}#ppmt-bar button{padding:7px 9px}#ppmt-bar .ppmt-counter{margin-left:0}}\n</style>\n<div id=\"ppmt-bar\">\n <strong>Керамика · материалы</strong>\n <button type=\"button\" data-ppmt=\"materials\" data-current=\"true\">Материалы</button>\n <button type=\"button\" data-ppmt=\"gantt\">Гант материалов</button>\n <button type=\"button\" data-ppmt=\"orders\">Гант заказов</button>\n <button type=\"button\" data-ppmt=\"employees\">Гант сотрудников</button>\n <button type=\"button\" data-ppmt=\"rebuild\">Перестроить демоплан</button>\n <span class=\"ppmt-note\">Тестовый эталон · без записи данных</span>\n <span class=\"ppmt-counter\" id=\"ppmt-counter\">Загрузка…</span>\n</div>\n<div id=\"ppmt-state\">Загружаю тестовую модель и Гант…</div>\n<script id=\"ppmt-run\">\n(function(){\n\"use strict\";\nwindow.__PP_MATERIALS_TEST__={ready:false,model:null,plan:null,stats:null,errors:[]};\nconst state=window.__PP_MATERIALS_TEST__,$=id=>document.getElementById(id);\nconst pause=ms=>new Promise(r=>setTimeout(r,ms));\nasync function until(fn,ms=22000){const start=Date.now();while(Date.now()-start<ms){try{if(fn())return;}catch(e){}await pause(125)}throw Error(\"preview_component_timeout\")}\nasync function json(url){const r=await fetch(url,{cache:\"no-store\"});if(!r.ok)throw Error(\"preview_source_http_\"+r.status+\":\"+url);return r.json()}\nlet counter=0,viewName=\"materials\";\nfunction view(name){\n viewName=name;\n document.querySelectorAll(\"#ppmt-bar [data-ppmt]\").forEach(x=>x.dataset.current=String(x.dataset.ppmt===name));\n const pv=$(\"planView\"),sv=$(\"sectionView\"),tabs=$(\"ppTabsView\");\n if(!pv||!sv||!tabs)throw Error(\"existing_plan_sections_missing\");\n const msg=$(\"ppmt-state\");\n if(name===\"materials\"){\n  tabs.style.display=\"none\";\n  renderSection(\"Материалы\");\n  msg.textContent=\"Штатный редактор: 6 материалов, начальные остатки и поставки. Для проверки расхода откройте «Гант материалов». Сохранение в тестовом просмотре отключено.\";\n }else{\n  sv.style.display=\"none\";pv.style.display=\"block\";\n  const mode=name===\"gantt\"?2:name===\"orders\"?3:1;\n  const component=window.__PP_SECONDARY_GANTTS_V3__.renderMode(mode,state.plan);\n  tabs.replaceChildren(component);tabs.style.display=\"block\";\n  const stats={rows:component.querySelectorAll(\".pp3-row\").length,\n   receipts:component.querySelectorAll(\".pp3-bar.pp3-delivery\").length,\n   consumption:component.querySelectorAll(\".pp3-bar.pp3-consumption\").length};\n  state.stats=stats;\n  if(name===\"gantt\"&&(stats.rows!==6||stats.receipts<6||stats.consumption<6))\n   throw Error(\"incomplete_material_gantt:\"+JSON.stringify(stats));\n  msg.textContent=name===\"gantt\"\n   ? \"Штатный Гант материалов: \"+stats.rows+\" строк, \"+stats.receipts+\" поставок, \"+stats.consumption+\" событий расхода по операциям 12 заказов. Наведите мышь на цветные блоки.\"\n   : \"Гант тестовой модели: \"+stats.rows+\" строк. Здесь показано демонстрационное расписание, не результат генетической оптимизации.\";\n }\n window.scrollTo({top:0,behavior:\"instant\"});\n}\nasync function load(){\n const [m,p]=await Promise.all([json(\"/materials-test/model\"),json(\"/materials-test/plan\")]);\n await until(()=>window.__PP_SECONDARY_GANTTS_V3__?.installed&&typeof renderSection===\"function\");\n model=m.model;modelReady=true;hasResult=true;\n state.model=m.model;state.plan=p.plan;\n window.__ppTabPlan=state.plan;window.__ppManualPlan=state.plan;\n document.body.classList.remove(\"projects-mode\");\n if($(\"planView\"))$(\"planView\").style.display=\"block\";\n $(\"ppmt-counter\").textContent=String(model.orders.length)+\" заказов · \"+String(model.materials.length)+\" материалов · \"+state.plan.operations.length+\" операций\";\n document.querySelectorAll(\"#ppmt-bar [data-ppmt]\").forEach(b=>b.addEventListener(\"click\",async()=>{\n   try{\n    if(b.dataset.ppmt===\"rebuild\"){counter++;state.plan=(await json(\"/materials-test/plan?variant=\"+counter)).plan;window.__ppTabPlan=state.plan;view(\"gantt\")}\n    else view(b.dataset.ppmt);\n   }catch(e){state.errors.push(String(e));$(\"ppmt-state\").textContent=\"Ошибка: \"+String(e.message||e)}\n }));\n // Block navigation away to real projects and any accidental model writes.\n document.addEventListener(\"click\",e=>{\n  if(e.target.closest(\"#ppmt-bar\"))return;\n  const act=e.target.closest(\"[data-save],[data-add],[data-del],[data-pp-save],[data-pp-add],[data-rdel],#opt,#ppImportBtn,#chatSend,#ppOptimizerStartOver,.side .item,.top .nav\");\n  if(act){e.preventDefault();e.stopImmediatePropagation();\n   $(\"ppmt-state\").textContent=\"Это безопасный визуальный просмотр. Редактирование, оптимизация и переход к боевым проектам здесь отключены.\";\n  }\n },true);\n view(\"gantt\");\n state.ready=true;\n console.log(\"PP_MATERIAL_TEST_VISUAL_READY\",JSON.stringify({orders:model.orders.length,materials:model.materials.length,operations:state.plan.operations.length,stats:state.stats}));\n}\nload().catch(e=>{state.errors.push(String(e));$(\"ppmt-state\").textContent=\"Ошибка тестового просмотра: \"+String(e.message||e);console.error(e)});\n})();\n</script>";

const PPMT_SPEC=[
 ["M_BODY","Пресс-порошок для керамогранита","кг",18.5,"OP_PRESS",185000,265000,"2026-10-07T08:00:00"],
 ["M_ENGOBE","Ангоб","кг",0.55,"OP_GLAZE",8000,6000,"2026-10-08T09:00:00"],
 ["M_GLAZE","Глазурь базовая","кг",0.65,"OP_GLAZE",9000,7500,"2026-10-07T09:00:00"],
 ["M_INK","Краска для цифровой печати","кг",0.04,"OP_DECOR",400,600,"2026-10-08T09:00:00"],
 ["M_CARTONS","Коробки для плитки","шт.",0.7,"OP_PACK",10000,8000,"2026-10-07T08:00:00"],
 ["M_PALLETS","Палеты","шт.",0.02,"OP_PACK",250,250,"2026-10-08T08:00:00"]
];
const ppMtCache={model:null,at:0};
function ppMtNum(n){const x=Number(n);return Number.isFinite(x)?x:0}
async function ppMtModel(){
 if(ppMtCache.model&&Date.now()-ppMtCache.at<120000)return structuredClone(ppMtCache.model);
 const r=await fetch(UPSTREAM+"/api/model",{headers:{"user-agent":"ProdPlanMaterialVisualReadOnly/1.0","accept":"application/json"},signal:AbortSignal.timeout(25000)});
 if(!r.ok)throw Error("original_ceramics_read_failed_"+r.status);
 const payload=await r.json(),m=structuredClone(payload.model||payload),orders=m.orders||[];
 const ids=orders.map(o=>Number(o.id)).sort((a,b)=>a-b);
 if(ids.length!==12||ids.some((id,i)=>id!==2601+i))throw Error("unexpected_ceramic_orders");
 if(!Array.isArray(m.technical_processes)||m.technical_processes.length!==1||m.technical_processes[0].id!=="TP_TILE")throw Error("wrong_technology");
 if(Array.isArray(m.materials)&&m.materials.length)throw Error("original_model_already_has_materials");
 if(orders.reduce((sum,o)=>sum+ppMtNum(o.area||o.quantity),0)!==23100)throw Error("model_area_changed");
 m.materials=PPMT_SPEC.map(([id,name,unit,rate,op,initial,delivery,at])=>({
  id,name,unit,initial_stock:initial,
  deliveries:[{at,quantity:delivery}],
  consumption_per_unit:rate,order_ids:orders.map(o=>o.id),
  _demo_planned_demand:Math.round(23100*rate*100)/100
 }));
 for(const [id,name,unit,rate,opId] of PPMT_SPEC){
  const op=m.technical_processes[0].operations.find(x=>x.id===opId);
  if(!op)throw Error("operation_missing_"+opId);
  if(!Array.isArray(op.resource_requirements))op.resource_requirements=[];
  op.resource_requirements.push({id:"RR_"+id,type:"material",resource_type:"material",match_mode:"specific",resource_ref:id,resource_refs:[id],quantity:rate,unit,consumption_rule:"per_m2"});
 }
 m._demo_materials_version="ceramics-material-consumption-2026-10-14-v1";
 ppMtCache.model=structuredClone(m);ppMtCache.at=Date.now();
 return m;
}
function ppMtPlan(m,variant=0){
 const eqs=Array.isArray(m.equipment)&&m.equipment.length?m.equipment:(m.autoclaves||[]);
 const emps=m.employees||[],steps=m.technical_processes[0].operations||[];
 const eqFree=new Map(),empFree=new Map(),used=new Map(m.materials.map(x=>[x.id,0]));
 const operations=[],batches=[],epoch=Date.parse(m.start),orders=m.orders.slice();
 if(!Number.isFinite(epoch))throw Error("invalid_plan_start");
 if(variant)orders.push(...orders.splice(0,variant%orders.length));
 let maxTime=0;
 for(let oi=0;oi<orders.length;oi++){
  const o=orders[oi],id=Number(o.id),area=ppMtNum(o.area||o.quantity);
  const batch={order:id,order_id:id,batch:1,batch_id:String(id)+".1",area,quantity:area,start_min:oi*10};
  batches.push(batch);
  let ready=oi*10;
  for(const step of steps){
   const reqs=step.resource_requirements||[],mach=reqs.find(x=>x.resource_type==="equipment");
   const kind=String(mach?.kind||mach?.resource_ref||"").replace("kind:","");
   let options=eqs.filter(x=>String(x.kind)===kind);
   if(!options.length)throw Error("missing_demo_machine_"+kind);
   options.sort((a,b)=>ppMtNum(eqFree.get(String(a.id)))-ppMtNum(eqFree.get(String(b.id))));
   const machine=options[0],mid=String(machine.id);
   const staff=reqs.filter(x=>x.resource_type==="employee").map(x=>emps.find(e=>String(e.id)===String(x.resource_ref))).filter(Boolean);
   let start=Math.max(ready,ppMtNum(eqFree.get(mid)),...staff.map(x=>ppMtNum(empFree.get(String(x.id)))));
   const matReqs=reqs.filter(x=>x.resource_type==="material");
   for(const req of matReqs){
    const material=m.materials.find(x=>x.id===req.resource_ref);
    if(!material)throw Error("unknown_material_"+req.resource_ref);
    const need=area*ppMtNum(req.quantity)+(used.get(material.id)||0);
    let supplied=ppMtNum(material.initial_stock)+(material.deliveries||[]).filter(d=>Date.parse(d.at)-epoch<=start*60000).reduce((sum,d)=>sum+ppMtNum(d.quantity),0);
    if(need>supplied+0.001){
     const delivery=(material.deliveries||[]).slice().sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)).find(d=>ppMtNum(material.initial_stock)+ppMtNum(d.quantity)>=need-0.001);
     if(!delivery)throw Error("insufficient_material_"+material.id);
     start=Math.max(start,(Date.parse(delivery.at)-epoch)/60000);
    }
   }
   if(step.id==="OP_PRESS")batch.start_min=start;
   const duration=Math.max(25,Math.ceil(ppMtNum(step.duration_min||60)*(1+area/12000)));
   const end=start+duration;
   const resources=[{resource_type:"equipment",id:mid,name:machine.name},
    ...staff.map(x=>({resource_type:"employee",id:String(x.id),name:x.name})),
    ...matReqs.map(x=>({resource_type:"material",id:String(x.resource_ref),quantity:Math.round(area*ppMtNum(x.quantity)*100)/100}))
   ];
   operations.push({order:id,order_id:id,batch:1,batch_id:String(id)+".1",sequence:ppMtNum(step.sequence),
    operation_name:step.name||step.id,operation_id:step.id,name:step.name||step.id,
    duration_min:duration,start_min:start,end_min:end,equipment_ids:[mid],
    employee_ids:staff.map(x=>String(x.id)),resources,quantity:area,batch_quantity:area});
   for(const req of matReqs)used.set(req.resource_ref,(used.get(req.resource_ref)||0)+area*ppMtNum(req.quantity));
   eqFree.set(mid,end);for(const x of staff)empFree.set(String(x.id),end);
   ready=end;maxTime=Math.max(maxTime,end);
  }
 }
 operations.sort((a,b)=>a.start_min-b.start_min);
 return {start:m.start,duration_minutes:Math.ceil(maxTime),operations,generic_operations:operations,batches,batch_count:orders.length,
  preview_only:true,optimisation_type:"visual_demo_resource_reservation",valid:true};
}
async function ppMtServe(req){
 const url=new URL(req.url),path=url.pathname;
 try{
  if(req.method!=="GET")return Response.json({error:"readonly_preview"},{status:403});
  if(path==="/materials-test/health")return Response.json({ok:true,readonly:true,role:"test_etalon_material_preview"});
  if(path==="/materials-test/model")return Response.json({ok:true,model:await ppMtModel()},{headers:{"cache-control":"no-store"}});
  if(path==="/materials-test/plan"){
   const m=await ppMtModel(),variant=Math.max(0,Math.min(11,ppMtNum(url.searchParams.get("variant"))));
   return Response.json({ok:true,plan:ppMtPlan(m,variant)},{headers:{"cache-control":"no-store"}});
  }
  if(path!=="/materials-test"&&path!=="/materials-test/")return Response.json({error:"not_found"},{status:404});
  const r=await serveGanttUi(req),html=await r.text();
  if(!html.includes('id="ganttScroll"')||!html.includes("PP_SECONDARY_GANTTS_V3_READY"))throw Error("missing_original_components");
  const withHead=html.replace("</head>",ppMtPreload+"</head>");
  if(withHead===html||!withHead.includes("</body>"))throw Error("html_structure_changed");
  return new Response(withHead.replace("</body>",ppMtUI+"</body>"),{status:200,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","x-pp-material-preview":"existing-etalon-safe"}});
 }catch(e){console.error("PP_MATERIAL_TEST_ERROR",String(e));return Response.json({error:"test_material_preview_failed",details:String(e?.message||e)},{status:502})}
}

async function handler(req){const path=new URL(req.url).pathname;if(path==='/materials-test'||path.startsWith('/materials-test/'))return ppMtServe(req);if(req.method==="GET"&&path==="/"&&new URL(req.url).searchParams.get("ppGantt")!=="legacy")return serveGanttUi(req);if(req.method==="GET"&&path==="/__bridge_health")return jsonifyBridge({ok:true,rev:REV,upstream:UPSTREAM});if(req.method==="GET"&&path==="/api/plan-progress")return new URL(req.url).searchParams.get("ppProgressCache")!=="off"?ppCachedProgress(req):progress(req);if(req.method==="POST"&&path==="/api/plan")return plan(req);if(req.method==="POST"&&path==="/api/db-storage")return guardRepairedProjectStorage(req);return proxy(req)}
if(typeof Bun!=="undefined"&&typeof Bun.serve==="function"){Bun.serve({port:Number(Bun.env.PORT||8080),async fetch(req){try{return await handler(req)}catch(e){console.error("APS_BRIDGE_ERROR",String(e));return jsonifyBridge({ok:false,error:"bridge_unavailable"},502)}}});console.log("APS_BRIDGE_READY",REV)}
