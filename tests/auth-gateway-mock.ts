const PORT=18080;
function authorized(req){
 const raw=req.headers.get("cookie")||"";
 const a=raw.match(/(?:^|;\s*)pp_demo_auth=(tenantA|tenantB)/);
 return a?a[1]:null;
}
Bun.serve({port:PORT,async fetch(req){
 const path=new URL(req.url).pathname;
 if(path==="/api/auth/login"||path==="/api/auth/register"){
  const body=await req.json().catch(()=>null);
  if(!body||body.password!=="qa-test-password")
   return Response.json({error:"invalid_credentials"},{status:401});
  return Response.json({ok:true},{headers:{"set-cookie":"pp_demo_auth=tenantA; Domain=production-planner-gateway-v2-production.up.railway.app; HttpOnly; Path=/; Secure; SameSite=Lax"}});
 }
 if(path==="/api/auth/logout")
  return Response.json({ok:true},{headers:{"set-cookie":"pp_demo_auth=; Path=/; HttpOnly; Max-Age=0; Secure; SameSite=Lax"}});
 const tenant=authorized(req);
 if(!tenant)return Response.json({error:"authentication_required"},{status:401});
 if(path==="/api/auth/me")return Response.json({error:"route_not_found"},{status:404});
 if(path==="/api/db-storage")return Response.json({ok:true,tenant,storage:{"prodplan.projects.v2":"[]"}});
 if(path==="/api/model")return Response.json({ok:true,model:{start:"2026-10-05T08:00:00Z",orders:[{id:tenant}],setup_rules:[],equipment:[]}});
 if(path==="/")return new Response('<!doctype html><title>Login - Account gateway</title><main id="auth-gateway-only">Login HTML; not the optimizer UI</main>',{headers:{"content-type":"text/html; charset=utf-8"}});
 return Response.json({ok:true,tenant,path});
}});
console.log("QA_AUTH_GATEWAY_MOCK_READY",PORT);
