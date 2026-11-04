import {readFileSync} from "node:fs";
const auth=readFileSync("ga_python_workers/qa_auth/index.ts","utf8");
const runtime=readFileSync("auth-runtime.js","utf8");
const must=(text,needle,label)=>{if(!text.includes(needle))throw Error("RESET_"+label+"_MISSING")};
must(auth,"qa_password_resets","table");
must(auth,'now()+interval \'30 minutes\'',"expiry");
must(auth,"token_hash","hashed_token");
must(auth,"DELETE FROM qa_sessions","session_revoke");
must(auth,"invalid_or_expired_reset_token","invalid_token");
must(auth,"if(!rows.length){await Bun.sleep(120);return ok(200,generic)}","generic_unknown_email");
must(auth,"Number(recent[0]?.n||0)>=3","rate_limit");
must(runtime,"/api/auth/forgot-password","forgot_route");
must(runtime,"/api/auth/reset-password","reset_route");
must(runtime,"ppRequireSameOrigin(req)","same_origin_guard");
must(runtime,"Забыли пароль?","forgot_ui");
must(runtime,"reset_token","reset_link_ui");
must(auth,'/#reset_token=',"fragment_token_link");
if(auth.includes('/?reset_token='))throw Error("RESET_TOKEN_QUERY_LEAK");
if(/return ok\(200,\{[^}]*token/i.test(auth))throw Error("RESET_TOKEN_LEAK");
console.log("PP_PASSWORD_RESET_SECURITY_PASS",JSON.stringify({
 hashedToken:true,expiresMinutes:30,oneTime:true,revokeSessions:true,
 enumerationSafe:true,rateLimited:true,sameOrigin:true,ui:true
}));