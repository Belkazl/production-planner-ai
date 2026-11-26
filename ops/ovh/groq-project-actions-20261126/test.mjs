import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {ppGroqPrepareEdit} from "./prepare.mjs";
import {patchTenant,patchAuth} from "./patch.mjs";
import {patchTenant as patchContext} from "../groq-project-context-20261126/patch.mjs";
const model={scheduler_mode:"resource",quantity_unit:"m2",orders:[{id:2606,area:900,quantity:900,unit:"m2",technical_process_id:"P",process_hours:1,parameters:{color:"blue"}},{id:2607,area:800,quantity:800,unit:"m2",technical_process_id:"P",process_hours:1}],equipment:[{id:"E1",name:"Machine A",capacity:100,capacity_unit:"m2",timing_profile:{throughput_per_hour:60}}],employees:[{id:"EMP1",name:"PRIVATE_EMPLOYEE",shift:"day"}],shifts:{day:[["08:00","12:00"]],night:[["17:00","23:00"]]},materials:[{id:"M1",name:"Clay",unit:"kg",initial_stock:100}],technical_processes:[{id:"P",name:"Ceramics",operations:[{id:"OP1",name:"Pressing",duration_min:60}]}],setup_rules:[]};
const add={kind:"add_order",quantity:600};
test("add order infers the existing sole process and unit and generates unique number",()=>{
 const r=ppGroqPrepareEdit(model,add);
 assert.equal(r.model.orders.length,3);assert.deepEqual(r.model.orders[2],{id:2608,area:600,quantity:600,unit:"m2",technical_process_id:"P",process_hours:1});
 assert.deepEqual(r.model.orders.slice(0,2),model.orders);assert.equal(model.orders.length,2);
 for(const key of Object.keys(model).filter(x=>x!=="orders"))assert.deepEqual(r.model[key],model[key]);
 assert.throws(()=>ppGroqPrepareEdit(model,{...add,order_id:"2606"}),/duplicate_order/);
 assert.throws(()=>ppGroqPrepareEdit(model,{...add,unit:"kg"}),/unit_mismatch/);
 assert.throws(()=>ppGroqPrepareEdit({...model,technical_processes:[...model.technical_processes,{id:"P2"}]},add),/choose_process/);
});
test("other permitted edits change only the requested existing field",()=>{
 const pairs=[
 [{kind:"update_order",order_index:1,quantity:700},m=>m.orders[0].quantity,700],
 [{kind:"update_equipment_capacity",equipment_index:1,value:200},m=>m.equipment[0].capacity,200],
 [{kind:"update_equipment_rate",equipment_index:1,value:90},m=>m.equipment[0].timing_profile.throughput_per_hour,90],
 [{kind:"update_material_stock",material_index:1,value:0},m=>m.materials[0].initial_stock,0],
 [{kind:"update_employee_shift",employee_index:1,shift:"night"},m=>m.employees[0].shift,"night"],
 [{kind:"update_operation_duration",process_index:1,operation_index:1,value:50},m=>m.technical_processes[0].operations[0].duration_min,50]
 ];
 for(const [a,get,want] of pairs){const before=get(model);assert.equal(get(ppGroqPrepareEdit(model,a).model),want);assert.equal(get(model),before)}
 for(const a of [{kind:"delete_project"},{kind:"add_order",quantity:-1},{kind:"add_order",quantity:600,model:{}},{kind:"update_employee_shift",employee_index:1,shift:"imagined"},{kind:"update_order",order_index:99,quantity:600},{kind:"update_equipment_capacity",equipment_index:1,value:Infinity}])assert.throws(()=>ppGroqPrepareEdit(model,a));
});
const old=readFileSync(new URL("../groq-assistant-20261125/assistant-runtime.js",import.meta.url),"utf8");
const ctx=readFileSync(new URL("../groq-project-context-20261126/context-runtime.js",import.meta.url),"utf8");
const installed=patchContext(old,old,ctx),runtime=patchTenant(installed);
const base="https://app.liftorbit.app";
const view={projectId:"own",revision:7,view:"resource_utilization",kpis:{duration:"100"},utilization:[],utilizationSource:"visible_resource_utilization",totalRows:0};
function environment({login=true,origin=true,tool=add,answer=null}={}){
 const calls=[];
 const storage={"prodplan.projects.v2":JSON.stringify([{id:"own",revision:7,model},{id:"other",revision:8,model:{orders:[{quantity:999999,name:"SECRET_OTHER_PROJECT"}]}}]),"prodplan.project.active.v2":"own"};
 const scope={Response,Request,Headers,AbortSignal,TextEncoder,TextDecoder,Date,URL,Map,Set,console,structuredClone,Bun:{env:{GROQ_API_KEY:"synthetic-test-key"}},PP_AUTH_GATEWAY_ORIGIN:"https://private-auth.invalid",
 ppRequireSameOrigin:()=>origin,ppVerifyLogin:async()=>login,ppSecureSessionKey:()=>"own-session",
 ppAccountModelEmpty:()=>({orders:[]}),ppAccountModelFromStorage:d=>JSON.parse(d.storage["prodplan.projects.v2"])[0].model,ppAccountPlanBelongsToModel:()=>true,
 fetch:async(url,opts)=>{calls.push({url,opts});
  if(url.endsWith("/api/db-storage"))return Response.json({storage});
  return Response.json({choices:[{message:answer?{content:answer}:{content:null,tool_calls:[{id:"test",type:"function",function:{name:"propose_project_edit",arguments:JSON.stringify(tool)}}]}}],usage:{total_tokens:100}})}
 };
 vm.createContext(scope);vm.runInContext(runtime,scope);
 const send=body=>scope.ppGroqAssistant(new Request(base+"/api/assistant",{method:"POST",headers:{"Content-Type":"application/json",Origin:base},body:JSON.stringify(body)}));
 return {scope,calls,send,storage};
}
const request=(extra={})=>({message:"добавь ещё один заказ объёмом 600",history:[],includeProject:true,viewContext:view,allowActions:true,...extra});
test("provider can propose but never write; data and account scope preserved",async()=>{
 const e=environment(),before=JSON.stringify(e.storage);
 const r=await e.send(request());assert.equal(r.status,200);const d=await r.json();
 assert.equal(d.mode,"edit_proposal");assert.equal(d.action.projectId,"own");assert.equal(d.action.revision,7);assert.equal(d.action.change.after,600);assert.equal(d.action.change.record,"2608");
 assert.equal(e.calls.length,2);assert.equal(e.calls[0].opts.method,undefined);assert.equal(JSON.stringify(e.storage),before);
 const body=JSON.parse(e.calls[1].opts.body);assert.equal(body.tools[0].function.name,"propose_project_edit");assert.equal(body.tool_choice,"auto");
 const prompt=JSON.stringify(body.messages);assert(prompt.includes("editingCatalog"));assert(prompt.includes("2606"));assert(!prompt.includes("PRIVATE_EMPLOYEE"));assert(!prompt.includes("SECRET_OTHER_PROJECT"));assert(!prompt.includes('"projectId"'));
});
test("old clients and read-only questions do not mutate; forged project and unauthenticated requests rejected",async()=>{
 const old=environment({answer:"OK"});assert.equal((await old.send(request({allowActions:undefined}))).status,200);assert(!JSON.parse(old.calls[1].opts.body).tools);
 const e=environment({answer:"The order total is 1700."});const r=await e.send(request({message:"How many orders?"}));assert.equal(r.status,200);assert.equal((await r.json()).action,undefined);
 for(const extra of [{viewContext:{...view,projectId:"other"}},{viewContext:{...view,revision:6}}]){
  const e=environment();assert.equal((await e.send(request(extra))).status,503);assert.equal(e.calls.length,1);
 }
 const bad=environment({tool:{kind:"add_order",quantity:-1}});const rejected=await bad.send(request());assert.equal((await rejected.json()).action,undefined);
 const unauth=environment({login:false});assert.equal((await unauth.send(request())).status,401);assert.equal(unauth.calls.length,0);
 const cross=environment({origin:false});assert.equal((await cross.send(request())).status,403);assert.equal(cross.calls.length,0);
 assert.throws(()=>patchTenant(runtime));
});
test("auth transform preserves all existing source including decimal lifecycle",()=>{
 const before='/* DECIMAL_LIFECYCLE */\nconst assistantHtml=ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded))));';
 const after=patchAuth(before);assert(after.includes("DECIMAL_LIFECYCLE"));assert(after.includes("ppGroqActionsHtml"));assert.throws(()=>patchAuth(after));
});
