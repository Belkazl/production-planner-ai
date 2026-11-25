import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {nativePermission,patchServer} from './patch.mjs';
import {keepNativeIncumbent,patchQualityUi,patchQualityHtml} from './quality.mjs';
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

const native=(duration,model='m',pin='p',goal='duration')=>({valid:true,ok:true,partial:false,duration_minutes:duration,
 batch_count:10,operator_wait_minutes:100,machine_idle_minutes:20,operations:[{start_min:0,end_min:duration}],
 resume_state:{pin_hash:pin},_pp_native_schedule_v1:{version:'integrated-native-setup-v1-20261125',context:{model_key:model,pin_key:pin,objective:goal}}});
const accepted=native(80),worse={...native(100),optimization_run:3,total_generations:9},better=native(70);
const retain=keepNativeIncumbent(worse,accepted,'duration','m',()=>true);
assert.equal(retain.duration_minutes,80);assert.deepEqual(retain.operations,accepted.operations);
assert.equal(retain.optimization_run,3);assert.equal(retain.optimization_previous_best_preserved,true);
assert.equal(keepNativeIncumbent(better,accepted,'duration','m',()=>true),better);
assert.equal(keepNativeIncumbent(worse,native(50,'m','new-pins'),'duration','m',()=>true),worse);
assert.equal(keepNativeIncumbent(worse,native(50,'other','p'),'duration','m',()=>true),worse);
assert.equal(keepNativeIncumbent(worse,accepted,'duration','m',()=>false),worse);
assert.equal(keepNativeIncumbent(worse,{...accepted,partial:true},'duration','m',()=>true),worse);
assert.equal(patchQualityUi(fs.readFileSync(dir+'/old/restart-optimizer-ui.js','utf8')),fs.readFileSync(dir+'/new/restart-optimizer-ui.js','utf8'));
assert.equal(patchQualityHtml(fs.readFileSync(dir+'/old/restart-optimizer-html.js','utf8')),fs.readFileSync(dir+'/new/restart-optimizer-html.js','utf8'));
console.log('RESTART_AND_QUALITY_FLOOR_UNIT_PASS');
