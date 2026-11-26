import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {webcrypto} from "node:crypto";
import vm from "node:vm";
import {ppGroqPrepareEdit} from "./prepare.mjs";
import {source} from "./actions-ui.mjs";
import {patchTenant,patchAuth,patchNative} from "./patch.mjs";
import {patchTenant as contextPatch} from "../groq-project-context-20261126/patch.mjs";
import {patchTenant as actionsPatch,patchAuth as actionsAuth} from "../groq-project-actions-20261126/patch.mjs";
import {patchTenant as repairPatch,patchAuth as repairAuth} from "../groq-ceramic-order-runtime-20261126/patch.mjs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const model={quantity_unit:"m2",orders:[{id:1,area:600,quantity:600,unit:"m2",technical_process_id:"P",parameters:{color:"A",size:600}},{id:2,area:600,quantity:600,unit:"m2",technical_process_id:"P",parameters:{color:"B",size:600}}],equipment:[{id:"E",name:"Machine",kind:"workstation",capacity:200,capacity_unit:"m2",capabilities:{allowed_parameters:{color:["A","B"]}}}],technical_processes:[{id:"P",name:"Process",operations:[{id:"O",name:"Operation",duration_min:10,setup_parameter:"color",resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"E",quantity:1}]}]}],setup_rules:[],employees:[],materials:[],shifts:{}};
const set=(name,type,value)=>({name,type,value});
const original=structuredClone(model);
test("explicit typed values, new parameters, all orders and complete new orders",()=>{
 const one=ppGroqPrepareEdit(model,{kind:"set_order_parameters",order_index:1,parameters:[set("width_mm","number","1200"),set("coated","boolean","true")]});
 assert.deepEqual(one.model.orders[0].parameters,{color:"A",size:600,width_mm:1200,coated:true});
 assert.deepEqual(one.model.orders[1],model.orders[1]);
 const all=ppGroqPrepareEdit(one.model,{kind:"set_process_parameters",parameters:[set("width_mm","number","900")],only_missing:true});
 assert.equal(all.change.affectedOrders,1);assert.equal(all.model.orders[0].parameters.width_mm,1200);assert.equal(all.model.orders[1].parameters.width_mm,900);
 const added=ppGroqPrepareEdit(model,{kind:"add_order",quantity:600,parameters:[set("color","text","A"),set("size","number","300")]});
 assert.equal(added.model.orders[2].id,3);assert.deepEqual(added.model.orders[2].parameters,{color:"A",size:300});
 assert.deepEqual(model,original);
});
test("native equipment and operation rules preserve unrelated values",()=>{
 const a=ppGroqPrepareEdit(model,{kind:"set_equipment_parameter_rule",equipment_index:1,parameter_name:"size",rule_type:"max",value:800});
 assert.equal(a.model.equipment[0].capabilities.max_parameters.size,800);
 assert.deepEqual(a.model.equipment[0].capabilities.allowed_parameters,{color:["A","B"]});
 const b=ppGroqPrepareEdit(a.model,{kind:"set_equipment_parameter_rule",equipment_index:1,parameter_name:"color",rule_type:"allowed",values:[{type:"text",value:"A"},{type:"text",value:"C"}]});
 assert.deepEqual(b.model.equipment[0].capabilities.allowed_parameters.color,["A","C"]);
 const c=ppGroqPrepareEdit(model,{kind:"set_operation_setup_parameter",operation_index:1,parameter_name:"size"});
 assert.equal(c.model.technical_processes[0].operations[0].setup_parameter,"size");
 const d=ppGroqPrepareEdit(model,{kind:"upsert_setup_rule",equipment_index:1,parameter_name:"color",from_state:"A",to_state:"B",value:12});
 assert.equal(d.model.setup_rules[0].duration_min,12);
 const e=ppGroqPrepareEdit(d.model,{kind:"upsert_setup_rule",equipment_index:1,parameter_name:"color",from_state:"A",to_state:"B",value:15});
 assert.equal(e.model.setup_rules.length,1);assert.equal(e.model.setup_rules[0].duration_min,15);
 for(const args of [
 {kind:"set_order_parameters",order_index:1,parameters:[set("__proto__","text","x")]},
 {kind:"set_order_parameters",order_index:1,parameters:[set("x","number","not a number")]},
 {kind:"set_operation_setup_parameter",operation_index:1,parameter_name:"unknown"},
 {kind:"set_equipment_parameter_rule",equipment_index:1,parameter_name:"size",rule_type:"min",value:900},
 ])assert.throws(()=>ppGroqPrepareEdit(a.model,args));
 assert.deepEqual(model,original);
});
const installed=repairPatch(actionsPatch(contextPatch(read("../groq-assistant-20261125/assistant-runtime.js"),read("../groq-assistant-20261125/assistant-runtime.js"),read("../groq-project-context-20261126/context-runtime.js"))));
const tenant=patchTenant('async function ppTenantAuthenticated(req){const path=new URL(req.url).pathname;\n if(path==="/api/assistant")return ppGroqAssistant(req);\n}\n'+installed);
test("exact installed runtime and browser transformations compile",()=>{
 new vm.Script(tenant);new vm.Script(source);
 const auth='/* existing lifecycle */\nconst assistantHtml=ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded))));';
 new vm.Script(patchAuth(repairAuth(actionsAuth(auth))));
 const fixture="export function createPythonGAUpstream(){async function call(principal,path,method='GET',body){};const account = async req => '';async function currentJob(principal){};const checkPlan=()=>true;\n  async function fetchUpstream(req,opts){}\n  return {fetch:fetchUpstream,cancel,resetPermission};}";
 assert(patchNative(fixture).includes("edit-validation:"));
});
test("native check uses separate identity, validates every order and never writes application state",async()=>{
 const calls=[],scope={crypto:webcrypto,TextEncoder,Uint8Array,Date,globalThis:null,enabled:true,account:async()=>"real-account",currentJob:async()=>null,checkPlan:()=>true,sleep:async()=>{},call:async(principal,path,method="GET",body)=>{
  calls.push({principal,path,method,body});
  if(path==="/internal/jobs")return {status:202,body:{job_id:"a".repeat(32)}};
  return {status:200,body:{status:"completed",result:{valid:true,operations:model.orders.map(o=>({order:o.id}))}}};
 }};
 scope.globalThis=scope;vm.createContext(scope);vm.runInContext(read("./native-preflight.js"),scope);
 const r=await scope.__ppGroqNativeValidate({},model);assert.equal(r.ok,true);assert.equal(r.checkedOrders,2);
 assert(calls.every(x=>x.principal.startsWith("edit-validation:")&&x.principal!=="real-account"));
 assert.equal(calls.length,2);assert.deepEqual(model,original);
 scope.call=async(principal,path)=>path==="/internal/jobs"?{status:202,body:{job_id:"a".repeat(32)}}:{status:200,body:{status:"completed",result:{valid:true,operations:[{order:1}]}}};
 assert.equal((await scope.__ppGroqNativeValidate({},model)).error,"validation_no_feasible_plan");
 scope.currentJob=async()=>({state:"running"});assert.equal((await scope.__ppGroqNativeValidate({},model)).error,"validation_busy");
});
test("authenticated preflight reconstructs exact action, rejects stale and reports conflicts",async()=>{
 const m=structuredClone(model),store={"prodplan.projects.v2":JSON.stringify([{id:"P1",revision:7,model:m},{id:"P2",revision:1,model:{orders:[]}}]),"prodplan.project.active.v2":"P1"};
 const args={kind:"set_order_parameters",order_index:1,parameters:[set("color","text","X")]},prepared=ppGroqPrepareEdit(m,args);
 let reads=0,validations=0;
 const scope={Response,Request,Headers,AbortSignal,structuredClone,console,PP_AUTH_GATEWAY_ORIGIN:"https://auth.invalid",ppRequireSameOrigin:()=>true,ppVerifyLogin:async()=>true,ppReadAccountModel:async()=>structuredClone(m),fetch:async()=>{reads++;return Response.json({storage:store})},__ppGroqNativeValidate:async(req,candidate)=>{validations++;assert.equal(candidate.orders[0].parameters.color,"X");return {ok:false,error:"validation_no_feasible_plan"}}};
 vm.createContext(scope);vm.runInContext(tenant,scope);
 const send=extra=>scope.ppGroqValidateEdit(new Request("https://app.liftorbit.app/api/assistant/validate-edit",{method:"POST",body:JSON.stringify({projectId:"P1",revision:7,args,change:prepared.change,...extra})}));
 const d=await send({});assert.equal(d.status,422);const body=await d.json();assert.equal(body.issues[0].order,"1");assert.equal(body.issues[0].parameters[0].name,"color");
 assert.equal((await send({revision:8})).status,409);assert.equal((await send({projectId:"P2"})).status,409);
 assert.equal(validations,1);assert.deepEqual(m,model);
 scope.__ppGroqNativeValidate=async()=>({ok:true,valid:true,checkedOrders:2,operations:6});
 assert.equal((await send({})).status,200);
 scope.ppVerifyLogin=async()=>false;assert.equal((await send({})).status,401);
});
