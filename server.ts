import {createHash} from 'node:crypto';
import {ORIGIN,pages,growthRoutes,enhanceHome,enhanceSitemap,enhanceLlms} from './growth.mjs';
import {CONVERSION_RELEASE,conversionPages,conversionRoutes,enhanceResource,enhanceConversionHome,usageAllowed} from './public-preview.mjs';
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
const app=Bun.serve({port:PORT,hostname:'0.0.0.0',maxRequestBodySize:1024,
 async fetch(req){
  const u=new URL(req.url),path=u.pathname;
  const base={...HEADERS,'content-security-policy':policies.get(path)||csp()};
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
  if(path==='/index.html')return new Response(null,{status:308,headers:{...base,location:ORIGIN+'/','cache-control':'public, max-age=3600'}});
  if(!path.endsWith('/')&&publicPaths.has(path+'/'))return new Response(null,{status:308,headers:{...base,location:ORIGIN+path+'/'+u.search,'cache-control':'public, max-age=3600'}});
  if(path==='/go/planner'||path==='/go/register'){
   const raw=u.searchParams.get('from')||'',source=publicPaths.has(raw)?raw:'unknown';
   if(req.method==='GET')console.log(JSON.stringify({event:path==='/go/register'?'demo_outbound':'planner_outbound',source,release:CONVERSION_RELEASE}));
   return new Response(null,{status:302,headers:{...base,location:path==='/go/register'?'https://liftorbit.app/demo/':'https://app.liftorbit.app/','cache-control':'no-store','x-robots-tag':'noindex, nofollow'}});
  }
  const dynamic=memory.get(path),route=dynamic||ROUTES.get(path);
  if(!route)return new Response(req.method==='HEAD'?null:'Not Found',{status:404,headers:{...base,'x-robots-tag':'noindex'}});
  let body;if(dynamic)body=dynamic.body;else{const file=Bun.file(new URL('./'+route.file,import.meta.url));if(!await file.exists())return new Response('Missing asset',{status:500,headers:base});body=file;}
  const html=route.type.startsWith('text/html'),cache=html?'public, max-age=120, must-revalidate':['/robots.txt','/sitemap.xml','/llms.txt'].includes(path)?'public, max-age=3600':'public, max-age=600';
  const headers={...base,'content-type':route.type,'cache-control':cache,...(html?{'x-content-sha256':contentHashes.get(path),'x-liftorbit-release':CONVERSION_RELEASE}:{}),...(path==='/'?{'x-landing-content-sha256':contentHashes.get(path)}:{})};
  return new Response(req.method==='HEAD'?null:body,{status:200,headers});
 },error(error){console.error('Landing error:',error.message);return new Response('Internal server error',{status:500,headers:{...HEADERS,'content-security-policy':csp()}})}
});
console.log('LiftOrbit landing listening on :'+String(app.port)+' release='+CONVERSION_RELEASE);
