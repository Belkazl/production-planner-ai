const assert=require("node:assert/strict");
const fs=require("node:fs");
const fixture=JSON.parse(fs.readFileSync("/tmp/pp-ceramics-live-model.json","utf8")).model;
const base="http://127.0.0.1:8080";
async function hit(method,path,tenant="tenantA",body){
 const r=await fetch(base+path,{method,headers:{
  "content-type":"application/json","accept":"application/json",
  "cookie":"pp_demo_auth="+tenant,
  ...(method!=="GET"?{"origin":base}:{}),
 },body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
 return {status:r.status,data:await r.json()};
}
(async()=>{
 const login=await hit("GET","/api/auth/me");
 assert.equal(login.status,200);
 const init=await hit("POST","/api/project/model/import","tenantA",{model:fixture});
 assert.equal(init.status,200,JSON.stringify(init.data).slice(0,260));
 assert.equal(init.data.ok,true);
 const updated=init.data.model;
 assert.equal(updated.orders.length,12,"orders missing after secure import");
 assert.deepEqual(updated.orders,fixture.orders,"order data modified");
 assert.deepEqual(updated.setup_rules,fixture.setup_rules,"setup changeovers modified");
 assert.equal(updated.equipment.find(x=>x.id==="E10").capabilities.allowed_firing_recipes.includes("PS-02"),true);
 assert.equal(updated.equipment.find(x=>x.id==="E11").capabilities.allowed_firing_recipes.includes("PS-03"),true);
 const fromServer=await hit("GET","/api/model");
 assert.equal(fromServer.status,200);
 assert.deepEqual(fromServer.data.model.equipment,updated.equipment,"migrated equipment not imported into protected backend");
 const foreign=structuredClone(fixture);
 foreign.orders=[{id:"UNRELATED_ORDER",technical_process_id:"TP_MISC",parameters:{firing_recipe:"PS-04"}}];
 const other=await hit("POST","/api/project/model/import","tenantB",{model:foreign});
 assert.equal(other.status,200);
 assert.deepEqual(other.data.model,foreign,"other accounts/fixtures changed");
 const otherRead=await hit("GET","/api/model","tenantB");
 assert.deepEqual(otherRead.data.model,foreign,"cross-tenant model leak");
 const before=Date.now();
 const slow=await hit("POST","/api/plan","tenantA",{objective:"duration",generations:240,population:80});
 const elapsed=Date.now()-before;
 assert(elapsed>=12000,"mock must simulate > 10s optimization, got "+elapsed);
 assert.equal(slow.status,200,JSON.stringify(slow.data));
 assert.equal(slow.data.error,"synthetic_slow_ga_finished");
 console.log("CERAMIC_AUTHENTICATED_IMPORT_AND_GA_TIMEOUT_PASS",JSON.stringify({orders:updated.orders.length,setupRules:updated.setup_rules.length,firingRecipe2OnE10:true,firingRecipe3OnE11:true,accountsIsolated:true,planWaitMs:elapsed,noBunTimeout:true}));
})().catch(e=>{console.error(e);process.exit(1)});
