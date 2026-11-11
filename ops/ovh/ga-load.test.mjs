import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createPythonGAUpstream} from "../../../app/python-ga-upstream.mjs";

const auth=readFileSync("app/auth-runtime.js","utf8");
const accountModelSource=readFileSync("app/tenant-model-runtime.js","utf8");
test("auth verification uses lightweight account endpoint without reading all saved plans",()=>{
 const section=auth.split("async function ppVerifyLogin(req){")[1].split("\nasync function ")[0];
 assert(section.includes('PP_AUTH_GATEWAY_ORIGIN+"/api/auth/me"'));
 assert(!section.includes("/api/db-storage"));
});
test("each progress request reads the owned model only once and never caches across requests",()=>{
 assert(accountModelSource.includes("ppProgressRequestModelCache=new WeakMap()"));
 assert(accountModelSource.includes('new URL(req.url).pathname==="/api/plan-progress"'));
 assert(accountModelSource.includes("return ppReadAccountModelUncached(req)"));
});
function harness(){
 let tick=100000,finished=false;
 const model={orders:Array.from({length:12},(_,n)=>({id:"ORD"+n})),
   equipment:Array.from({length:14},(_,n)=>({id:"EQ"+n})),employees:Array.from({length:5},(_,n)=>({id:"EMP"+n}))};
 const bigPlan={ok:true,valid:true,duration_minutes:4000,operations:Array.from({length:882},(_,n)=>({
    order:"ORD"+(n%12),operation_name:"Step"+(n%7),
    equipment_ids:["EQ"+(n%14)],employee_ids:["EMP"+(n%5)],start_min:n*5,end_min:n*5+5
 }))};
 const stores=[];
 const workerJobs=new Map();
 const upstream=createPythonGAUpstream({
  enabled:true,origin:"http://qa-ga-worker.railway.internal:8080",
  token:"test-only-unique-secret-length-32-abcdefg",
  sessionKey:async req=>req.headers.get("cookie")?.replace("session=","")||"",
  verifyLogin:async req=>/^session=tenant[AB]$/.test(req.headers.get("cookie")||""),
  readAccountModel:async()=>model,
  hashModel:m=>JSON.stringify(m),
  checkPlan:(p,m)=>p.operations.every(x=>m.orders.some(o=>o.id===x.order)),
  stateStore:{load:async()=>null,save:async(account,state)=>{
    stores.push({account,status:state.state,at:tick,operations:state.best?.operations?.length||0});
  }},
  fetchImpl:async(url,opts)=>{
   const path=new URL(url).pathname;
   const owner=opts.headers["x-authenticated-account"];
   assert(["tenantA","tenantB"].includes(owner));
   if(path==="/internal/jobs"&&opts.method==="POST"){
    const id=owner==="tenantA"?"a".repeat(32):"b".repeat(32);
    workerJobs.set(id,owner);
    return Response.json({job_id:id},{status:202});
   }
   const id=path.split("/")[3];
   assert.equal(workerJobs.get(id),owner);
   if(path.endsWith("/cancel"))return Response.json({status:"cancelled"});
   return Response.json({status:finished?"completed":"running",progress:finished?100:Math.min(99,Math.round((tick-100000)/50)),
      best_preview:bigPlan,result:finished?bigPlan:null});
  },
  now:()=>tick,sleep:async()=>{},pollMs:0,maxWaitMs:10000
 });
 const request=(who,path,method="GET")=>new Request("https://app.liftorbit.app"+path,{method,headers:{cookie:"session="+who}});
 const call=(who)=>upstream.fetch(request(who,"/api/plan-progress"));
 const start=(who)=>upstream.fetch(request(who,"/api/plan","POST"),{body:JSON.stringify({objective:"duration",__pp_async_start:true})});
 return {start,call,stores,advance:n=>{tick+=n},complete:()=>{finished=true}};
}
test("large previews do not rewrite PostgreSQL on each 220ms legacy poll",async()=>{
 const h=harness();
 const a=await h.start("tenantA"),b=await h.start("tenantB");
 assert.equal(a.status,202);assert.equal(b.status,202);
 assert.equal(h.stores.length,2);
 for(let i=0;i<9;i++){
   h.advance(200);
   const r=await h.call("tenantA");
   assert.equal(r.status,200);
   const j=await r.json();assert.equal(j.running,true);
   assert.equal(j.best_preview.operations.length,882);
 }
 const before=h.stores.filter(x=>x.account==="tenantA").length;
 assert(before<=2,"frequent progress calls must be throttled");
 h.advance(2100);
 const r=await h.call("tenantA");
 assert.equal(r.status,200);
 assert(h.stores.filter(x=>x.account==="tenantA").length>=before+1);
 h.complete();
 const terminal=await h.call("tenantA");
 assert.equal(terminal.status,200);
 assert.equal((await terminal.json()).success,true);
 assert.equal(h.stores.at(-1).status,"completed");
 assert.equal(h.stores.at(-1).operations,882);
 const ownB=await h.call("tenantB");
 assert.equal((await ownB.json()).best_preview.operations.length,882);
});
