import {createHash} from 'node:crypto';
import {ORIGIN,pages,growthRoutes,enhanceHome,enhanceSitemap,enhanceLlms} from './growth.mjs';
import {CONVERSION_RELEASE,conversionPages,conversionRoutes,enhanceResource,enhanceConversionHome,usageAllowed} from './public-preview.mjs';
const ppLandingGuard=(function ppLandingAuthGate(){
  const AUTH_ORIGIN="https://app.liftorbit.app";
  const LOGIN_ROUTE="/_preview/login",COOKIE_NAME="__Host-liftorbit-preview";
  const SESSION_CACHE=new Map();
  const NO_STORE={"cache-control":"private, no-store","x-robots-tag":"noindex, nofollow, noarchive","x-content-type-options":"nosniff","x-frame-options":"DENY","referrer-policy":"no-referrer"};
  const CSP="default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
  function originOkay(req,url){
    const raw=req.headers.get("origin")||"",site=req.headers.get("sec-fetch-site");
    if(site&&site!=="same-origin"&&site!=="none")return false;
    try{const o=new URL(raw);return o.host===url.host&&(o.protocol==="https:"||o.hostname==="localhost")&&o.pathname==="/"&&!o.search&&!o.hash}catch{return false}
  }
  const cookieFrom=req=>{
    const v=(req.headers.get("cookie")||"").split(";").map(s=>s.trim()).find(s=>s.startsWith(COOKIE_NAME+"="));
    if(!v)return "";
    try{
      const encoded=v.slice(COOKIE_NAME.length+1);
      if(!/^[A-Za-z0-9_-]{1,8192}$/.test(encoded))return "";
      const decoded=Buffer.from(encoded,"base64url").toString("utf8");
      if(decoded.length>4096||!decoded)return "";
      if(!decoded.split("; ").every(p=>/^[a-zA-Z0-9!#$%&'*+.^_`|~-]+=[^\s;,]+$/.test(p)))return "";
      return decoded;
    }catch{return ""}
  };
  const destination=raw=>{
    const s=typeof raw==="string"?raw:"/";
    return s.startsWith("/")&&!s.startsWith("//")&&!s.includes("\\")&&s.length<=1024&&!s.startsWith(LOGIN_ROUTE)?s:"/";
  };
  const redirect=(location,status=302,clear=false)=>new Response(null,{status,headers:{...NO_STORE,location,...(clear?{"set-cookie":COOKIE_NAME+"=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0"}:{})}});
  function loginForm(next,error){
    const message=error==="invalid"?"Incorrect email or password.":error==="unavailable"?"Sign-in is temporarily unavailable. Please try again.":"";
    const action=LOGIN_ROUTE+"?next="+encodeURIComponent(next);
    const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Sign in — LiftOrbit</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f7f8f5;color:#1b303e;font:15px/1.5 Inter,system-ui,Arial,sans-serif}.panel{width:100%;max-width:410px;background:#fff;padding:36px;border:1px solid #e3e9e5;border-radius:16px;box-shadow:0 14px 55px #14302410}.brand{font-size:25px;font-weight:750;letter-spacing:-.7px}.hint{color:#6d7e80;margin:8px 0 28px}.field{display:block;font-size:13px;font-weight:650;margin:14px 0 7px}input{display:block;width:100%;border:1px solid #cbd6d4;border-radius:8px;padding:12px 13px;font:inherit;background:white;color:#1b303e}input:focus{outline:2px solid #348e96;outline-offset:1px}.submit{margin-top:24px;width:100%;border:0;border-radius:9px;padding:13px;background:#1e6776;color:white;font:650 15px Inter,system-ui,Arial,sans-serif;cursor:pointer}.error{color:#b93636;margin:14px 0 0;font-size:13px;min-height:19px}.fine{color:#718084;font-size:12px;margin-top:20px}</style></head><body><main class="panel"><div class="brand">LiftOrbit</div><p class="hint">This site is temporarily private. Sign in using your existing LiftOrbit account.</p><form method="post" action="${action}" autocomplete="on"><label class="field" for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" maxlength="254" required autofocus><label class="field" for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required><button class="submit" type="submit">Sign in</button><p class="error" role="alert">${message}</p></form><p class="fine">The same email and password you use in the planning application.</p></main></body></html>`;
    return new Response(html,{status:error==="unavailable"?503:error?401:200,headers:{...NO_STORE,"content-type":"text/html; charset=utf-8","content-security-policy":CSP}});
  }
  async function validSession(raw){
    if(!raw)return false;
    const key=createHash("sha256").update(raw).digest("hex"),cached=SESSION_CACHE.get(key);
    if(cached&&Date.now()-cached<15000)return true;
    const r=await fetch(AUTH_ORIGIN+"/api/auth/me",{method:"GET",headers:{"cookie":raw,"accept":"application/json"},redirect:"manual",cache:"no-store",signal:AbortSignal.timeout(20000)});
    if(r.body)try{await r.body.cancel()}catch{}
    if(r.status===401){SESSION_CACHE.delete(key);return false}
    if(r.status!==200)throw Error("auth_unavailable");
    if(SESSION_CACHE.size>400)SESSION_CACHE.clear();
    SESSION_CACHE.set(key,Date.now());
    return true;
  }
  async function login(req,url){
    const next=destination(url.searchParams.get("next"));
    if(!originOkay(req,url))return new Response("Forbidden",{status:403,headers:NO_STORE});
    if(!/^application\/x-www-form-urlencoded(?:;|$)/i.test(req.headers.get("content-type")||""))return new Response("Unsupported Media Type",{status:415,headers:NO_STORE});
    let params;
    try{const body=await req.text();if(body.length>4096)return new Response("Request Too Large",{status:413,headers:NO_STORE});params=new URLSearchParams(body)}catch{return loginForm(next,"invalid")}
    const email=(params.get("email")||"").trim(),password=params.get("password")||"";
    if(!email||!email.includes("@")||email.length>254||!password||password.length>1024)return loginForm(next,"invalid");
    try{
      const r=await fetch(AUTH_ORIGIN+"/api/auth/login",{method:"POST",headers:{"content-type":"application/json","accept":"application/json","origin":AUTH_ORIGIN},body:JSON.stringify({email,password,company:""}),redirect:"manual",signal:AbortSignal.timeout(20000),cache:"no-store"});
      if([400,401,403].includes(r.status))return loginForm(next,"invalid");
      if(!r.ok)return loginForm(next,"unavailable");
      const raw=typeof r.headers.getSetCookie==="function"?r.headers.getSetCookie():[];
      if(!raw.length&&r.headers.get("set-cookie"))raw.push(r.headers.get("set-cookie"));
      const pairs=raw.map(s=>s.split(";")[0].trim()).filter(p=>/^[a-zA-Z0-9!#$%&'*+.^_`|~-]+=[^\s;,]+$/.test(p));
      const upstreamCookies=pairs.join("; ");
      if(!upstreamCookies||upstreamCookies.length>4096)return loginForm(next,"unavailable");
      if(!await validSession(upstreamCookies))return loginForm(next,"invalid");
      const ticket=Buffer.from(upstreamCookies,"utf8").toString("base64url");
      return new Response(null,{status:303,headers:{...NO_STORE,location:next,"set-cookie":COOKIE_NAME+"="+ticket+"; Path=/; Secure; HttpOnly; SameSite=Lax"}});
    }catch{return loginForm(next,"unavailable")}
  }
  return async function ppLandingGuard(req,url){
    const path=url.pathname;
    if(path==="/robots.txt"&&(req.method==="GET"||req.method==="HEAD"))
      return new Response(req.method==="HEAD"?null:"User-agent: *\nDisallow: /\n",{headers:{...NO_STORE,"content-type":"text/plain; charset=utf-8"}});
    if(path===LOGIN_ROUTE){
      if(req.method==="GET"||req.method==="HEAD"){
        const response=loginForm(destination(url.searchParams.get("next")));
        return req.method==="HEAD"?new Response(null,{status:response.status,headers:response.headers}):response;
      }
      if(req.method==="POST")return login(req,url);
      return new Response("Method Not Allowed",{status:405,headers:{...NO_STORE,allow:"GET, HEAD, POST"}});
    }
    if(path==="/_preview/logout"){
      if(req.method!=="POST")return new Response("Method Not Allowed",{status:405,headers:{...NO_STORE,allow:"POST"}});
      if(!originOkay(req,url))return new Response("Forbidden",{status:403,headers:NO_STORE});
      return redirect(LOGIN_ROUTE,303,true);
    }
    const session=cookieFrom(req);
    if(!session){
      if(req.method==="GET"||req.method==="HEAD")return redirect(LOGIN_ROUTE+"?next="+encodeURIComponent(destination(path+url.search)));
      return new Response(JSON.stringify({error:"authentication_required"}),{status:401,headers:{...NO_STORE,"content-type":"application/json"}});
    }
    try{
      if(await validSession(session))return null;
      if(req.method==="GET"||req.method==="HEAD")return redirect(LOGIN_ROUTE+"?next="+encodeURIComponent(destination(path+url.search)),302,true);
      return new Response(JSON.stringify({error:"authentication_required"}),{status:401,headers:{...NO_STORE,"content-type":"application/json"}});
    }catch{
      return new Response("Authentication temporarily unavailable",{status:503,headers:NO_STORE});
    }
  }
})();
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
  const base={...HEADERS,'x-robots-tag':'noindex, nofollow, noarchive','content-security-policy':policies.get(path)||csp()};
  if(path!=='/health'){const gated=await ppLandingGuard(req,u);if(gated)return gated;}
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
