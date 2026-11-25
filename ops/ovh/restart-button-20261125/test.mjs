import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {nativePermission,patchServer} from './patch.mjs';
const dir=process.argv[2];
const real=fs.readFileSync(dir+'/new/restart-optimizer-server.js','utf8');
const old=fs.readFileSync(dir+'/old/restart-optimizer-server.js','utf8');
assert.equal(real,patchServer(old));
const jobs=new Map(),starting=new Map();
let enabled=true,fail=false;
const context=vm.createContext({jobs,resetStarting:starting,account:async req=>req.principal,currentJob:async principal=>{if(fail)throw Error();return jobs.get(principal)}});
const make=vm.runInContext('(function(enabled){'+nativePermission+';return resetPermission})',context);
const permission=make(true);
const status=async (principal,start=null)=>JSON.parse(JSON.stringify(await permission({principal},start)));
assert.deepEqual(await status('a'),{native:true,allowed:true});
jobs.set('a',{state:'completed',began:100});assert.deepEqual(await status('a',90),{native:true,allowed:true});
assert.deepEqual(await status('a',110),{native:true,allowed:false});
jobs.set('b',{state:'running',began:100});assert.deepEqual(await status('b'),{native:true,allowed:false});
starting.set('a',1);assert.deepEqual(await status('a'),{native:true,allowed:false});starting.clear();
jobs.set('a',{state:'cancelled',began:100});assert.deepEqual(await status('a',100),{native:true,allowed:true});
jobs.set('a',{state:'invalid',began:100});assert.deepEqual(await status('a'),{native:true,allowed:true});
fail=true;assert.deepEqual(await status('a'),{native:true,unavailable:true});fail=false;
assert.deepEqual(JSON.parse(JSON.stringify(await make(false)({principal:'a'}))),{native:false});
const active=new Map(),sessions=new Map();let response={native:true,allowed:true},race=false,modelReady=true;
const env=vm.createContext({
 ppActiveObjectiveRuns:active,ppFreshGenerationSessions:sessions,ppSecureSessionKey:r=>r.principal,
 ppPythonGAUpstream:{resetPermission:async (req,created)=>{if(race)active.set(req.principal,{created:200});return response}},
 loadModel:async()=>modelReady?{orders:[{id:'O'}]}:{orders:[]},
 modelSignature:()=>'test-model',jsonifyBridge:(body,status=200)=>({body,status}),console:{log(){}}
});
vm.runInContext(real+';\nthis.reset=ppResetOptimizer;',env);
const oldrun={created:100,completed:false,stopRequested:false};
active.set('a',oldrun);active.set('b',oldrun);
let r=await env.reset({principal:'a'});assert.equal(r.status,200);assert.equal(active.has('a'),false);assert.equal(active.has('b'),true);
active.set('a',oldrun);response={native:true,allowed:false};r=await env.reset({principal:'a'});assert.equal(r.status,409);assert.equal(active.get('a'),oldrun);
response={native:true,unavailable:true};r=await env.reset({principal:'a'});assert.equal(r.status,503);assert.equal(active.get('a'),oldrun);
response={native:false};r=await env.reset({principal:'a'});assert.equal(r.status,409);
active.set('a',{...oldrun,completed:true});r=await env.reset({principal:'a'});assert.equal(r.status,200);
active.set('a',oldrun);response={native:true,allowed:true};race=true;r=await env.reset({principal:'a'});assert.equal(r.status,409);assert.equal(active.get('a').created,200);
race=false;active.delete('a');modelReady=false;r=await env.reset({principal:'a'});assert.equal(r.status,409);
console.log('RESTART_TERMINAL_ACTIVE_RACE_ACCOUNT_ISOLATION_TEST_PASS');
