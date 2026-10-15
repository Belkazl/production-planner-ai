const PORT=Number(process.env.PORT||3000);
const ROUTES=new Map([
 ["/",{file:"index.html",type:"text/html; charset=utf-8"}],
 ["/index.html",{file:"index.html",type:"text/html; charset=utf-8"}],
 ["/site.css",{file:"site.css",type:"text/css; charset=utf-8"}],
 ["/site.js",{file:"site.js",type:"application/javascript; charset=utf-8"}],
 ["/favicon.svg",{file:"favicon.svg",type:"image/svg+xml"}],
 ["/assets/demo/real-material-gantt.png",{file:"assets/demo/real-material-gantt.png",type:"image/png"}],
 ["/assets/demo/real-material-editor.png",{file:"assets/demo/real-material-editor.png",type:"image/png"}]
]);
const HEADERS={
 "x-content-type-options":"nosniff",
 "referrer-policy":"strict-origin-when-cross-origin",
 "x-frame-options":"DENY",
 "permissions-policy":"camera=(), microphone=(), geolocation=()",
 "content-security-policy":"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self' https://production-planner-gateway-v2-production.up.railway.app"
};
const app=Bun.serve({
 port:PORT,
 hostname:"0.0.0.0",
 async fetch(req){
  const u=new URL(req.url);
  const path=u.pathname;
  if(path==="/health")return Response.json({ok:true,service:"prodplan-landing-v1",version:"1.0.0"},{headers:{"cache-control":"no-store",...HEADERS}});
  if(req.method!=="GET"&&req.method!=="HEAD")return new Response("Method Not Allowed",{status:405,headers:{"allow":"GET, HEAD",...HEADERS}});
  const route=ROUTES.get(path);
  if(!route)return new Response("Not Found",{status:404,headers:HEADERS});
  const file=Bun.file(new URL("./"+route.file,import.meta.url));
  if(!(await file.exists()))return new Response("Missing asset",{status:500,headers:HEADERS});
  const headers={...HEADERS,"content-type":route.type,"cache-control":path==="/"||path==="/index.html"?"no-store":"public, max-age=600"};
  return new Response(req.method==="HEAD"?null:file,{status:200,headers});
 },
 error(error){
  console.error("Landing error:",error.message);
  return new Response("Internal server error",{status:500,headers:HEADERS});
 }
});
console.log("ProdPlan landing preview listening on :"+String(app.port));
