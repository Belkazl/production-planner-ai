import { createHash } from "node:crypto";
import { RELEASE, ORIGIN, pages, growthRoutes, enhanceHome, enhanceSitemap, enhanceLlms } from "./growth.mjs";
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
const loadText=(path)=>Bun.file(new URL(path,import.meta.url)).text();
const memory=new Map(growthRoutes);
memory.set("/",{body:enhanceHome(await loadText("./index.html")),type:"text/html; charset=utf-8"});
memory.set("/sitemap.xml",{body:enhanceSitemap(await loadText("./sitemap.xml")),type:"application/xml; charset=utf-8"});
memory.set("/llms.txt",{body:enhanceLlms(await loadText("./llms.txt")),type:"text/plain; charset=utf-8"});
const HEADERS={
 "x-content-type-options":"nosniff",
 "referrer-policy":"strict-origin-when-cross-origin",
 "x-frame-options":"DENY",
 "permissions-policy":"camera=(), microphone=(), geolocation=()"
};
const csp=(hashes="")=>`default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'${hashes?" "+hashes:""}; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self' https://app.liftorbit.app https://production-planner-gateway-v2-production.up.railway.app`;
const policies=new Map();
const contentHashes=new Map();
for(const [path,route] of memory){
 if(!route.type.startsWith("text/html"))continue;
 const hashes=[...route.body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m=>"'sha256-"+createHash("sha256").update(m[1],"utf8").digest("base64")+"'").join(" ");
 policies.set(path,csp(hashes));
 contentHashes.set(path,createHash("sha256").update(route.body,"utf8").digest("hex"));
}
const publicPaths=new Set(pages.map(p=>p.path));
const app=Bun.serve({
 port:PORT,hostname:"0.0.0.0",
 async fetch(req){
  const u=new URL(req.url); const path=u.pathname;
  const base={...HEADERS,"content-security-policy":policies.get(path)||csp()};
  if(req.method!=="GET"&&req.method!=="HEAD")return new Response("Method Not Allowed",{status:405,headers:{...base,"allow":"GET, HEAD"}});
  if(path==="/health")return new Response(req.method==="HEAD"?null:JSON.stringify({ok:true,service:"prodplan-landing-v1",version:"1.1.0",release:RELEASE,publicResourcePages:pages.length}),{headers:{...base,"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-robots-tag":"noindex"}});
  if(path==="/index.html")return new Response(null,{status:308,headers:{...base,location:ORIGIN+"/","cache-control":"public, max-age=3600"}});
  if(!path.endsWith("/")&&publicPaths.has(path+"/"))return new Response(null,{status:308,headers:{...base,location:ORIGIN+path+"/"+u.search,"cache-control":"public, max-age=3600"}});
  if(path==="/go/planner"){
   const raw=u.searchParams.get("from")||"";
   const source=publicPaths.has(raw)?raw:"unknown";
   // Aggregate outbound requests only. Do not log IPs, entered calculator values or arbitrary query strings.
   if(req.method==="GET")console.log(JSON.stringify({event:"planner_outbound",source,release:RELEASE}));
   return new Response(null,{status:302,headers:{...base,location:"https://app.liftorbit.app/","cache-control":"no-store","x-robots-tag":"noindex, nofollow"}});
  }
  const dynamic=memory.get(path);
  const route=dynamic||ROUTES.get(path);
  if(!route)return new Response(req.method==="HEAD"?null:"Not Found",{status:404,headers:{...base,"x-robots-tag":"noindex"}});
  let body;
  if(dynamic)body=dynamic.body;
  else{
   const file=Bun.file(new URL("./"+route.file,import.meta.url));
   if(!(await file.exists()))return new Response("Missing asset",{status:500,headers:base});
   body=file;
  }
  const html=route.type.startsWith("text/html");
  const cache=html?"public, max-age=120, must-revalidate":["/robots.txt","/sitemap.xml","/llms.txt"].includes(path)?"public, max-age=3600":"public, max-age=600";
  const headers={...base,"content-type":route.type,"cache-control":cache,...(html?{"x-content-sha256":contentHashes.get(path),"x-liftorbit-release":RELEASE}:{}),...(path==="/"?{"x-landing-content-sha256":contentHashes.get(path)}:{})};
  return new Response(req.method==="HEAD"?null:body,{status:200,headers});
 },
 error(error){console.error("Landing error:",error.message);return new Response("Internal server error",{status:500,headers:{...HEADERS,"content-security-policy":csp()}});}
});
console.log("LiftOrbit landing listening on :"+String(app.port)+" release="+RELEASE);
