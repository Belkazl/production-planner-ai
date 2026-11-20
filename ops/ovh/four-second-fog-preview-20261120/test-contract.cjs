const fs=require("node:fs");
const vm=require("node:vm");
const assert=require("node:assert/strict");
const script=fs.readFileSync("ops/ovh/four-second-fog-preview-20261120/auth-snapshot-handler.js.txt","utf8");
const equipment=Array.from({length:14},(_,i)=>({id:"EQ-"+i,name:"Machine "+i}));
const model={equipment,orders:[{id:"A"}],start:"2026-11-20T08:00:00"};
const rows=equipment.flatMap((e,i)=>Array.from({length:12},(_,j)=>({
 order:"A",equipment_ids:[e.id],start_min:j*20+i,end_min:j*20+i+10,
 employee_ids:[],resources:[],name:"Operation "+j
})));
const full={ok:true,running:true,success:false,phase:"running",percent:41,done:41,total:100,
 candidate_preview:{valid:true,operations:rows,generic_operations:rows},best_preview:{operations:rows}};
let handlerCalls=0;
const ctx={URL,Request,Response,Map,Set,Date,Number,String,Array,Object,Math,
 ppSecureSessionKey:()=> "test-account",
 ppReadAccountModel:async()=>model,
 handler:async()=>{handlerCalls++;return Response.json(full);}
};
vm.createContext(ctx);
vm.runInContext(script+";globalThis.__fog={cut:ppFogCutCandidate,snapshot:ppFogHandleAuthenticated,cache:ppFogStatusCache}",ctx);
(async()=>{
 const preview=ctx.__fog.cut(full.candidate_preview,model);
 assert.equal(preview.operations.length,140);
 assert.equal(preview._pp_preview_limited,true);
 assert.equal(preview.partial,true);
 for(const eq of equipment){
  const operations=preview.operations.filter(op=>op.equipment_ids.includes(eq.id));
  assert.equal(operations.length,10,"Ten earliest operations per equipment row");
  assert.equal(operations.map(op=>op.name).join(","),Array.from({length:10},(_,j)=>"Operation "+j).join(","));
 }
 const target="https://app.liftorbit.app/api/ga-candidate-snapshot";
 const a=await ctx.__fog.snapshot(new Request(target+"?ppPreview=1"));
 assert.equal(a.status,200);
 const data=await a.json();
 assert.equal(data.candidate_preview.operations.length,140);
 assert.equal(data.best_preview,null);
 assert.equal(data.result,null);
 assert.equal(data.percent,41);
 assert.equal(handlerCalls,1);
 const b=await ctx.__fog.snapshot(new Request(target+"?ppLight=1"));
 assert.equal(b.status,200);
 const light=await b.json();
 assert.equal(light.percent,41);
 assert.equal(light.candidate_preview,null);
 assert.equal(light.result,null);
 assert.equal(handlerCalls,1,"light status must use one cached real checkpoint");
 // Legacy backend full plan remains identical: neither selected plan nor best
 // was mutated by server-side projection.
 assert.equal(full.candidate_preview.operations.length,168);
 assert.equal(full.best_preview.operations.length,168);
 full.running=false;full.phase="completed";full.success=true;full.percent=100;
 full.result={valid:true,operations:rows};
 ctx.__fog.cache.clear();
 const c=await ctx.__fog.snapshot(new Request(target+"?ppLight=1"));
 const completed=await c.json();
 assert.equal(completed.phase,"completed");
 assert.equal(completed.result.operations.length,168);
 console.log("FOG_PREVIEW_14_ROWS_10_FIRST_OPERATIONS_CACHE_FULL_FINAL_SAFE_PASS");
})().catch(e=>{console.error(e);process.exitCode=1});
