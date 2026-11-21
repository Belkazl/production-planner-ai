const jobs=new Map();let active=0,peak=0;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
Bun.serve({port:18080,async fetch(req){
 const p=new URL(req.url).pathname;
 const m=(req.headers.get("cookie")||"").match(/(?:^|;\s*)pp_demo_auth=(tenant\d+)/);
 const who=m&&m[1];
 if(!who)return Response.json({error:"authentication_required"},{status:401});
 if(p==="/api/db-storage")return Response.json({ok:true,tenant:who});
 if(p==="/api/model")return Response.json({ok:true,model:{
   start:"2026-10-17T08:00:00Z",orders:[{id:who,quantity:Number(who.replace("tenant",""))}],
   setup_rules:[],equipment:[]
 }});
 if(p==="/api/plan"&&req.method==="POST"){
  active++;peak=Math.max(peak,active);
  try{await wait(1800);return Response.json({ok:true,valid:true,
    duration_minutes:Number(who.replace("tenant",""))*30,
    operations:[{order:who,operation_id:who,start_min:0,end_min:Number(who.replace("tenant",""))*30}],
    generations:12,optimizer_tenant:who});}
  finally{active--;}
 }
 if(p==="/_mock_stats")return Response.json({active,peak});
 if(p==="/api/plan-progress")return Response.json({ok:true,running:true,
   best_preview:{operations:[{order:"SHARED_GLOBAL_SHOULD_NOT_BE_EXPOSED"}]}});
 return Response.json({ok:true});
}});
console.log("PARALLEL_MOCK_READY");
