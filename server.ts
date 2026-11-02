import {createHash} from 'node:crypto';
import {ORIGIN,pages,growthRoutes,enhanceHome,enhanceSitemap,enhanceLlms} from './growth.mjs';
import {CONVERSION_RELEASE,conversionPages,conversionRoutes,enhanceResource,enhanceConversionHome,usageAllowed} from './public-preview.mjs';

const PREVIEW_ACCESS_CODE="576005";
const PREVIEW_TOKEN=require("node:crypto").randomBytes(24).toString("hex");
const PREVIEW_COOKIE="__Host-lo-preview";
const PREVIEW_NO_STORE={"cache-control":"private, no-store","x-robots-tag":"noindex, nofollow, noarchive"};
const PREVIEW_LIMIT=new Map();
const previewForm=(invalid=false)=>new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>LiftOrbit — Private preview</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;background:#f7f8f5;color:#153042;font:16px system-ui,Arial}main{background:#fff;padding:34px;max-width:420px;width:100%;border:1px solid #e1e9e5;border-radius:16px;box-shadow:0 18px 55px #143a4710}h1{margin:0 0 10px;font-size:30px}p{color:#647a83;margin:0 0 25px}input{display:block;width:100%;padding:14px;font-size:19px;letter-spacing:2px;border:1px solid #cad9d5;border-radius:9px}button{background:#2468d6;border:0;color:white;border-radius:9px;width:100%;padding:14px;font:600 16px system-ui;margin-top:15px;cursor:pointer}.error{color:#c22b35;font-size:13px;margin-top:10px}</style></head><body><main><h1>LiftOrbit</h1><p>This is a private preview. Enter the access code to continue.</p><form method="POST" action="/_preview/unlock"><input name="code" placeholder="Access code" aria-label="Access code" autocomplete="off" inputmode="numeric" maxlength="6" required><button type="submit">Continue</button>${invalid?'<div class="error">Incorrect code</div>':''}</form></main></body></html>`,{status:200,headers:{...PREVIEW_NO_STORE,"content-type":"text/html; charset=utf-8","content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
async function previewGate(req,u){
 const path=u.pathname;
 if(path==="/health")return null;
 if(path==="/robots.txt")return new Response("User-agent: *\nDisallow: /\n",{headers:{...PREVIEW_NO_STORE,"content-type":"text/plain"}});
 if(path==="/sitemap.xml"||path==="/llms.txt")return new Response(null,{status:404,headers:PREVIEW_NO_STORE});
 if(path==="/_preview/unlock"){
  if(req.method!=="POST")return new Response("Method Not Allowed",{status:405,headers:PREVIEW_NO_STORE});
  const origin=req.headers.get("origin");
  if(origin!==u.origin)return new Response("Forbidden",{status:403,headers:PREVIEW_NO_STORE});
  const ip=(req.headers.get("x-forwarded-for")||"unknown").split(",")[0],now=Date.now(),entry=PREVIEW_LIMIT.get(ip)||{at:now,tries:0};
  if(now-entry.at>600000){entry.at=now;entry.tries=0}entry.tries++;PREVIEW_LIMIT.set(ip,entry);if(PREVIEW_LIMIT.size>1000)PREVIEW_LIMIT.clear();
  if(entry.tries>30)return new Response("Too many attempts",{status:429,headers:PREVIEW_NO_STORE});
  if(Number(req.headers.get("content-length")||0)>256)return new Response("Request too large",{status:413,headers:PREVIEW_NO_STORE});
  const body=await req.text();
  if(body.length>256)return new Response("Request too large",{status:413,headers:PREVIEW_NO_STORE});
  if(new URLSearchParams(body).get("code")!==PREVIEW_ACCESS_CODE)return previewForm(true);
  return new Response(null,{status:303,headers:{...PREVIEW_NO_STORE,location:"/","set-cookie":PREVIEW_COOKIE+"="+PREVIEW_TOKEN+"; Path=/; HttpOnly; Secure; SameSite=Lax"}});
 }
 const allowed=(req.headers.get("cookie")||"").split(";").some(v=>v.trim()===PREVIEW_COOKIE+"="+PREVIEW_TOKEN);
 if(!allowed)return req.method==="GET"||req.method==="HEAD"?previewForm():new Response("Access code required",{status:403,headers:PREVIEW_NO_STORE});
 return null;
}

const PORT=Number(process.env.PORT||3000);
const ROUTES=new Map([
 ['/site.css',{file:'site.css',type:'text/css; charset=utf-8'}],['/site.js',{file:'site.js',type:'application/javascript; charset=utf-8'}],
 ['/favicon.svg',{file:'favicon.svg',type:'image/svg+xml'}],['/robots.txt',{file:'robots.txt',type:'text/plain; charset=utf-8'}],
 ['/65dead239d02c66083c4a583bb7b69c432fb9582.txt',{file:'65dead239d02c66083c4a583bb7b69c432fb9582.txt',type:'text/plain; charset=utf-8'}],
 ['/assets/demo/real-material-gantt.png',{file:'assets/demo/real-material-gantt.png',type:'image/png'}],['/assets/demo/real-material-editor.png',{file:'assets/demo/real-material-editor.png',type:'image/png'}],
 ['/conversion.js',{file:'conversion.js',type:'application/javascript; charset=utf-8'}],['/conversion.css',{file:'conversion.css',type:'text/css; charset=utf-8'}]
]);
for(const name of ['starter-overview','starter-orders','starter-equipment','starter-schedule'])ROUTES.set('/assets/tour/'+name+'.png',{file:'assets/tour/'+name+'.png',type:'image/png'});
const loadText=path=>Bun.file(new URL(path,import.meta.url)).text();
const memory=new Map([...growthRoutes].map(([path,r])=>[path,{...r,...(r.type.startsWith('text/html')?{body:enhanceResource(r.body,path)}:{})}]));
for(const [path,r] of conversionRoutes)memory.set(path,r);
memory.set('/',{body:enhanceConversionHome(enhanceHome(await loadText('./index.html'))),type:'text/html; charset=utf-8'});
memory.set('/sitemap.xml',{body:enhanceSitemap(await loadText('./sitemap.xml')).replace('</urlset>',conversionPages.map(p=>`<url><loc>${ORIGIN+p.path}</loc><lastmod>2026-10-16</lastmod></url>`).join('\n')+'</urlset>'),type:'application/xml; charset=utf-8'});
memory.set('/llms.txt',{body:enhanceLlms(await loadText('./llms.txt'))+'\n'+conversionPages.map(p=>`- [${p.title}](${ORIGIN+p.path}): ${p.description}`).join('\n'),type:'text/plain; charset=utf-8'});
const HEADERS={'x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin','x-frame-options':'DENY','permissions-policy':'camera=(), microphone=(), geolocation=()'};
const csp=(hashes='')=>`default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'${hashes?' '+hashes:''}; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self' https://app.liftorbit.app https://production-planner-gateway-v2-production.up.railway.app`;
const policies=new Map(),contentHashes=new Map();
for(const [path,r] of memory){if(!r.type.startsWith('text/html'))continue;const hashes=[...r.body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m=>"'sha256-"+createHash('sha256').update(m[1],'utf8').digest('base64')+"'").join(' ');policies.set(path,csp(hashes));contentHashes.set(path,createHash('sha256').update(r.body,'utf8').digest('hex'));}
const publicPaths=new Set(['/',...pages.map(p=>p.path),...conversionPages.map(p=>p.path)]);
let usageWindow=0,usageCount=0;
const app=Bun.serve({port:PORT,hostname:'0.0.0.0',maxRequestBodySize:8192,
 async fetch(req){
  const u=new URL(req.url),path=u.pathname;
  const base={...HEADERS,'content-security-policy':policies.get(path)||csp()};
  {const locked=await previewGate(req,u);if(locked)return locked;}
  if(path==='/embed/production-capacity/'){delete base['x-frame-options'];base['content-security-policy']=base['content-security-policy'].replace("frame-ancestors 'none'",'frame-ancestors *');base['x-robots-tag']='noindex';}
  if(path==='/api/usage'){
   const h={...base,'cache-control':'no-store','x-robots-tag':'noindex'};
   if(req.method!=='POST')return new Response(null,{status:405,headers:h});
   if(Number(req.headers.get('content-length')||0)>512)return new Response(null,{status:413,headers:h});
   const text=await req.text();if(text.length>512)return new Response(null,{status:413,headers:h});
   let data;try{data=JSON.parse(text)}catch{return new Response(null,{status:400,headers:h})}
   if(!usageAllowed(req,data,publicPaths))return new Response(null,{status:403,headers:h});
   if(req.headers.get('dnt')==='1'||req.headers.get('sec-gpc')==='1')return new Response(null,{status:204,headers:h});
   const minute=Math.floor(Date.now()/60000);if(minute!==usageWindow){usageWindow=minute;usageCount=0}
   if(++usageCount>300)return new Response(null,{status:429,headers:h});
   console.log(JSON.stringify({event:data.event,source:data.source,release:CONVERSION_RELEASE}));return new Response(null,{status:204,headers:h});
  }
  if(!['GET','HEAD'].includes(req.method))return new Response('Method Not Allowed',{status:405,headers:{...base,allow:'GET, HEAD'}});
  if(path==='/health')return new Response(req.method==='HEAD'?null:JSON.stringify({ok:true,service:'prodplan-landing-v1',version:'1.2.0',release:CONVERSION_RELEASE,publicResourcePages:publicPaths.size-1}),{headers:{...base,'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-robots-tag':'noindex'}});
  if(path==='/index.html')return new Response(null,{status:308,headers:{...base,location:ORIGIN+'/','cache-control':'private, no-store'}});
  if(!path.endsWith('/')&&publicPaths.has(path+'/'))return new Response(null,{status:308,headers:{...base,location:ORIGIN+path+'/'+u.search,'cache-control':'private, no-store'}});
  if(path==='/go/planner'||path==='/go/register'){
   const raw=u.searchParams.get('from')||'',source=publicPaths.has(raw)?raw:'unknown';
   if(req.method==='GET')console.log(JSON.stringify({event:path==='/go/register'?'demo_outbound':'planner_outbound',source,release:CONVERSION_RELEASE}));
   return new Response(null,{status:302,headers:{...base,location:path==='/go/register'?'https://liftorbit.app/demo/':'https://app.liftorbit.app/','cache-control':'no-store','x-robots-tag':'noindex, nofollow'}});
  }
  const dynamic=memory.get(path),route=dynamic||ROUTES.get(path);
  if(!route)return new Response(req.method==='HEAD'?null:'Not Found',{status:404,headers:{...base,'x-robots-tag':'noindex'}});
  let body;if(dynamic)body=dynamic.body;else{const file=Bun.file(new URL('./'+route.file,import.meta.url));if(!await file.exists())return new Response('Missing asset',{status:500,headers:base});body=file;}
  const html=route.type.startsWith('text/html'),cache='private, no-store';
  const headers={...base,'content-type':route.type,'cache-control':cache,...(html?{'x-content-sha256':contentHashes.get(path),'x-liftorbit-release':CONVERSION_RELEASE}:{}),...(path==='/'?{'x-landing-content-sha256':contentHashes.get(path)}:{})};
  return new Response(req.method==='HEAD'?null:body,{status:200,headers});
 },error(error){console.error('Landing error:',error.message);return new Response('Internal server error',{status:500,headers:{...HEADERS,'content-security-policy':csp()}})}
});
console.log('LiftOrbit landing listening on :'+String(app.port)+' release='+CONVERSION_RELEASE);
