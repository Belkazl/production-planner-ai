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


import {randomBytes} from "node:crypto";
const base=Bun.env.QA_APP_ORIGIN, origin=Bun.env.QA_PUBLIC_ORIGIN;
const report={accounts:0,plans:0,saved:0,checks:[],error:null};let done=false,pass=false;
Bun.serve({port:Number(Bun.env.PORT||8080),fetch(){return Response.json({done,pass,report},{status:done?(pass?200:500):202})}});
const chk=(yes,msg)=>{if(!yes)throw Error(msg);report.checks.push(msg)};
async function call(path,method="GET",data=null,cookie=""){
 const headers={accept:"application/json",origin};
 if(data!==null)headers["content-type"]="application/json";if(cookie)headers.cookie=cookie;
 const res=await fetch(base+path,{method,headers,body:data===null?undefined:JSON.stringify(data),signal:AbortSignal.timeout(90000),redirect:"manual"});
 const raw=await res.text();let value;try{value=JSON.parse(raw)}catch{value={nonJson:raw.slice(0,80)}}
 return {status:res.status,data:value,cookie:res.headers.get("set-cookie")?.split(";")[0]||null};
}
async function run(){
 try{
  chk(/^http:\/\/[a-z0-9-]+\.railway\.internal:8080$/.test(base)&&/^https:\/\/[a-z0-9.-]+\.up\.railway\.app$/.test(origin),"qa_only_origins");
  chk((await call("/__bridge_health")).status===200,"bridge_health");
  chk((await call("/api/auth/me")).status===401,"anon_denied");
  const users=[];
  for(let i=0;i<2;i++){
   const email="qa."+randomBytes(10).toString("hex")+"@liftorbit.invalid",password=randomBytes(24).toString("hex");
   const reg=await call("/api/auth/register","POST",{email,password,company:"QA"});
   chk(reg.status===200&&!!reg.cookie,"register_"+i+"_"+reg.status+"_"+reg.data.error);
   const me=await call("/api/auth/me","GET",null,reg.cookie);
   chk(me.status===200&&!!me.data.account_id,"login_"+i);
   const model=sample("E2E"+i),project="qa-model-"+i;
   const storage={"prodplan.projects.v2":JSON.stringify([{id:project,name:"Test",model}]),"prodplan.project.active.v2":project};
   const saved=await call("/api/db-storage","POST",{storage},reg.cookie);
   chk(saved.status===200&&saved.data.ok,"model_save_"+i+"_"+saved.status);
   const owned=await call("/api/model","GET",null,reg.cookie);
   chk(owned.status===200&&owned.data.model?.orders?.[0]?.id===model.orders[0].id,"model_load_"+i+"_"+owned.status);
   users.push({cookie:reg.cookie,model});
  }
  report.accounts=2;
  const plans=await Promise.all(users.map(async(u,i)=>{
   const result=await call("/api/plan","POST",{generations:12,population:12,seed:4+i},u.cookie);
   chk(result.status===200&&result.data.ok&&Array.isArray(result.data.operations),"ga_plan_"+i+"_"+result.status+"_"+result.data.error);
   chk(result.data.operations.length>0&&result.data.operations.every(o=>u.model.orders.some(a=>String(a.id)===String(o.order))),"plan_isolation_"+i);
   const progress=await call("/api/plan-progress","GET",null,u.cookie);
   chk(progress.status===200&&progress.data.ok,"progress_"+i);
   const prev=await call("/api/db-storage","GET",null,u.cookie);
   const storage=prev.data.storage||{};storage["qa.savedPlan.v1"]=JSON.stringify(result.data);
   const stored=await call("/api/db-storage","POST",{storage},u.cookie);
   const restored=await call("/api/db-storage","GET",null,u.cookie);
   chk(stored.status===200&&restored.status===200&&JSON.parse(restored.data.storage["qa.savedPlan.v1"]).operations.length===result.data.operations.length,"plan_persist_"+i);
   report.saved++;
   return result;
  }));
  report.plans=plans.length;
  const lo=await call("/api/auth/logout","POST",{},users[0].cookie);
  chk(lo.status===200&& (await call("/api/auth/me","GET",null,users[0].cookie)).status===401,"logout_revoke");
  chk((await call("/api/auth/me","GET",null,users[1].cookie)).status===200,"other_account_preserved");
  pass=true;console.log("LIFTORBIT_QA_AUTH_E2E_PASS",JSON.stringify(report));
 }catch(e){report.error=String(e?.message||e).slice(0,240);console.log("LIFTORBIT_QA_AUTH_E2E_FAIL",JSON.stringify(report))}
 finally{done=true}
}
void run();
