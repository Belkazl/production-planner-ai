
const PP_AUTH_GATEWAY_ORIGIN=(typeof Bun!=="undefined"&&Bun.env?.PP_AUTH_GATEWAY_ORIGIN)||"https://production-planner-gateway-v2-production.up.railway.app";
const ppAuthLoginPage=[
'<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Вход — ProdPlan AI</title>',
'<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f8fc;color:#213450;font:14px/1.55 Inter,system-ui,Arial,sans-serif;padding:20px}.box{background:white;border:1px solid #dde6f2;border-radius:16px;padding:30px;max-width:450px;width:100%;box-shadow:0 16px 60px #16365312}.logo{font-size:24px;font-weight:800;letter-spacing:-.5px}.desc{color:#70819a;font-size:13px;margin:3px 0 25px}.tabs{display:flex;gap:10px;border-bottom:1px solid #e4ebf6;margin-bottom:20px}.tabs button{border:0;background:none;padding:12px 8px;margin-right:16px;font:600 14px Inter,system-ui;color:#8190a5;cursor:pointer}.tabs .on{color:#2464d3;border-bottom:2px solid #2464d3}label{display:block;font-weight:650;font-size:12px;color:#536680;margin:15px 0 6px}input{width:100%;border:1px solid #d4deec;border-radius:8px;padding:12px 13px;font:14px Inter,system-ui;outline:0}input:focus{border-color:#3174e9;box-shadow:0 0 0 3px #3174e91c}.go{width:100%;border:0;background:#2467dd;border-radius:9px;padding:13px;font:650 14px Inter,system-ui;color:white;cursor:pointer;margin-top:24px}.go:disabled{opacity:.65;cursor:wait}.err{min-height:18px;color:#c13f40;font-size:12px;margin-top:8px}.company{display:none}</style></head>',
'<body><div class="box"><div class="logo">ProdPlan AI</div><p class="desc">Производственное планирование</p><div class="tabs"><button id="loginTab" type="button" class="on">Войти</button><button id="regTab" type="button">Регистрация</button></div><form id="f"><div class="company" id="companyWrap"><label for="company">Компания</label><input id="company" autocomplete="organization"></div><label for="email">Email</label><input id="email" type="email" autocomplete="email" required><label for="password">Пароль</label><input id="password" type="password" autocomplete="current-password" required><button class="go" id="go">Войти</button><div id="err" class="err" role="alert" aria-live="polite"></div></form></div>',
'<script>(function(){let mode="login";const get=id=>document.getElementById(id);function setMode(m){mode=m;get("loginTab").className=m==="login"?"on":"";get("regTab").className=m==="register"?"on":"";get("companyWrap").style.display=m==="register"?"block":"none";get("go").textContent=m==="login"?"Войти":"Создать аккаунт";get("password").autocomplete=m==="login"?"current-password":"new-password";get("err").textContent=""}get("loginTab").onclick=()=>setMode("login");get("regTab").onclick=()=>setMode("register");get("f").onsubmit=async e=>{e.preventDefault();get("go").disabled=true;get("err").textContent="";try{const r=await fetch("/api/auth/"+mode,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:get("email").value,password:get("password").value,company:get("company").value})});const d=await r.json();if(!r.ok)throw Error(d.error||"Ошибка авторизации");location.replace("/")}catch(x){get("err").textContent=x.message}get("go").disabled=false}})();</script></body></html>'
].join("");
const ppLogoutUi=[
'<style id="pp-protected-account-style">#ppProtectedAccount{position:fixed;z-index:2147480;right:8px;top:6px;font:12px Inter,system-ui,Arial,sans-serif}#ppProtectedAccount>button{border:1px solid #d5dfee;border-radius:8px;padding:8px 11px;color:#4e617c;background:#fff;cursor:pointer;box-shadow:0 1px 3px #1636580c}#ppProtectedAccount>button:hover{background:#f2f6fc}</style>',
'<div id="ppProtectedAccount"><button id="ppProtectedLogout" type="button">Выйти</button></div>',
'<script>(function(){const el=document.getElementById("ppProtectedLogout");if(!el)return;el.onclick=async()=>{el.disabled=true;el.textContent="Выходим…";try{const r=await fetch("/api/auth/logout",{method:"POST",credentials:"same-origin"});if(!r.ok)throw Error("logout_failed");try{localStorage.clear();sessionStorage.clear()}catch{}location.replace("/")}catch{el.disabled=false;el.textContent="Выйти";alert("Не удалось завершить сеанс")}}})()</script>'
].join("");
const ppSecureSessionKey=req=>{
 const raw=req.headers.get("cookie")||"";
 return require("node:crypto").createHash("sha256").update(raw).digest("hex");
};
function ppLoginResponse(){
 return new Response(ppAuthLoginPage,{status:200,headers:{
  "content-type":"text/html; charset=utf-8","cache-control":"no-store",
  "x-content-type-options":"nosniff","x-frame-options":"DENY",
  "referrer-policy":"no-referrer","content-security-policy":
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
 }});
}
function ppRequireSameOrigin(req){
 const h=req.headers;
 if(h.get("sec-fetch-site")==="cross-site")return false;
 const origin=h.get("origin");
 if(!origin)return false;
 let parsed;
 try{parsed=new URL(origin)}catch{return false}
 const railwayHost=(typeof Bun!=="undefined"&&Bun.env?.RAILWAY_PUBLIC_DOMAIN||"").trim().replace(/^https?:\/\//,"").replace(/\/$/,"").toLowerCase();
 if(railwayHost){
  return parsed.protocol==="https:"&&parsed.host.toLowerCase()===railwayHost&&parsed.pathname==="/"&&parsed.search===""&&parsed.hash==="";
 }
 // Local-only fallback for isolated tests; no permissive forwarded-host trust.
 const expected=new URL(req.url).origin;
 return parsed.origin===expected;
}
async function ppAuthFetch(req,path){
 const h=new Headers();
 const content=req.headers.get("content-type");if(content)h.set("content-type",content);
 const cookie=req.headers.get("cookie");if(cookie)h.set("cookie",cookie);
 const accept=req.headers.get("accept");if(accept)h.set("accept",accept);
 const method=req.method;
 const opts={method,headers:h,redirect:"manual",signal:AbortSignal.timeout(25000)};
 if(method!=="GET"&&method!=="HEAD"){
  const body=await req.arrayBuffer();
  if(body.byteLength>32768)return Response.json({error:"request_too_large"},{status:413});
  opts.body=body;
 }
 const upstream=await fetch(PP_AUTH_GATEWAY_ORIGIN+path,opts);
 if(upstream.status>=300&&upstream.status<400)return Response.json({error:"auth_redirect_disallowed"},{status:502});
 const outHeaders=new Headers(upstream.headers);
 for(const k of ["content-length","content-encoding","transfer-encoding","access-control-allow-origin","access-control-allow-credentials","set-cookie"])outHeaders.delete(k);
 const originalCookies=typeof upstream.headers.getSetCookie==="function"?upstream.headers.getSetCookie():[];
 if(!originalCookies.length&&upstream.headers.get("set-cookie"))originalCookies.push(upstream.headers.get("set-cookie"));
 for(const original of originalCookies)outHeaders.append("set-cookie",original.replace(/;\s*Domain=[^;]+/gi,""));
 outHeaders.set("cache-control","no-store");
 outHeaders.set("x-content-type-options","nosniff");
 return new Response(upstream.body,{status:upstream.status,headers:outHeaders});
}
async function ppVerifyLogin(req){
 const cookie=req.headers.get("cookie")||"";
 if(!cookie||cookie.length>8192)return false;
 const response=await fetch(PP_AUTH_GATEWAY_ORIGIN+"/api/auth/me",{
  method:"GET",headers:{"cookie":cookie,"accept":"application/json"},
  redirect:"manual",signal:AbortSignal.timeout(12000),cache:"no-store"
 });
 if(response.status!==200)return false;
 const data=await response.json().catch(()=>null);
 if(!data||typeof data!=="object"||data.ok===false||data.error)return false;
 return true;
}
async function ppAuthenticatedHandler(req){
 const path=new URL(req.url).pathname;
 if(path==="/__bridge_health"&&req.method==="GET")
  return Response.json({ok:true,auth:true},{headers:{"cache-control":"no-store"}});
 if(path.startsWith("/api/auth/")){
  if(!["/api/auth/login","/api/auth/register","/api/auth/logout","/api/auth/me"].includes(path))
   return Response.json({error:"route_not_found"},{status:404});
  if((path==="/api/auth/me") !== (req.method==="GET"))return Response.json({error:"method_not_allowed"},{status:405});
  if(req.method!=="GET"&&req.method!=="POST")return Response.json({error:"method_not_allowed"},{status:405});
  if(req.method==="POST"&&!ppRequireSameOrigin(req))return Response.json({error:"cross_origin_forbidden"},{status:403});
  return ppAuthFetch(req,path);
 }
 if(!["GET","HEAD","OPTIONS"].includes(req.method)&&!ppRequireSameOrigin(req))
  return Response.json({error:"cross_origin_forbidden"},{status:403});
 let authenticated=false;
 try{authenticated=await ppVerifyLogin(req)}
 catch(e){
  console.warn("PP_AUTH_UPSTREAM_UNAVAILABLE",String(e).slice(0,80));
  return Response.json({error:"authentication_service_unavailable"},{status:503,headers:{"cache-control":"no-store"}});
 }
 if(!authenticated){
  if(req.method==="GET"&&path==="/")return ppLoginResponse();
  return Response.json({error:"authentication_required"},{status:401,headers:{"cache-control":"no-store"}});
 }
 if(req.method==="GET"&&path==="/"){
  const res=await handler(req);
  if(!res.headers.get("content-type")?.toLowerCase().includes("text/html"))return res;
  const html=await res.text();
  const output=html.includes("</body>")?html.replace("</body>",ppLogoutUi+"</body>"):html;
  const h=new Headers(res.headers);h.delete("content-length");h.set("cache-control","no-store");
  return new Response(output,{status:res.status,headers:h});
 }
 const res=await handler(req);
 const h=new Headers(res.headers);h.set("cache-control","no-store");
 return new Response(res.body,{status:res.status,headers:h});
}
