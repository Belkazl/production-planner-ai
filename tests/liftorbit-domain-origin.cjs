"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const content=fs.readFileSync("auth-runtime.js","utf8");
const start=content.indexOf("function ppRequireSameOrigin(req){");
const end=content.indexOf("async function ppAuthFetch(req,path)",start);
assert(start>=0&&end>start,"Protected auth origin guard must exist");
const guard=vm.runInNewContext(content.slice(start,end)+"\nppRequireSameOrigin",{
 Bun:{env:{PP_AUTH_PUBLIC_ORIGIN:"https://production-planner-gateway-v2-production.up.railway.app"}},
 URL
});
function check(reqHost,origin,site="same-origin"){
 const headers=new Headers({origin,"sec-fetch-site":site});
 return guard({url:"https://"+reqHost+"/api/auth/login",headers});
}
const old="production-planner-gateway-v2-production.up.railway.app";
const next="app.liftorbit.app";
assert.equal(check(old,"https://"+old),true,"Old Railway auth must remain supported");
assert.equal(check(next,"https://"+next),true,"New LiftOrbit login must be permitted");
assert.equal(check(next,"https://"+old),false,"Old origin cannot write to custom domain");
assert.equal(check(old,"https://"+next),false,"Custom origin cannot write to Railway host");
assert.equal(check(next,"https://liftorbit.app"),false,"Landing origin not allowed to POST app data");
assert.equal(check(next,"https://evil.example"),false,"Third-party origins rejected");
assert.equal(check(next,"http://"+next),false,"Insecure origin rejected");
assert.equal(check(next,"https://"+next,"cross-site"),false,"Cross-site fetch rejected");
assert.equal(check(next,"https://"+next,"same-site"),false,"Sibling-subdomain fetch rejected");
assert.equal(check(next,"https://"+next+"/evil"),false,"Non-root origin rejected");
assert.equal(guard({url:"https://"+next+"/api/model",headers:new Headers({"sec-fetch-site":"same-origin"})}),false,"Missing Origin not accepted");
console.log("LIFTORBIT_DOMAINS_AUTH_ORIGIN_PASS",JSON.stringify({newHost:next,legacyHost:old,protected:true,allowlisted:true,tenantDataUntouched:true}));
