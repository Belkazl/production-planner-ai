// Internal-only repeatable test runner. Runs against a separately deployed QA GA, never production.

const url=Bun.env.GA_QA_ORIGIN;
const token=Bun.env.GA_QA_TOKEN;
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
const report={phase:'boot',health:false,auth:false,crossTenant:false,rounds:[],controls:[],appAuth:null,metrics:null};
let complete=false;

function sample(tag) {
  const eid=tag+"E",pid=tag+"P",mid=tag+"M";
  const req=(type,resource)=>({resource_type:type,match_mode:"specific",resource_ref:resource,resource_refs:[resource],quantity:1});
  return {scheduler_mode:"resource",start:"2026-11-03T08:00:00",
    equipment:[{id:eid,name:"Station",kind:"workstation",capacity:10,capacity_unit:"шт."}],
    employees:[{id:pid,name:"Operator",role:"operator",shift:"day"}],
    shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},
    orders:[{id:tag+"O1",quantity:5,unit:"шт.",technical_process_id:"TP",parameters:{color:"A"}},
      {id:tag+"O2",quantity:5,unit:"шт.",technical_process_id:"TP",parameters:{color:"B"}}],
    technical_processes:[{id:"TP",name:"Assembly",operations:[{id:"OP1",name:"Press",sequence:1,duration_min:30,setup_parameter:"color",
      resource_requirements:[req("equipment",eid),req("employee",pid),{resource_type:"material",resource_ref:mid,resource_refs:[mid],quantity:1,consumption_rule:"per_unit"}]}]}],
    materials:[{id:mid,name:"Paint",unit:"kg",initial_stock:0,deliveries:[{at:"2026-11-03T09:00:00",quantity:20}]}],
    setup_rules:[{id:"AB",setup_parameter:"color",equipment_ref:"*",from_state:"A",to_state:"B",duration_min:15},
      {id:"BA",setup_parameter:"color",equipment_ref:"*",from_state:"B",to_state:"A",duration_min:15}]};
}
async function call(account,path,method="GET",body=null,authorized=true){
 const r=await fetch(url+path,{method,headers:{accept:"application/json",
   ...(authorized?{"authorization":"Bearer "+token,"x-authenticated-account":account}:{}),
   ...(body?{"content-type":"application/json"}:{})},body:body?JSON.stringify(body):undefined,
   signal:AbortSignal.timeout(25000)});
 return {status:r.status,data:await r.json().catch(()=>({}))};
}
async function wait(account,id,timeout=100000){
 const start=Date.now();
 while(Date.now()-start<timeout){
  const x=await call(account,"/internal/jobs/"+id);
  if(x.status!==200)throw Error("job_status_http_"+x.status);
  if(["completed","failed","cancelled","timed_out"].includes(x.data.status))return x.data;
  await sleep(300);
 }
 throw Error("job_wait_timeout");
}


let finished=false;
Bun.serve({port:Number(Bun.env.PORT||8080),fetch(req){return Response.json({done:finished,ok:complete,report},{status:finished?(complete?200:500):202});}});
const safeError=e=>String(e?.message||e).slice(0,220);
function assert(x,msg){if(!x)throw Error(msg);}
function ordersModel(tag,n) {
 const m=sample(tag);
 m.materials[0].deliveries[0].quantity=Math.max(20,n*6+15);
 m.orders=Array.from({length:n},(_,i)=>({
    ...structuredClone(m.orders[i%2]), id:tag+"O"+(i+1),
    parameters:{color:i%2===0?"A":"B"}
 }));
 return m;
}
async function roundTest(attempt,n,gens,pop){
 const reportEntry={pass:attempt,accounts:0,pids:0,peak:null,orders:n,gens,pop,ok:false};
 const jobs=await Promise.all(Array.from({length:10},async(_,i)=>{
   const account="FA"+attempt+"U"+i;
   const model=ordersModel(account,n);
   const req=await call(account,"/internal/jobs","POST",{model,options:{generations:gens,population:pop,seed:attempt*100+i}});
   assert(req.status===202&&req.data?.job_id,"round_"+attempt+"_submit_"+i+"_"+req.status+"_"+req.data?.error);
   return {account,model,id:req.data.job_id};
 }));
 reportEntry.accounts=jobs.length;
 const out=await Promise.all(jobs.map(async(j)=>({account:j.account,model:j.model,status:await wait(j.account,j.id,150000)})));
 const pids=[];
 for(const r of out){
   const z=r.status;
   assert(z.status==="completed","round_"+attempt+"_job_"+r.account+"_"+z.status+"_"+z.error);
   assert(z.result?.valid===true,"round_"+attempt+"_invalid");
   assert(z.result?.operations?.length===n,"round_"+attempt+"_operation_count_"+z.result?.operations?.length);
   assert(z.result.operations.every(x=>String(x.order||"").startsWith(r.account)),"round_"+attempt+"_tenant_mixed");
   assert(z.result.operations.every(x=>Number(x.start_min)>=60),"round_"+attempt+"_material_delivery");
   assert(Number(z.result.setup_count)>=1,"round_"+attempt+"_missing_setup");
   assert(z.result?.resume_state?.completed_runs===1,"round_"+attempt+"_missing_resume_state");
   assert(Number.isInteger(z.pid)&&z.pid>0,"round_"+attempt+"_missing_pid");
   pids.push(z.pid);
 }
 assert(new Set(pids).size===10,"round_"+attempt+"_pid_not_unique");
 const met=await call("FINAL_QA","/internal/metrics");
 assert(met.status===200,"round_"+attempt+"_metrics_bad");
 assert(met.data.active===0,"round_"+attempt+"_worker_slot_leak");
 assert(met.data.peak===10,"round_"+attempt+"_unexpected_peak_"+met.data.peak);
 reportEntry.pids=10;reportEntry.peak=met.data.peak;reportEntry.ok=true;
 report.rounds.push(reportEntry);console.log("LIFTORBIT_FINAL_ROUND_PASS",JSON.stringify(reportEntry));
}
async function controlsTest(iteration){
 const tag="CTRL"+iteration;
 const account="F_CTRL_"+iteration;
 const entry={iteration,manualLock:false,continuation:false,modelGuard:false,cancel:false,restartAfterCancel:false,ok:false};
 const model=sample(tag);
 const x=await call(account,"/internal/jobs","POST",{model,options:{generations:12,population:12,seed:4+iteration}});
 assert(x.status===202,"ctrl_"+iteration+"_start_"+x.status);
 const first=await wait(account,x.data.job_id,80000);
 assert(first.status==="completed"&&first.result?.valid,"ctrl_"+iteration+"_first_"+first.status);
 const lock={};for(const k of ["order","operation_id","start_min","end_min","employee_ids","equipment_ids","batch"])lock[k]=structuredClone(first.result.operations[0][k]??null);
 lock.start_min+=15;lock.end_min+=15;
 const q=await call(account,"/internal/jobs","POST",{model,options:{generations:12,population:12,seed:4+iteration,locked_operations:[lock]}});
 assert(q.status===202,"ctrl_"+iteration+"_lock_start_"+q.status);
 const pin=await wait(account,q.data.job_id,80000);
 const locked=pin.result?.operations?.filter(x=>x.manual_locked)||[];
 assert(pin.status==="completed"&&locked.length===1&&locked[0].start_min===lock.start_min&&locked[0].end_min===lock.end_min&&pin.result.locked_operations_applied===1,"ctrl_"+iteration+"_lock_inexact_"+pin.status);
 entry.manualLock=true;
 const resumed=await call(account,"/internal/jobs","POST",{model,options:{generations:12,population:12,seed:14+iteration,continue:true,resume_state:first.result.resume_state}});
 assert(resumed.status===202,"ctrl_"+iteration+"_resume_submit_"+resumed.status);
 const rr=await wait(account,resumed.data.job_id,80000);
 assert(rr.status==="completed"&&rr.result?.continued&&rr.result.resume_state?.completed_runs===2,"ctrl_"+iteration+"_resume_failed_"+rr.status);
 assert(first.pid!==rr.pid,"ctrl_"+iteration+"_same_os_pid");
 assert(rr.result.duration_minutes<=first.result.duration_minutes,"ctrl_"+iteration+"_worse_resumed_plan");
 entry.continuation=true;
 const changed=structuredClone(model);changed.orders[0].quantity=99;
 const invalid=await call(account,"/internal/jobs","POST",{model:changed,options:{generations:12,population:12,seed:14+iteration,continue:true,resume_state:first.result.resume_state}});
 assert(invalid.status===202,"ctrl_"+iteration+"_model_changed_submit_"+invalid.status);
 const mismatch=await wait(account,invalid.data.job_id,80000);
 assert(mismatch.status==="failed","ctrl_"+iteration+"_stale_model_not_rejected_"+mismatch.status);
 entry.modelGuard=true;
 const heavy=sample("X"+iteration);
 heavy.materials=[];heavy.setup_rules=[];
 heavy.technical_processes[0].operations[0].resource_requirements=heavy.technical_processes[0].operations[0].resource_requirements.filter(x=>x.resource_type!=="material");
 const two=structuredClone(heavy.orders);
 heavy.orders=Array.from({length:120},(_,i)=>({...structuredClone(two[i%2]),id:"X"+iteration+"O"+i}));
 const cancelAccount="F_CANCEL_"+iteration;
 const long=await call(cancelAccount,"/internal/jobs","POST",{model:heavy,options:{generations:15000,population:250,seed:123+iteration}});
 assert(long.status===202,"ctrl_"+iteration+"_long_start_"+long.status);
 let stat=null;
 for(let i=0;i<100;i++){stat=await call(cancelAccount,"/internal/jobs/"+long.data.job_id);
   if(stat.status===200&&stat.data.status==="running"&&stat.data.pid)break;
   if(["failed","completed","cancelled","timed_out"].includes(stat.data.status))throw Error("ctrl_"+iteration+"_long_exited_early_"+stat.data.status);
   await sleep(75);
 }
 assert(stat?.data?.status==="running","ctrl_"+iteration+"_long_not_running");
 const stop=await call(cancelAccount,"/internal/jobs/"+long.data.job_id+"/cancel","POST",{});
 assert(stop.status===200&&stop.data.status==="cancelled","ctrl_"+iteration+"_cancel_bad_"+stop.status);
 const after=await wait(cancelAccount,long.data.job_id,5000);
 assert(after.status==="cancelled","ctrl_"+iteration+"_cancel_not_terminal");
 entry.cancel=true;
 const next=await call(cancelAccount,"/internal/jobs","POST",{model:sample("RESTART"+iteration),options:{generations:12,population:12,seed:77+iteration}});
 assert(next.status===202,"ctrl_"+iteration+"_restart_submit_"+next.status);
 const fin=await wait(cancelAccount,next.data.job_id,80000);
 assert(fin.status==="completed"&&fin.result?.valid,"ctrl_"+iteration+"_restart_failed");
 entry.restartAfterCancel=true;
 const metrics=await call("FINAL_QA","/internal/metrics");
 assert(metrics.status===200&&metrics.data.active===0,"ctrl_"+iteration+"_process_leak");
 entry.ok=true;report.controls.push(entry);
 console.log("LIFTORBIT_FINAL_CONTROLS_PASS",JSON.stringify(entry));
}
async function checkBunApp(){
 const app=Bun.env.GA_QA_APP_ORIGIN;
 assert(/^http:\/\/[a-z0-9-]+\.railway\.internal:\d+$/.test(String(app)),"qa_app_origin_invalid");
 const codes={};
 for(const [route,method] of [["/__bridge_health","GET"],["/api/model","GET"],["/api/plan","POST"],["/api/plan-progress","GET"]]){
  const r=await fetch(app+route,{method,headers:{"accept":"application/json",...(method==="POST"?{"content-type":"application/json"}:{})},
   body:method==="POST"?"{}":undefined,redirect:"manual",signal:AbortSignal.timeout(15000)});
  codes[route]=r.status;
 }
 assert(codes["/__bridge_health"]===200,"qa_app_health_"+codes["/__bridge_health"]);
 for(const route of ["/api/model","/api/plan","/api/plan-progress"])assert(codes[route]===401||codes[route]===403,"qa_app_auth_"+route+"_"+codes[route]);
 report.appAuth=codes;console.log("LIFTORBIT_FINAL_APP_AUTH_PASS",JSON.stringify(codes));
}
async function runAll(){
 try {
  assert(url&&token,"worker_connection_missing");
  let health=await fetch(url+"/health",{signal:AbortSignal.timeout(15000)});
  assert(health.status===200&&(await health.json()).ready,"worker_health_failed");
  report.health=true;
  let noauth=await call("TEST","/internal/metrics","GET",null,false);
  assert(noauth.status===401,"worker_auth_bypass");
  report.auth=true;
  const acct="OWNER_CHECK",model=sample(acct);
  const start=await call(acct,"/internal/jobs","POST",{model,options:{generations:12,population:12,seed:5}});
  assert(start.status===202,"owner_start");
  const stranger=await call("FOREIGN_OWNER","/internal/jobs/"+start.data.job_id);
  assert(stranger.status===403,"cross_tenant_read");
  const wrongCancel=await call("FOREIGN_OWNER","/internal/jobs/"+start.data.job_id+"/cancel","POST",{});
  assert(wrongCancel.status===403,"cross_tenant_cancel");
  const ok=await wait(acct,start.data.job_id,80000);
  assert(ok.status==="completed","owner_job_failed");
  report.crossTenant=true;console.log("LIFTORBIT_FINAL_ACCOUNT_GUARDS_PASS");
  await checkBunApp();
  for(let iteration=1;iteration<=3;iteration++){
   report.phase="round_"+iteration;console.log("LIFTORBIT_FINAL_ROUND_START",iteration);
   await roundTest(iteration,[2,4,6][iteration-1],[12,20,30][iteration-1],[12,20,25][iteration-1]);
   report.phase="controls_"+iteration;await controlsTest(iteration);
  }
  const m=await call("FINAL_QA","/internal/metrics");assert(m.status===200,"final_metrics");
  report.metrics={active:m.data.active,peak:m.data.peak};
  assert(m.data.active===0&&m.data.peak===10,"final_capacity_not_clean");
  report.phase="done";complete=true;
  console.log("LIFTORBIT_FINAL_MULTIQA_PASS",JSON.stringify(report));
 }catch(e){report.phase="FAILED:"+report.phase;report.error=safeError(e);console.log("LIFTORBIT_FINAL_MULTIQA_FAIL",JSON.stringify(report));}
 finally {finished=true;}
}
void runAll();
