import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {ppNativeScheduleFingerprint, ppCanonicalNativeResult, ppNativePresentationPlan,
  ppNativePresentationSupersedes, ppInstallNativePresentation} from './canonical.mjs';

export const NATIVE_HEADER = 'x-pp-native-schedule';
export const NATIVE_HEADER_VALUE = 'canonical-v1-20261125';
const marker = 'pp_integrated_native_setup_20261125';
const serverHelpers = '// ' + marker + '\n' + ppNativeScheduleFingerprint.toString() + '\n' + ppCanonicalNativeResult.toString() + '\n';
const uiHelpers = '// ' + marker + '\n' + [ppNativeScheduleFingerprint, ppNativePresentationPlan,
  ppNativePresentationSupersedes, ppInstallNativePresentation].map(fn => fn.toString()).join('\n') + '\nppInstallNativePresentation();\n';

function exact(source, before, after, name, count = 1) {
  if (source.split(before).length !== count + 1) throw Error('INTEGRATED_SETUP_SOURCE_DRIFT_' + name);
  return source.split(before).join(after);
}
function change(source, edits, identity) {
  if (source.includes(marker)) {
    let original = source;
    for (const [before, after, label, count = 1] of [...edits].reverse())
      original = exact(original, after, before, identity + '_installed_' + label, count);
    if (original.includes(marker)) throw Error('INTEGRATED_SETUP_PARTIAL_INSTALL_' + identity);
    let verified = original;
    for (const [before, after, label, count = 1] of edits)
      verified = exact(verified, before, after, identity + '_' + label, count);
    if (verified !== source) throw Error('INTEGRATED_SETUP_REVERSE_MISMATCH_' + identity);
    return source;
  }
  let updated = source;
  for (const [before, after, label, count = 1] of edits)
    updated = exact(updated, before, after, identity + '_' + label, count);
  let reversed = updated;
  for (const [before, after, label, count = 1] of [...edits].reverse())
    reversed = exact(reversed, after, before, identity + '_reverse_' + label, count);
  if (reversed !== source) throw Error('INTEGRATED_SETUP_UNRELATED_CHANGE_' + identity);
  return updated;
}

export function patchUpstream(source) {
  for (const guard of ['principal=await account(req);model=await readAccountModel(req)',
    'currentJob(principal)', 'state.modelKey!==hashModel(model)', "'x-authenticated-account':principal",
    'const verifiedWorkerCheckpoint = (raw,model) =>', 'pp_scoped_stop_verified_choices_v2'])
    if (!source.includes(guard)) throw Error('INTEGRATED_SETUP_REQUIRED_UPSTREAM_GUARD');
  const response = "  const response = (body, status=200) => Response.json(body,{status,headers:{'cache-control':'no-store'}});";
  const declaration = '  const publicPlan = plan => {\n    if(!plan||typeof plan!==\'object\')return plan;';
  const canonical = '  const publicPlan = (plan,model) => {\n    if(!plan||typeof plan!==\'object\')return plan;\n' +
    '    if(plan.partial!==true){\n' +
    '      const canonical=ppCanonicalNativeResult(plan,model,model?String(hashModel(model)):null);\n' +
    "      if(!canonical)return {ok:false,valid:false,error:'native_schedule_contract_invalid',operations:[],generic_operations:[]};\n" +
    '      plan=canonical;\n    }';
  const checkpointOrder = '      if(!row||row.order==null||!ownOrders.has(String(row.order)))return null;';
  const setupOwned = '      if(!row)return null;\n' +
    "      const nativeSetup=!!plan._pp_native_schedule_v1&&(row.is_setup===true||String(row.phase||row.type||'').toLowerCase()==='setup');\n" +
    '      if(row.order==null){if(!nativeSetup||!(row.equipment_ids||[]).length)return null;}\n' +
    '      else if(!ownOrders.has(String(row.order)))return null;';
  const edits = [
    ['export function createPythonGAUpstream({', serverHelpers + 'export function createPythonGAUpstream({', 'helpers'],
    [response, "  const response = (body, status=200) => Response.json(body,{status,headers:{'cache-control':'no-store','" + NATIVE_HEADER + "':'" + NATIVE_HEADER_VALUE + "'}});", 'source_header'],
    [declaration, canonical, 'canonical_plan'],
    ['    plan=publicPlan(plan);', '    plan=publicPlan(plan,model);', 'owned_context'],
    ['return !!plan&&Array.isArray(plan.operations)&&plan.operations.length>0&&checkPlan(plan,model);',
      'return !!plan&&plan.valid===true&&plan.partial!==true&&Array.isArray(plan.operations)&&plan.operations.length>0&&checkPlan(plan,model);', 'full_owned'],
    ['  const setupOperationsDropped = (final,best,model) => {',
      '  const setupOperationsDropped = (final,best,model) => {\n    if(publicPlan(final,model)?._pp_native_schedule_v1)return false;', 'authoritative_zero'],
    ['    const plan=publicPlan(raw);', '    const plan=publicPlan(raw,model);', 'checkpoint_context'],
    [checkpointOrder, setupOwned, 'setup_ownership'],
    ['    const ordinary=publicPlan(raw);', '    const ordinary=publicPlan(raw,model);', 'ordinary_context'],
    ['  const publicCheckpoint = plan => {\n    if(!plan)return null;\n    const copy={...plan};',
      '  const publicCheckpoint = (plan,model) => {\n    if(!plan)return null;\n    const checked=publicPlan(plan,model);\n    if(!checked||checked.valid!==true||checked.partial===true)return null;\n    const copy={...checked};', 'public_checkpoint'],
    ['publicCheckpoint(state.best)', 'publicCheckpoint(state.best,model)', 'checkpoint_calls', 2],
    ['publicPlan(data.candidate_preview)', 'publicPlan(data.candidate_preview,model)', 'sync_candidate'],
    ['state.result=publicPlan(selected);', 'state.result=publicPlan(selected,fresh);', 'sync_final'],
    ["    if(state.state==='completed'&&state.result){", "    if(state.state==='completed'&&state.result){\n      state.result=publicPlan(state.result,model);state.best=state.result;", 'cached_final'],
    ['publicPlan(status.candidate_preview)', 'publicPlan(status.candidate_preview,model)', 'async_candidate'],
    ['const finalPlan=publicPlan(selected);', 'const finalPlan=publicPlan(selected,model);', 'async_final'],
    ["'validation_errors','errors','warnings','messages','violations','conflicts'];",
      "'validation_errors','errors','warnings','messages','violations','conflicts',\n          'setup_duration_total_minutes','_pp_native_schedule_v1'];", 'stop_public_signature']
  ];
  const updated = change(source, edits, 'upstream');
  new Function(updated.replace('export function createPythonGAUpstream', 'function createPythonGAUpstream'));
  return updated;
}

export function patchAps(source) {
  for (const guard of ['export function scheduleWithSetup(base,model,options={}) {',
    'function ppReconcileSetupAwareTerminal(data,model){', 'function ppOptimizerNoRegressionHtml(input){',
    'function ppStrictOptimizerHtml(h){'])
    if (!source.includes(guard)) throw Error('INTEGRATED_SETUP_REQUIRED_APS_GUARD');
  const progressStart = 'async function progress(req){\n const r=await fetch(upstreamUrl(req),{headers:relayHeaders(req),signal:AbortSignal.timeout(30000)});\n if(!r.ok)return rawResponse(r);';
  const progressAfter = 'async function progress(req){\n const r=await fetch(upstreamUrl(req),{headers:relayHeaders(req),signal:AbortSignal.timeout(30000)});\n' +
    ' // ' + marker + ': only the adapter response declares its native origin.\n' +
    ' if(r.headers.get("' + NATIVE_HEADER + '")==="' + NATIVE_HEADER_VALUE + '")return rawResponse(r);\n if(!r.ok)return rawResponse(r);';
  const planStart = 'const r=await fetch(upstreamUrl(req),{method:"POST",headers:relayHeaders(req),body:requestBody,signal:AbortSignal.timeout(350000)});if(!r.ok){state.completed=true;return rawResponse(r)}';
  const planAfter = 'const r=await fetch(upstreamUrl(req),{method:"POST",headers:relayHeaders(req),body:requestBody,signal:AbortSignal.timeout(350000)});\n' +
    'if(r.headers.get("' + NATIVE_HEADER + '")==="' + NATIVE_HEADER_VALUE + '"){state.completed=r.status!==202;return rawResponse(r)}\n' +
    'if(!r.ok){state.completed=true;return rawResponse(r)}';
  const decisionBefore = " if(a.partial&&!b.partial)return{accept:false,reason:'partial'};\\n const n=x=>Number(x),epsilon=0.01;";
  const decisionAfter = " if(a.partial&&!b.partial)return{accept:false,reason:'partial'};\\n if(window.__PP_INTEGRATED_NATIVE_RESULT_V1__?.supersedes?.(a,b))return{accept:true};\\n const n=x=>Number(x),epsilon=0.01;";
  const saveBefore = " if(prev&&prev.valid!==false&&Number(prev._revision??entry.revision)===Number(entry.revision)&&d&&(!d.ok";
  const saveAfter = " if(prev&&!window.__PP_INTEGRATED_NATIVE_RESULT_V1__?.supersedes?.(d,prev)&&prev.valid!==false&&Number(prev._revision??entry.revision)===Number(entry.revision)&&d&&(!d.ok";
  return change(source, [
    [progressStart, progressAfter, 'native_progress'], [planStart, planAfter, 'native_post'],
    [decisionBefore, decisionAfter, 'client_incumbent'], [saveBefore, saveAfter, 'client_persistence']
  ], 'aps');
}

export function patchUi(source) {
  for (const guard of ['function ppGaQualityFloorV1(){', '__PP_GA_OBJECTIVE_FLOOR_V1__',
    'function ppFixedFirstBestKpiDelta(){', 'function ppSelectedPlanKpiReferenceV2(){'])
    if (!source.includes(guard)) throw Error('INTEGRATED_SETUP_REQUIRED_UI_GUARD');
  const before = '  const incumbent=floor();\n  if(!incumbent)return response;\n  const selectedKey=keyFor(goal());';
  const after = '  const nativePresentation=window.__PP_INTEGRATED_NATIVE_RESULT_V1__;\n' +
    '  if(nativePresentation?.acceptResponse?.(candidate))return response;\n' +
    '  const selectedKey=keyFor(goal());\n' +
    '  const incumbent=nativePresentation?.matchingFloor?.(candidate,selectedKey,prefersNew)||floor();\n' +
    '  if(!incumbent)return response;';
  return change(source, [
    [';(function ppGaQualityFloorV1(){', uiHelpers + ';(function ppGaQualityFloorV1(){', 'presentation'],
    [before, after, 'legacy_floor']
  ], 'ui');
}

export function patchAppSources(files) {
  return {
    'python-ga-upstream.mjs': patchUpstream(files['python-ga-upstream.mjs']),
    'baselines/2026-10-10/aps-setup-bridge/index.ts': patchAps(files['baselines/2026-10-10/aps-setup-bridge/index.ts']),
    'restart-optimizer-ui.js': patchUi(files['restart-optimizer-ui.js'])
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw Error('usage: patch.mjs APP_ROOT');
  const root = resolve(process.argv[2]);
  const names = ['python-ga-upstream.mjs', 'baselines/2026-10-10/aps-setup-bridge/index.ts', 'restart-optimizer-ui.js'];
  const before = Object.fromEntries(names.map(name => [name, readFileSync(resolve(root, name), 'utf8')]));
  // All source contracts validate before writing any staged file.
  const after = patchAppSources(before);
  for (const name of names) {
    if (after[name] !== before[name]) writeFileSync(resolve(root, name), after[name]);
    console.log('INTEGRATED_SETUP_APP_PATCH', name, createHash('sha256').update(after[name]).digest('hex'));
  }
}
