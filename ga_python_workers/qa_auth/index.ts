// LiftOrbit QA-only auth/storage gateway. Never connect to the customer database.
// Source contains no secrets: DATABASE_URL is injected from a separate Railway Postgres.
import { SQL } from "bun";
import { randomBytes, randomUUID, createHash, timingSafeEqual } from "node:crypto";

if(Bun.env.PP_QA_AUTH_ONLY!=="1")throw Error("qa_auth_flag_required");
if(!Bun.env.DATABASE_URL || !/^postgres(ql)?:\/\//.test(Bun.env.DATABASE_URL))
  throw Error("qa_postgres_url_required");
const sql=new SQL(Bun.env.DATABASE_URL,{max:8,connectionTimeout:8,idleTimeout:30});
const ddl=[
"CREATE TABLE IF NOT EXISTS qa_accounts (id text PRIMARY KEY, email text UNIQUE NOT NULL, company text NOT NULL DEFAULT '', passwd_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())",
"CREATE TABLE IF NOT EXISTS qa_sessions (token_hash text PRIMARY KEY, account_id text NOT NULL REFERENCES qa_accounts(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now())",
"CREATE TABLE IF NOT EXISTS qa_storage (account_id text PRIMARY KEY REFERENCES qa_accounts(id) ON DELETE CASCADE, storage jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now())",
"CREATE TABLE IF NOT EXISTS qa_optimization_jobs (id text PRIMARY KEY, account_id text NOT NULL REFERENCES qa_accounts(id) ON DELETE CASCADE, worker_job_id text, status text NOT NULL, model_hash text NOT NULL, progress integer NOT NULL DEFAULT 0, resume_state jsonb, best_plan jsonb, result jsonb, error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())",
"CREATE TABLE IF NOT EXISTS qa_password_resets (token_hash text PRIMARY KEY, account_id text NOT NULL REFERENCES qa_accounts(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())",
"CREATE INDEX IF NOT EXISTS qa_sessions_expiry_idx ON qa_sessions(expires_at)",
"CREATE INDEX IF NOT EXISTS qa_jobs_account_idx ON qa_optimization_jobs(account_id,created_at DESC)",
"CREATE INDEX IF NOT EXISTS qa_password_resets_account_idx ON qa_password_resets(account_id,created_at DESC)"
];
for(const statement of ddl)await sql.unsafe(statement);
const digest=v=>createHash("sha256").update(v).digest("hex");
const cookieName="liftorbit_qa_session";
const resetPublicOrigin=String(Bun.env.PP_PASSWORD_RESET_PUBLIC_ORIGIN||"https://app.liftorbit.app").replace(/\/+$/,"");
const resetFrom=String(Bun.env.PP_PASSWORD_RESET_FROM||"").trim();
const resendKey=String(Bun.env.RESEND_API_KEY||"").trim();
const resetReady=/^https:\/\//.test(resetPublicOrigin)&&resetFrom.length>=5&&resendKey.length>=20;
const validEmail=email=>/^[^\s@]{1,80}@[^\s@]{1,120}\.[^\s@]{2,32}$/.test(email);
async function sendResetEmail(to,token){
 if(!resetReady)throw Error("password_reset_unavailable");
 const link=resetPublicOrigin+"/#reset_token="+encodeURIComponent(token);
 const html='<div style="font-family:Arial,sans-serif;color:#213450;line-height:1.55"><h2 style="margin:0 0 16px">Reset your LiftOrbit password</h2><p>We received a request to reset your LiftOrbit password.</p><p><a href="'+link+'" style="display:inline-block;padding:12px 18px;background:#2467dd;color:#fff;text-decoration:none;border-radius:8px">Set a new password</a></p><p>This link expires in 30 minutes and can be used only once.</p><p>If you did not request a password reset, you can ignore this email.</p></div>';
 const text="Reset your LiftOrbit password\n\nOpen this link to set a new password:\n"+link+"\n\nThis link expires in 30 minutes and can be used only once.\nIf you did not request a password reset, ignore this email.";
 const response=await fetch("https://api.resend.com/emails",{
  method:"POST",
  headers:{"authorization":"Bearer "+resendKey,"content-type":"application/json"},
  body:JSON.stringify({from:resetFrom,to:[to],subject:"Reset your LiftOrbit password",html,text}),
  signal:AbortSignal.timeout(15000)
 });
 if(!response.ok){
  if(response.body)try{await response.body.cancel()}catch{}
  throw Error("reset_email_failed");
 }
 if(response.body)try{await response.body.cancel()}catch{}
}
const ok=(status,value,cookie)=>{
 const h={"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"};
 if(cookie)h["set-cookie"]=cookie;
 return new Response(JSON.stringify(value),{status,headers:h});
};
const err=(s,reason)=>ok(s,{ok:false,error:reason});
function readCookie(req){
 const raw=req.headers.get("cookie")||"";
 const part=raw.split(";").map(x=>x.trim()).find(x=>x.startsWith(cookieName+"="));
 const token=part?part.slice(cookieName.length+1):"";
 return /^[A-Za-z0-9_-]{40,130}$/.test(token)?token:null;
}
async function lookup(req){
 const token=readCookie(req);
 if(!token)return null;
 const rows=await sql.unsafe("SELECT a.id,a.email,a.company FROM qa_sessions s JOIN qa_accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>now() LIMIT 1",[digest(token)]);
 return rows[0]||null;
}
async function createSession(id){
 const token=randomBytes(48).toString("base64url");
 await sql.unsafe("INSERT INTO qa_sessions(token_hash,account_id,expires_at) VALUES($1,$2,now()+interval '24 hours')",[digest(token),id]);
 return cookieName+"="+token+"; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400";
}
const isObj=x=>!!x&&typeof x==="object"&&!Array.isArray(x);
const outStorage=async id=>{
 const r=await sql.unsafe("SELECT storage FROM qa_storage WHERE account_id=$1",[id]);
 const v=r[0]?.storage;
 return isObj(v)?v:typeof v==="string"?JSON.parse(v):{};
};
async function store(id,storage){
 await sql.unsafe("INSERT INTO qa_storage(account_id,storage,updated_at) VALUES($1,$2::jsonb,now()) ON CONFLICT(account_id) DO UPDATE SET storage=excluded.storage,updated_at=now()",[id,JSON.stringify(storage)]);
}
async function body(req){
 const raw=await req.text();
 if(raw.length>1900000)throw Error("body_too_large");
 const x=JSON.parse(raw);if(!isObj(x))throw Error("invalid_object");
 return x;
}

function verifiedInternal(req){
 const secret=Bun.env.PP_QA_STATE_TOKEN||"";
 const provided=(req.headers.get("authorization")||"").replace(/^Bearer /,"");
 const a=Buffer.from(secret),b=Buffer.from(provided);
 return a.length>=32&&a.length===b.length&&timingSafeEqual(a,b);
}
const validUuid=x=>typeof x==="string"&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(x);
const validJob=x=>typeof x==="string"&&/^[0-9a-f]{32}$/.test(x);
async function internalState(req,path,method){
 if(!verifiedInternal(req))return err(401,"qa_internal_token_required");
 if(path!=="/internal/ga-state")return err(404,"not_found");
 if(method==="GET"){
  const account=new URL(req.url).searchParams.get("account_id");
  if(!validUuid(account))return err(422,"invalid_account_id");
  const rows=await sql.unsafe("SELECT id,account_id,worker_job_id,status,model_hash,progress,resume_state,best_plan,result,error FROM qa_optimization_jobs WHERE account_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",[account]);
  return ok(200,{ok:true,state:rows[0]?{job_id:rows[0].id,account_id:rows[0].account_id,worker_job_id:rows[0].worker_job_id,status:rows[0].status,model_hash:rows[0].model_hash,progress:rows[0].progress,resume_state:rows[0].resume_state,best_preview:rows[0].best_plan,result:rows[0].result,error:rows[0].error}:null});
 }
 if(method==="POST"){
  const value=await body(req),account=value.account_id,job=value.job_id,status=value.status;
  if(!validUuid(account)||!validJob(job)||typeof value.model_hash!=="string"||!/^[a-f0-9]{64}$/.test(value.model_hash)||!["queued","running","completed","cancelled","timed_out","failed","stale","invalid","interrupted"].includes(status))return err(422,"invalid_state");
  const progress=Math.max(0,Math.min(100,Number(value.progress)||0));
  const encode=x=>x==null?null:JSON.stringify(x);
  const rows=await sql.unsafe("INSERT INTO qa_optimization_jobs(id,account_id,worker_job_id,status,model_hash,progress,resume_state,best_plan,result,error,updated_at) VALUES($1,$2,$1,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,now()) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,model_hash=EXCLUDED.model_hash,progress=EXCLUDED.progress,resume_state=COALESCE(EXCLUDED.resume_state,qa_optimization_jobs.resume_state),best_plan=COALESCE(EXCLUDED.best_plan,qa_optimization_jobs.best_plan),result=COALESCE(EXCLUDED.result,qa_optimization_jobs.result),error=EXCLUDED.error,updated_at=now() WHERE qa_optimization_jobs.account_id=EXCLUDED.account_id RETURNING id",[job,account,status,value.model_hash,progress,encode(value.resume_state),encode(value.best_preview),encode(value.result),typeof value.error==="string"?value.error.slice(0,140):null]);
  if(!rows.length)return err(409,"state_account_mismatch");
  return ok(200,{ok:true,job_id:job});
 }
 return err(405,"method_not_allowed");
}

async function handler(req){
 const path=new URL(req.url).pathname,method=req.method;
 try{
  if(path.startsWith("/internal/"))return await internalState(req,path,method);
  if(path==="/health"&&method==="GET"){
   const r=await sql.unsafe("SELECT 1 AS ok");
   return ok(r[0]?.ok===1?200:503,{ok:r[0]?.ok===1,qa_only:true,password_reset:resetReady});
  }
  if(path==="/api/auth/register"&&method==="POST"){
   const x=await body(req),email=String(x.email||"").trim().toLowerCase(),pw=x.password;
   if(!validEmail(email)||typeof pw!=="string"||pw.length<10||pw.length>128)return err(422,"invalid_credentials_format");
   const id=randomUUID(),hash=await Bun.password.hash(pw);
   const rows=await sql.unsafe("INSERT INTO qa_accounts(id,email,company,passwd_hash) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING RETURNING id",[id,email,String(x.company||"").slice(0,120),hash]);
   if(!rows.length)return err(409,"account_already_exists");
   await sql.unsafe("INSERT INTO qa_storage(account_id) VALUES($1) ON CONFLICT DO NOTHING",[id]);
   const c=await createSession(id);
   return ok(200,{ok:true,account_id:id},c);
  }
  if(path==="/api/auth/login"&&method==="POST"){
   const x=await body(req),email=String(x.email||"").trim().toLowerCase(),pw=x.password;
   if(!email||typeof pw!=="string")return err(422,"invalid_credentials_format");
   const rows=await sql.unsafe("SELECT id,passwd_hash FROM qa_accounts WHERE email=$1 LIMIT 1",[email]);
   if(!rows.length||!await Bun.password.verify(pw,rows[0].passwd_hash))return err(401,"invalid_credentials");
   return ok(200,{ok:true,account_id:rows[0].id},await createSession(rows[0].id));
  }
  if(path==="/api/auth/forgot-password"&&method==="POST"){
   if(!resetReady)return err(503,"password_reset_unavailable");
   const x=await body(req),email=String(x.email||"").trim().toLowerCase();
   if(!validEmail(email))return err(422,"invalid_email");
   const generic={ok:true};
   const rows=await sql.unsafe("SELECT id,email FROM qa_accounts WHERE email=$1 LIMIT 1",[email]);
   if(!rows.length){await Bun.sleep(120);return ok(200,generic)}
   const account=rows[0];
   const recent=await sql.unsafe("SELECT count(*)::int AS n FROM qa_password_resets WHERE account_id=$1 AND created_at>now()-interval '15 minutes'",[account.id]);
   if(Number(recent[0]?.n||0)>=3)return ok(200,generic);
   await sql.unsafe("DELETE FROM qa_password_resets WHERE account_id=$1 AND (used_at IS NOT NULL OR expires_at<now())",[account.id]);
   const token=randomBytes(32).toString("base64url"),tokenHash=digest(token);
   await sql.unsafe("INSERT INTO qa_password_resets(token_hash,account_id,expires_at) VALUES($1,$2,now()+interval '30 minutes')",[tokenHash,account.id]);
   try{await sendResetEmail(account.email,token)}
   catch(_){
    await sql.unsafe("DELETE FROM qa_password_resets WHERE token_hash=$1",[tokenHash]);
    console.warn("PASSWORD_RESET_EMAIL_FAILED");
   }
   return ok(200,generic);
  }
  if(path==="/api/auth/reset-password"&&method==="POST"){
   const x=await body(req),token=String(x.token||""),pw=x.password;
   if(!/^[A-Za-z0-9_-]{40,90}$/.test(token)||typeof pw!=="string"||pw.length<10||pw.length>128)
    return err(422,"invalid_reset_format");
   const nextHash=await Bun.password.hash(pw);
   const rows=await sql.unsafe("WITH claimed AS (UPDATE qa_password_resets SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() RETURNING account_id), changed AS (UPDATE qa_accounts a SET passwd_hash=$2 FROM claimed c WHERE a.id=c.account_id RETURNING a.id), revoked AS (DELETE FROM qa_sessions s USING changed c WHERE s.account_id=c.id RETURNING s.account_id) SELECT id FROM changed LIMIT 1",[digest(token),nextHash]);
   if(!rows.length)return err(400,"invalid_or_expired_reset_token");
   await sql.unsafe("DELETE FROM qa_password_resets WHERE account_id=$1",[rows[0].id]);
   return ok(200,{ok:true});
  }
  if(path==="/api/auth/logout"&&method==="POST"){
   const token=readCookie(req);
   if(token)await sql.unsafe("DELETE FROM qa_sessions WHERE token_hash=$1",[digest(token)]);
   return ok(200,{ok:true},cookieName+"=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
  }
  if(!["/api/auth/me","/api/db-storage","/api/project/model/import"].includes(path))return err(404,"route_not_found");
  const account=await lookup(req);
  if(!account)return err(401,"authentication_required");
  if(path==="/api/auth/me"&&method==="GET")
    return ok(200,{ok:true,account_id:account.id,user:{id:account.id,email:account.email,company:account.company}});
  if(path==="/api/db-storage"&&method==="GET")
    return ok(200,{ok:true,storage:await outStorage(account.id)});
  if(path==="/api/db-storage"&&method==="POST"){
   const x=await body(req);let v=x.storage;
   if(!isObj(v)&&typeof x.key==="string"&&x.key.length<=150&&"value" in x){
     v=await outStorage(account.id);v[x.key]=x.value;
   }
   if(!isObj(v)||JSON.stringify(v).length>1800000)return err(422,"invalid_storage");
   await store(account.id,v);
   return ok(200,{ok:true,storage:v});
  }
  if(path==="/api/project/model/import"&&method==="POST"){
   const x=await body(req);
   if(!isObj(x.model)||!Array.isArray(x.model.orders))return err(422,"invalid_model");
   const storage=await outStorage(account.id);
   storage["prodplan.projects.v2"]=JSON.stringify([{id:"qa-isolated-project",name:"QA Test Model",model:x.model}]);
   storage["prodplan.project.active.v2"]="qa-isolated-project";
   await store(account.id,storage);
   return ok(200,{ok:true,model:x.model});
  }
  return err(405,"method_not_allowed");
 }catch(e){
  // No exception text, credentials, cookies, client data, or SQL is written to logs.
  return err(e?.message==="body_too_large"?413:503,"qa_request_failed");
 }
}
if(String(Bun.env.PP_PASSWORD_RESET_DIAGNOSTIC||"")==="1"){
  try{
    const rows=await sql.unsafe("SELECT id FROM qa_accounts WHERE lower(email)=lower($1) LIMIT 2",["fadeev.msa@gmail.com"]);
    console.log("PASSWORD_RESET_DIAGNOSTIC",JSON.stringify({found:rows.length===1,count:rows.length}));
  }catch(_){
    console.log("PASSWORD_RESET_DIAGNOSTIC",JSON.stringify({found:false,count:-1}));
  }
}
Bun.serve({port:Number(Bun.env.PORT||8080),fetch:handler});
console.log("LIFTORBIT_QA_AUTH_READY",JSON.stringify({port:Number(Bun.env.PORT||8080),storage:"isolated-postgres",ready:true}));
