import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const patch=readFileSync(new URL("./repair-planner-ui.mjs",import.meta.url),"utf8");
const transport=readFileSync(new URL("../../async-plan-transport.js",import.meta.url),"utf8");
const match=patch.match(/const gaProgressRecovery=(\[[^\n]+\]);/);
assert(match,"recovery specification should exist");
const replacements=JSON.parse(match[1]);
function patchedTransport(){
 let source=transport;
 for(const [before,after] of replacements){
  assert.equal(source.split(before).length-1,1,"unique transport anchor");
  source=source.replace(before,after);
 }
 new vm.Script(source);
 return source;
}
const recovered=patchedTransport();

async function scenario(sequence){
 let progressIndex=0;
 const requests=[];
 const json=(data,status=200)=>Response.json(data,{status});
 const fakeFetch=async (input,options={})=>{
  const path=new URL(typeof input==="string"?input:input.url,"https://app.liftorbit.app").pathname;
  requests.push({path,method:options.method||"GET"});
  if(path==="/api/plan")return json({ok:true,started:true},202);
  assert.equal(path,"/api/plan-progress");
  // joinOrStart asks for current progress once before starting a new run.
  if(progressIndex++===0)return json({ok:true,running:false,phase:"idle"});
  const item=sequence.shift();
  assert(item,"test exhausted progress responses");
  if(item==="broken")return new Response("<html>temporary upstream failure</html>",{status:502,headers:{"content-type":"text/html"}});
  if(item==="server")return json({ok:false,error:"temporary_upstream"},503);
  if(item==="unauthorized")return json({ok:false,error:"authentication_required"},401);
  if(item==="running")return json({ok:true,running:true,percent:50,phase:"running"});
  return json({ok:true,running:false,success:true,phase:"completed",
    result:{valid:true,operations:[{order:"QA_ORDER"}],duration_minutes:90}});
 };
 const win={fetch:fakeFetch,dispatchEvent:()=>{}};
 const context={window:win,URL,Request,Response,Headers,CustomEvent,
  DOMException,location:{href:"https://app.liftorbit.app/"},console,
  setTimeout:(fn)=>{fn();return 1}};
 vm.runInNewContext(recovered,context);
 const result=await win.fetch("/api/plan",{method:"POST",
  body:JSON.stringify({generations:100})});
 return {status:result.status,body:await result.json(),requests};
}
test("recovery keeps running GA through six non-JSON proxy responses",async()=>{
 const result=await scenario([...Array(6).fill("broken"),"running","completed"]);
 assert.equal(result.status,200);
 assert.equal(result.body.duration_minutes,90);
 assert.equal(result.requests.filter(r=>r.path==="/api/plan"&&r.method==="POST").length,1);
 assert.equal(result.requests.filter(r=>r.path==="/api/plan-progress").length,9);
});
test("recovery keeps running GA through six temporary JSON HTTP 503 responses",async()=>{
 const result=await scenario([...Array(6).fill("server"),"running","completed"]);
 assert.equal(result.status,200);
 assert.equal(result.body.valid,true);
});
test("authentication failures are never retried as transport errors",async()=>{
 const result=await scenario(["unauthorized"]);
 assert.equal(result.status,401);
 assert.equal(result.body.error,"authentication_required");
 assert.equal(result.requests.filter(r=>r.path==="/api/plan-progress").length,2);
});
test("temporary recovery never reads saved plans or alters account data",()=>{
 assert(!recovered.includes("/api/db-storage"));
 assert(!recovered.includes("ga_progress_invalid_json"));
 assert(recovered.includes('ga_progress_response_unavailable'));
 assert(recovered.includes("Date.now()-badProgressAt<60000"));
});
