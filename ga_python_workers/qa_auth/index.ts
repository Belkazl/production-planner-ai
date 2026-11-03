// LiftOrbit QA-only auth/storage gateway. Never connect to the customer database.
// Source contains no secrets: DATABASE_URL is injected from a separate Railway Postgres.
import { SQL } from "bun";
import { randomBytes, randomUUID, createHash } from "node:crypto";

if(Bun.env.PP_QA_AUTH_ONLY!=="1")throw Error("qa_auth_flag_required");
if(!Bun.env.DATABASE_URL || !/^postgres(ql)?:\/\//.test(Bun.env.DATABASE_URL))
  throw Error("qa_postgres_url_required");
const sql=new SQL(Bun.env.DATABASE_URL,{max:8,connectionTimeout:8,idleTimeout:30});
const ddl=[
"CREATE TABLE IF NOT EXISTS qa_accounts (id text PRIMARY KEY, email text UNIQUE NOT NULL, company text NOT NULL DEFAULT '', passwd_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())",
"CREATE TABLE IF NOT EXISTS qa_sessions (token_hash text PRIMARY KEY, account_id text NOT NULL REFERENCES qa_accounts(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now())",
"CREATE TABLE IF NOT EXISTS qa_storage (account_id text PRIMARY KEY REFERENCES qa_accounts(id) ON DELETE CASCADE, storage jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now())",
"CREATE TABLE IF NOT EXISTS qa_optimization_jobs (id text PRIMARY KEY, account_id text NOT NULL REFERENCES qa_accounts(id) ON DELETE CASCADE, worker_job_id text, status text NOT NULL, model_hash text NOT NULL, progress integer NOT NULL DEFAULT 0, resume_state jsonb, best_plan jsonb, result jsonb, error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())",
"CREATE INDEX IF NOT EXISTS qa_sessions_expiry_idx ON qa_sessions(expires_at)",
"CREATE INDEX IF NOT EXISTS qa_jobs_account_idx ON qa_optimization_jobs(account_id,created_at DESC)"
];
for(const statement of ddl)await sql.unsafe(statement);
const digest=v=>createHash("sha256").update(v).digest("hex");
const cookieName="liftorbit_qa_session";
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
async function handler(req){
 const path=new URL(req.url).pathname,method=req.method;
 try{
  if(path==="/health"&&method==="GET"){
   const r=await sql.unsafe("SELECT 1 AS ok");
   return ok(r[0]?.ok===1?200:503,{ok:r[0]?.ok===1,qa_only:true});
  }
  if(path==="/api/auth/register"&&method==="POST"){
   const x=await body(req),email=String(x.email||"").trim().toLowerCase(),pw=x.password;
   if(!/^[^\s@]{1,80}@[^\s@]{1,120}\.[^\s@]{2,32}$/.test(email)||typeof pw!=="string"||pw.length<10||pw.length>128)return err(422,"invalid_credentials_format");
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
Bun.serve({port:Number(Bun.env.PORT||8080),fetch:handler});
console.log("LIFTORBIT_QA_AUTH_READY",JSON.stringify({port:Number(Bun.env.PORT||8080),storage:"isolated-postgres",ready:true}));
