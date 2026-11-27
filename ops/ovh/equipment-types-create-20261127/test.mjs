import test from "node:test";
import assert from "node:assert/strict";
import {typeName,typeNames,createType} from "./types.mjs";
import {prepareEdit} from "./patch.mjs";
const model={equipment:[{id:"A",name:"Press",kind:"pressing"}],autoclaves:[{id:"A",name:"Press",kind:"pressing"}],technical_processes:[{operations:[{resource_requirements:[{resource_type:"equipment",resource_ref:"kind:glazing"}]}]}],orders:[],equipment_types:["unused"]};
test("type registry merges model sources, supports Unicode, rejects duplicates and invalid names",()=>{
 assert.deepEqual(typeNames(model),["pressing","unused","glazing"]);assert.equal(typeName("  Резка  плитки "),"Резка плитки");
 for(const s of ["PRESSING","unused","glazing"])assert.throws(()=>createType(model,s),/duplicate_equipment_type/);
 for(const s of ["","kind:other","<script>","a\n","__proto__"])assert.throws(()=>typeName(s),/invalid_equipment_type/);
});
test("AI creates project-scoped type without changing equipment or existing production",()=>{
 const a=prepareEdit(model,{kind:"create_equipment_type",type_name:"cutting"});
 assert.deepEqual(a.model,{...model,equipment_types:["unused","cutting"]});assert.equal(a.change.record,"cutting");
 const b=prepareEdit(model,{kind:"create_equipment_type",type_name:"cutting",equipment_index:1});
 assert.equal(b.model.equipment[0].kind,"cutting");assert.equal(b.model.autoclaves[0].kind,"cutting");assert.equal(model.equipment[0].kind,"pressing");
 assert.throws(()=>prepareEdit(model,{kind:"create_equipment_type",type_name:"cutting",foo:1}),/unsupported_action/);
});
