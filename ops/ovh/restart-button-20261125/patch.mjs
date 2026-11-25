import fs from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

export const OLD_UPSTREAM='3f64a9f03767ffd1fa8a4f72c16ae31a6dab2824f9b2aa45f5ef8644fa82d199';
const sha=s=>createHash('sha256').update(s).digest('hex');
function once(src,old,next){assert.equal(src.split(old).length,2,'RESET_SOURCE_ANCHOR_DRIFT');return src.replace(old,next)}
export const nativePermission="  async function resetPermission(req, legacyStartedAt=null){\n    if(!enabled)return {native:false};\n    try{\n      const principal=await account(req);\n      if(resetStarting.has(principal))return {native:true,allowed:false};\n      const job=await currentJob(principal);\n      if(resetStarting.has(principal))return {native:true,allowed:false};\n      if(!job)return {native:true,allowed:true};\n      if(!['completed','cancelled','failed','timed_out','interrupted','invalid','stale'].includes(job.state))\n        return {native:true,allowed:false};\n      if(Number.isFinite(legacyStartedAt)&&Number.isFinite(job.began)&&job.began<legacyStartedAt)\n        return {native:true,allowed:false};\n      return {native:true,allowed:true};\n    }catch{return {native:true,unavailable:true}}\n  }\n";
export const oldGuard=" const run=ppActiveObjectiveRuns.get(key);\n if(run&&!run.completed&&!run.stopRequested)\n  return jsonifyBridge({ok:false,error:\"optimization_running_stop_first\"},409);";
export const newGuard=" const run=ppActiveObjectiveRuns.get(key);\n const legacyActive=!!(run&&!run.completed&&!run.stopRequested);\n const permission=typeof ppPythonGAUpstream!=='undefined'&&typeof ppPythonGAUpstream.resetPermission==='function'\n  ?await ppPythonGAUpstream.resetPermission(req,legacyActive&&Number.isFinite(run.created)?run.created:null):{native:false};\n if(permission.unavailable)return jsonifyBridge({ok:false,error:\"ga_state_unavailable\"},503);\n if(ppActiveObjectiveRuns.get(key)!==run||(permission.native?!permission.allowed:legacyActive))\n  return jsonifyBridge({ok:false,error:\"optimization_running_stop_first\"},409);";
const start="  async function run(req,opts){\n    let principal,model;\n    try{principal=await account(req);model=await readAccountModel(req)}\n    catch{return response({ok:false,error:'authentication_or_model_unavailable'},503)}";
const replacement="  const resetStarting=new Map();\n  async function run(req,opts){\n    let principal,model;\n    try{principal=await account(req)}catch{return response({ok:false,error:'authentication_or_model_unavailable'},503)}\n    resetStarting.set(principal,(resetStarting.get(principal)||0)+1);\n    try{\n      try{model=await readAccountModel(req)}catch{return response({ok:false,error:'authentication_or_model_unavailable'},503)}";
const end="\n  }\n  async function progress(req){";
const newEnd="\n    }finally{\n      const remaining=(resetStarting.get(principal)||1)-1;\n      if(remaining>0)resetStarting.set(principal,remaining);else resetStarting.delete(principal);\n    }\n  }\n  async function progress(req){";

export function patchServer(source){
 for(const required of ['async function ppResetOptimizer(req){','const key=ppSecureSessionKey(req);','ppActiveObjectiveRuns.delete(key);','ppFreshGenerationSessions.set(key,','return jsonifyBridge({ok:true,reset:true,'])assert(source.includes(required),'RESET_SERVER_REQUIRED_ANCHOR');
 assert(!source.includes('resetPermission(req'));
 const updated=once(source,oldGuard,newGuard);
 assert.equal(updated.replace(newGuard,oldGuard),source);
 new vm.Script(updated);
 return updated;
}
export function patchUpstream(source,expected=OLD_UPSTREAM){
 assert.equal(sha(source),expected,'RESET_UPSTREAM_SOURCE_DRIFT');
 let next=once(source,start,replacement);
 next=once(next,end,newEnd);
 next=once(next,'  async function fetchUpstream(req,opts){',nativePermission+'  async function fetchUpstream(req,opts){');
 next=once(next,'return {fetch:fetchUpstream,cancel,','return {fetch:fetchUpstream,cancel,resetPermission,');
 assert(next.includes("if(current&&['queued','running'].includes(current.state))"));
 return next;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const [dir]=process.argv.slice(2);
 try{
  const server=fs.readFileSync(dir+'/old/restart-optimizer-server.js','utf8');
  const upstream=fs.readFileSync(dir+'/old/python-ga-upstream.mjs','utf8');
  fs.mkdirSync(dir+'/new',{mode:0o700});
  const values=[['restart-optimizer-server.js',server,patchServer(server)],['python-ga-upstream.mjs',upstream,patchUpstream(upstream)]];
  for(const [name,old,next] of values)fs.writeFileSync(dir+'/new/'+name,next,{mode:0o600});
  fs.writeFileSync(dir+'/manifest.tsv',values.map(([name,old,next])=>name+'\t'+sha(old)+'\t'+sha(next)).join('\n')+'\n',{mode:0o600});
  console.log('RESTART_EXACT_SOURCE_STAGE_PASS '+JSON.stringify(Object.fromEntries(values.map(([name,old,next])=>[name,{old:sha(old),new:sha(next)}]))));
 }catch(e){console.log('RESTART_SOURCE_STAGE_FAILED '+(e?.code==='ERR_ASSERTION'?String(e.message).split('\n')[0].slice(0,90):e?.name||'Error'));process.exitCode=6}
}
