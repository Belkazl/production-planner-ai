import { createHash } from "node:crypto";
const PORT=Number(process.env.PORT||3000);
const ROUTES=new Map([
 ["/",{file:"index.html",type:"text/html; charset=utf-8"}],
 ["/site.css",{file:"site.css",type:"text/css; charset=utf-8"}],
 ["/site.js",{file:"site.js",type:"application/javascript; charset=utf-8"}],
 ["/favicon.svg",{file:"favicon.svg",type:"image/svg+xml"}],
 ["/robots.txt",{file:"robots.txt",type:"text/plain; charset=utf-8"}],
 ["/sitemap.xml",{file:"sitemap.xml",type:"application/xml; charset=utf-8"}],
 ["/llms.txt",{file:"llms.txt",type:"text/plain; charset=utf-8"}],
 ["/65dead239d02c66083c4a583bb7b69c432fb9582.txt",{file:"65dead239d02c66083c4a583bb7b69c432fb9582.txt",type:"text/plain; charset=utf-8"}],
 ["/assets/demo/real-material-gantt.png",{file:"assets/demo/real-material-gantt.png",type:"image/png"}],
 ["/assets/demo/real-material-editor.png",{file:"assets/demo/real-material-editor.png",type:"image/png"}]
]);
const landingHtml=await Bun.file(new URL("./index.html",import.meta.url)).text();
const landingContentHash=createHash("sha256").update(landingHtml,"utf8").digest("hex");
const structuredDataScriptHashes=[...landingHtml.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m=>"'sha256-"+createHash("sha256").update(m[1],"utf8").digest("base64")+"'").join(" ");
const HEADERS={
 "x-content-type-options":"nosniff",
 "referrer-policy":"strict-origin-when-cross-origin",
 "x-frame-options":"DENY",
 "permissions-policy":"camera=(), microphone=(), geolocation=()",
 "content-security-policy":`default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'${structuredDataScriptHashes?" "+structuredDataScriptHashes:""}; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self' https://app.liftorbit.app https://production-planner-gateway-v2-production.up.railway.app`
};
const app=Bun.serve({
 port:PORT,
 hostname:"0.0.0.0",
 async fetch(req){
  const u=new URL(req.url);
  const path=u.pathname;
  if(path==="/health")return Response.json({ok:true,service:"prodplan-landing-v1",version:"1.0.0"},{headers:{"cache-control":"no-store","x-robots-tag":"noindex",...HEADERS}});
  if(req.method!=="GET"&&req.method!=="HEAD")return new Response("Method Not Allowed",{status:405,headers:{"allow":"GET, HEAD",...HEADERS}});
  if(path==="/index.html")return new Response(null,{status:308,headers:{...HEADERS,location:"https://liftorbit.app/","cache-control":"public, max-age=3600"}});
  const route=ROUTES.get(path);
  if(!route)return new Response("Not Found",{status:404,headers:{...HEADERS,"x-robots-tag":"noindex"}});
  const file=Bun.file(new URL("./"+route.file,import.meta.url));
  if(!(await file.exists()))return new Response("Missing asset",{status:500,headers:HEADERS});
  const headers={...HEADERS,"content-type":route.type,"cache-control":path==="/"?"public, max-age=120, must-revalidate":path==="/robots.txt"||path==="/sitemap.xml"||path==="/llms.txt"?"public, max-age=3600":"public, max-age=600",...(path==="/"?{"x-landing-content-sha256":landingContentHash}:{})};
  return new Response(req.method==="HEAD"?null:file,{status:200,headers});
 },
 error(error){
  console.error("Landing error:",error.message);
  return new Response("Internal server error",{status:500,headers:HEADERS});
 }
});
console.log("LiftOrbit landing listening on :"+String(app.port));
