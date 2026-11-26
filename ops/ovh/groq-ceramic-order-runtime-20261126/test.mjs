import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {ppGroqPrepareEdit} from "./prepare.mjs";
import {patchTenant,patchAuth} from "./patch.mjs";
import {patchTenant as patchContext} from "../groq-project-context-20261126/patch.mjs";
import {patchTenant as patchActions,patchAuth as patchActionsAuth} from "../groq-project-actions-20261126/patch.mjs";
const model={scheduler_mode:"resource",quantity_unit:"m2",orders:[
 {id:2611,area:900,quantity:900,unit:"m2",technical_process_id:"P",process_hours:1,parameters:{color:"A",width:600,recipe:"R1"}},
 {id:2612,area:800,quantity:800,unit:"m2",technical_process_id:"P",process_hours:1,parameters:{color:"B",width:1200,recipe:"R2"},notes:"must not copy",due:"2026-12-01"}],
 equipment:[{id:"E1",name:"Machine A",capacity:200,capacity_unit:"m2",capabilities:{allowed_parameters:{color:["A","B"]},max_parameters:{width:1300}},timing_profile:{throughput_per_hour:600}}],
 employees:[],shifts:{},materials:[],technical_processes:[{id:"P",name:"Ceramics",operations:[{id:"OP1",name:"Pressing",duration_min:60,resource_requirements:[{resource_type:"equipment",match_mode:"specific",resource_ref:"E1",quantity:1}]}]}],setup_rules:[]};
const add={kind:"add_order",quantity:600};
const broken=structuredClone(model);broken.orders.push({id:2613,area:600,quantity:600,unit:"m2",technical_process_id:"P",process_hours:1});
test("new orders carry complete reviewed production parameters, not private metadata",()=>{
 const r=ppGroqPrepareEdit(model,add),o=r.model.orders.at(-1);
 assert.equal(o.id,2613);assert.equal(o.quantity,600);assert.deepEqual(o.parameters,model.orders[1].parameters);
 assert.equal(o.notes,undefined);assert.equal(o.due,undefined);
 assert.equal(r.change.templateRecord,"2612");assert.deepEqual(r.change.parameters,o.parameters);
 assert.deepEqual(r.model.orders.slice(0,2),model.orders);
 assert.equal(ppGroqPrepareEdit(model,{...add,template_order_index:1}).change.templateRecord,"2611");
 const ordinary=structuredClone(model);ordinary.equipment[0].capabilities={};ordinary.orders.forEach(o=>delete o.parameters);
 assert.equal(ppGroqPrepareEdit(ordinary,add).model.orders.at(-1).parameters,undefined);
 const noTemplate=structuredClone(model);noTemplate.orders.forEach(o=>delete o.parameters);
 assert.throws(()=>ppGroqPrepareEdit(noTemplate,add),/missing_parameter_template/);
});
test("repair the existing order, never create a duplicate or change the reviewed quantity",()=>{
 const r=ppGroqPrepareEdit(broken,{kind:"complete_order_parameters",order_index:3});
 assert.equal(r.model.orders.length,3);assert.equal(r.model.orders[2].id,2613);assert.equal(r.model.orders[2].quantity,600);
 assert.deepEqual(r.model.orders[2].parameters,model.orders[1].parameters);assert.deepEqual(r.change.missingRequired.sort(),["color","width"]);
 const partial=structuredClone(broken);partial.orders[2].parameters={color:"A",custom:{keep:true}};
 const fixed=ppGroqPrepareEdit(partial,{kind:"complete_order_parameters",order_index:3,template_order_index:1});
 assert.equal(fixed.model.orders[2].parameters.color,"A");assert.deepEqual(fixed.model.orders[2].parameters.custom,{keep:true});
 assert.equal(fixed.model.orders[2].parameters.width,600);
 assert.throws(()=>ppGroqPrepareEdit(r.model,{kind:"complete_order_parameters",order_index:3}),/no_change/);
 assert.throws(()=>ppGroqPrepareEdit(broken,{kind:"complete_order_parameters",order_index:3,template_order_index:3}),/invalid_parameter_template/);
 assert.equal(broken.orders[2].parameters,undefined);
});
test("preserve other edits and exact installed patch",()=>{
 const r=ppGroqPrepareEdit(model,{kind:"update_order",order_index:1,quantity:1000});
 assert.deepEqual(r.model.orders[0].parameters,model.orders[0].parameters);assert.equal(r.model.orders[0].quantity,1000);
 const old=readFileSync(new URL("../groq-assistant-20261125/assistant-runtime.js",import.meta.url),"utf8");
 const ctx=readFileSync(new URL("../groq-project-context-20261126/context-runtime.js",import.meta.url),"utf8");
 const prior=patchActions(patchContext(old,old,ctx)),next=patchTenant(prior);
 new vm.Script(next);assert(next.includes("PP_GROQ_ORDER_PARAMETERS_V1"));assert.throws(()=>patchTenant(next));
 const auth='/* existing decimal lifecycle */\nconst assistantHtml=ppGroqProjectContextHtml(ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded))));';
 const priorAuth=patchActionsAuth(auth),newAuth=patchAuth(priorAuth);
 new vm.Script(newAuth);assert(newAuth.includes("existing decimal lifecycle"));assert.throws(()=>patchAuth(newAuth));
});
