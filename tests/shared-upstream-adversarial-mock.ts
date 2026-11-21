// Simulates the real legacy optimizer's single global active state.
// A correct parallel tenant architecture must never return the other tenant's data.
let globalModel=null,globalOwner=null,peak=0,active=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
Bun.serve({port:18080,async fetch(req){
 const p=new URL(req.url).pathname;
 const owner=(req.headers.get("cookie")||"").match(/(?:^|;\s*)pp_demo_auth=(tenant\d+)/)?.[1];
 if(!owner)return Response.json({error:"authentication_required"},{status:401});
 if(p==="/api/db-storage")return Response.json({ok:true,owner});
 if(p==="/api/model") {
  globalModel={start:"2026-10-17T08:00:00Z",orders:[{id:owner}],setup_rules:[],equipment:[]};
  return Response.json({ok:true,model:globalModel});
 }
 if(p==="/api/plan"&&req.method==="POST"){
  active++;peak=Math.max(peak,active);
  try{
   globalOwner=owner;
   await sleep(1300);
   // A global mutable optimizer buffer is overwritten by competing requests.
   const resultOwner=globalOwner;
   return Response.json({ok:true,valid:true,optimizer_tenant:resultOwner,duration_minutes:Number(resultOwner.replace("tenant",""))*30,
    operations:[{order:resultOwner,operation_id:resultOwner,start_min:0,end_min:Number(resultOwner.replace("tenant",""))*30}]});
  }finally{active--;}
 }
 if(p==="/api/plan-progress")return Response.json({ok:true,running:true,best_preview:{operations:[{order:globalOwner}]}});
 return Response.json({ok:true});
}});
