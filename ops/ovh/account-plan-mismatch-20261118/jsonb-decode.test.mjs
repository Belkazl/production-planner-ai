import test from "node:test";
import assert from "node:assert/strict";
import {createGAStateStore} from "../ga-python-state-store.mjs";
const account="11111111-1111-1111-1111-111111111111";
const plan={valid:true,operations:[{order:"O1",equipment_ids:["M1"]}]};
function make({returnStrings=true}={}){
 const response={ok:true,state:{job_id:"a".repeat(32),status:"completed",
  result:returnStrings?JSON.stringify(plan):plan,
  best_preview:returnStrings?JSON.stringify(plan):plan,
  resume_state:returnStrings?'{"version":1,"order_sequence":["O1"]}':{version:1,order_sequence:["O1"]}}};
 const fetchImpl=async(url,opts)=>{
  assert.equal(opts.headers.authorization,"Bearer "+"t".repeat(36));
  return Response.json(response);
 };
 return createGAStateStore({enabled:true,
  origin:"http://auth-gateway.railway.internal:8080",token:"t".repeat(36),fetchImpl});
}
test("double-encoded JSONB plans are decoded into bounded plain objects",async()=>{
 const x=await make().load(account);
 assert.deepEqual(x.result,plan);
 assert.deepEqual(x.best_preview,plan);
 assert.deepEqual(x.resume_state.order_sequence,["O1"]);
});
test("normal PostgreSQL JSONB objects are left intact",async()=>{
 const x=await make({returnStrings:false}).load(account);
 assert.deepEqual(x.result,plan);
 assert.deepEqual(x.best_preview,plan);
});
test("invalid account is never accepted",async()=>{
 await assert.rejects(()=>make().load("not an account id"),/qa_state_account_required/);
});
