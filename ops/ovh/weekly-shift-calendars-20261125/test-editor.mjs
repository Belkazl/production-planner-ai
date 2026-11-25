import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {transformEditor,transformHost} from './patch-ui.mjs';
const source=fs.readFileSync(new URL('./calendar-editor.js',import.meta.url),'utf8');
const ctx=vm.createContext({});
vm.runInContext(source,ctx);
const plain=x=>JSON.parse(JSON.stringify(x));
const day={name:'Day',days:[1,2,3,4,5],start:'08:00',end:'17:00',breaks:[['12:00','13:00']]};
test('lunch and multiple breaks',()=>{
 assert.deepEqual(plain(ctx.ppWCBlocks(day)),[['08:00','12:00'],['13:00','17:00']]);
 assert.deepEqual(plain(ctx.ppWCBlocks({...day,breaks:[...day.breaks,['15:00','15:15']]})),[['08:00','12:00'],['13:00','15:00'],['15:15','17:00']]);
});
test('overnight and invalid data',()=>{
 assert.deepEqual(plain(ctx.ppWCBlocks({...day,start:'22:00',end:'06:00',breaks:[['01:00','01:30']]})),[['22:00','01:00'],['01:30','06:00']]);
 assert.throws(()=>ctx.ppWCBlocks({...day,days:[]}));
 assert.throws(()=>ctx.ppWCBlocks({...day,breaks:[['12:00','14:00'],['13:00','15:00']]}));
});
test('legacy remains seven days and lunch preserved',()=>{
 const legacy=plain(ctx.ppWCLegacy('day',[['08:00','12:00'],['13:00','17:00']]));
 assert.deepEqual(legacy.days,[1,2,3,4,5,6,7]);
 assert.deepEqual(legacy.breaks,[['12:00','13:00']]);
 assert.deepEqual(plain(ctx.ppWCBlocks(legacy)),[['08:00','12:00'],['13:00','17:00']]);
});
test('guarded host and native editor injection',()=>{
 const html='async function save(next,section){} function renderEmployees(){}';
 const host='function ppResourceUnitsHtml(input){\n let html=input;\n return html;\n}';
 const staged=transformHost(host);
 const c=vm.createContext({});
 vm.runInContext(staged,c);
 assert.equal(c.ppResourceUnitsHtml('guest'),'guest');
 assert.match(c.ppResourceUnitsHtml(html),/function ppWCMount/);
 assert.doesNotThrow(()=>new vm.Script(transformEditor(html)));
 assert.equal(transformEditor('function renderEmployees(){}'),'function renderEmployees(){}');
 assert.throws(()=>transformEditor(html+html));
});
