
const u=Bun.env.GA_QA_ORIGIN, token=Bun.env.GA_QA_TOKEN;
const sleep=ms=>new Promise(f=>setTimeout(f,ms));
const report={health:false,rounds:[],completed:0,failed:0,peak:0,activeAtEnd:null,durationMs:0};
const started=Date.now();
let done=false,ok=false;
Bun.serve({port:Number(Bun.env.PORT||8080),fetch(){return Response.json({done,ok,report},{status:done?(ok?200:500):202})}});
const req=(typ,n)=>({resource_type:typ,match_mode:"specific",resource_ref:n,resource_refs:[n],quantity:1});
function model(tag,n){
const eq=tag+"E",emp=tag+"P",mat=tag+"M";
return {scheduler_mode:"resource",start:"2026-11-03T08:00:00",
equipment:[{id:eq,name:"Station",kind:"workstation",capacity:10,capacity_unit:"шт."}],
employees:[{id:emp,name:"Operator",role:"operator",shift:"day"}],
shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},
orders:Array.from({length:n},(_,i)=>({id:tag+"O"+i,quantity:5,unit:"шт.",technical_process_id:"TP",parameters:{color:i%2===0?"A":"B"}})),
technical_processes:[{id:"TP",name:"Assembly",operations:[{id:"OP",name:"Press",sequence:1,duration_min:30,setup_parameter:"color",
resource_requirements:[req("equipment",eq),req("employee",emp),{resource_type:"material",resource_ref:mat,resource_refs:[mat],quantity:1,consumption_rule:"per_unit"}]}]}],
materials:[{id:mat,name:"Material",unit:"kg",initial_stock:0,deliveries:[{at:"2026-11-03T09:00:00",quantity:n*6+10}]}],
setup_rules:[{id:"AB",setup_parameter:"color",equipment_ref:"*",from_state:"A",to_state:"B",duration_min:15},
{id:"BA",setup_parameter:"color",equipment_ref:"*",from_state:"B",to_state:"A",duration_min:15}]};
}
async function call(account,path,method="GET",data){
const r=await fetch(u+path,{method,headers:{"authorization":"Bearer "+token,"x-authenticated-account":account,"accept":"application/json",...(data?{"content-type":"application/json"}:{})},
body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(25000)});
return {status:r.status,data:await r.json().catch(()=>({}))};
}
async function wait(account,id,timeout=170000){
const t=Date.now();
while(Date.now()-t<timeout){const r=await call(account,"/internal/jobs/"+id);
if(r.status!==200)throw Error("poll_http_"+r.status);
if(["completed","failed","cancelled","timed_out"].includes(r.data.status))return r.data;
await sleep(400);
}throw Error("poll_timeout");
}
async function batch(name,users,count,gens,pop){
const t=Date.now(), entry={name,accounts:users,ordersPerAccount:count,generations:gens,population:pop,completed:0,elapsedMs:0,peak:null};
const jobs=await Promise.all(Array.from({length:users},async(_,i)=>{
 const account=name+"U"+i;
 const r=await call(account,"/internal/jobs","POST",{model:model(account,count),options:{generations:gens,population:pop,seed:1700+i}});
 if(r.status!==202||!r.data.job_id)throw Error("submit_"+name+"_"+i+"_"+r.status+"_"+r.data?.error);
 return {account,id:r.data.job_id};
}));
const out=await Promise.all(jobs.map(async x=>({account:x.account,status:await wait(x.account,x.id)})));
for(const x of out){
if(x.status.status!=="completed")throw Error("job_"+name+"_"+x.account+"_"+x.status.status+"_"+x.status.error);
const plan=x.status.result;
if(!plan?.valid||!Array.isArray(plan.operations)||plan.operations.length!==count||plan.operations.some(y=>!String(y.order||"").startsWith(x.account)))throw Error("bad_plan_"+name+"_"+x.account);
if(plan.operations.some(y=>Number(y.start_min)<60))throw Error("bad_material_"+name);
entry.completed++;
}
const mx=await call("BENCH","/internal/metrics");
if(mx.status!==200)throw Error("metrics_http_"+mx.status);
entry.peak=mx.data.peak;
if(mx.data.active!==0)throw Error("active_not_released_"+mx.data.active);
entry.elapsedMs=Date.now()-t;report.rounds.push(entry);report.completed+=entry.completed;report.peak=Math.max(report.peak,entry.peak);
console.log("LIFTORBIT_HEAVY_ROUND_PASS",JSON.stringify(entry));
}
try{
if(!u||!token)throw Error("env_missing");
const h=await fetch(u+"/health",{signal:AbortSignal.timeout(15000)});
if(h.status!==200||(await h.json()).ready!==true)throw Error("health");
report.health=true;
console.log("LIFTORBIT_HEAVY_STARTED");
await batch("MID20_",10,20,35,25);
await batch("MID36_",10,36,40,25);
await batch("LARGE80_",1,80,30,20);
const m=await call("BENCH","/internal/metrics");
if(m.status!==200)throw Error("metrics_last");
report.activeAtEnd=m.data.active;
if(m.data.active!==0)throw Error("active_slots_leak");
report.durationMs=Date.now()-started;ok=true;
console.log("LIFTORBIT_HEAVY_ALL_PASS",JSON.stringify(report));
}catch(x){
report.failed++;report.durationMs=Date.now()-started;
report.error=String(x?.message||x).slice(0,260);
console.log("LIFTORBIT_HEAVY_FAIL",JSON.stringify(report));
}finally{done=true;}
