// Runs AFTER tenant-model-build.ts and feature-stop.ts and BEFORE final Bun build.
// Leaves the original plan(req), manual-lock protection, setup search, and
// authenticated endpoint behaviour in place; intercepts only upstream fetches.
import {readFileSync,writeFileSync} from 'node:fs';
let source=readFileSync('index.ts','utf8');
const prefix='async function stopOptimization(req) {';
const accountAnchor='async function ppTenantAuthenticated(req){';
const upstreamAnchor='fetch(upstreamUrl(req),';
if(source.split(prefix).length!==2)throw Error('python_ga_stop_anchor_missing');
if(source.split(accountAnchor).length!==2)throw Error('python_ga_account_anchor_missing');
const upstreamCount=source.split(upstreamAnchor).length-1;
if(upstreamCount<2||upstreamCount>30)throw Error('python_ga_upstream_anchor_unexpected_'+upstreamCount);
source=source.replaceAll(upstreamAnchor,'ppPythonGAUpstream.fetch(req,');
source=source.replace(prefix,prefix+`\n const workerStop=await ppPythonGAUpstream.cancel(req);
 if(workerStop?.error==='worker_cancel_failed')return jsonifyBridge({ok:false,error:'worker_cancel_failed'},503);`);
const factory=`const ppPythonGAUpstream=createPythonGAUpstream({
 enabled:typeof Bun!=='undefined'&&Bun.env.PP_PY_GA_WORKERS_ENABLED==='1',
 origin:typeof Bun==='undefined'?'':Bun.env.PP_PY_GA_WORKER_ORIGIN,
 token:typeof Bun==='undefined'?'':Bun.env.PP_PY_GA_WORKER_TOKEN,
 upstreamUrl,sessionKey:ppSecureSessionKey,verifyLogin:ppVerifyLogin,
 readAccountModel:ppReadAccountModel,hashModel:ppAccountModelHash,
 checkPlan:ppAccountPlanBelongsToModel
});
`;
source=source.replace(accountAnchor,factory+accountAnchor);
source='import {createPythonGAUpstream} from "./python-ga-upstream.mjs";\n'+source;
if(!source.includes('ppPythonGAUpstream.fetch(req,')||!source.includes('const ppPythonGAUpstream=createPythonGAUpstream'))throw Error('python_ga_build_incomplete');
writeFileSync('index.ts',source);
console.log('PP_PYTHON_GA_UPSTREAM_ROUTING_READY',JSON.stringify({upstreamFetchPoints:upstreamCount,enabledBy:'PP_PY_GA_WORKERS_ENABLED=1',legacySetupBridgePreserved:true}));