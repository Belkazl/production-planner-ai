import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {ppNativeScheduleFingerprint, ppCanonicalNativeResult, ppNativePresentationPlan,
  ppNativePresentationSupersedes, ppInstallNativePresentation} from './canonical.mjs';

export const NATIVE_HEADER = 'x-pp-native-schedule';
export const NATIVE_HEADER_VALUE = 'canonical-v1-20261125';
// Literal public labels allow the private-source runner to return exact anchor
// counts without exposing excerpts, identifiers read from source, or messages.
export const INTEGRATED_SETUP_SOURCE_LABELS = Object.freeze([
  'upstream_helpers', 'upstream_source_header', 'upstream_canonical_plan',
  'upstream_owned_context', 'upstream_full_owned', 'upstream_authoritative_zero',
  'upstream_checkpoint_context', 'upstream_setup_ownership', 'upstream_ordinary_context',
  'upstream_public_checkpoint', 'upstream_checkpoint_calls', 'upstream_sync_candidate',
  'upstream_sync_final', 'upstream_cached_final', 'upstream_async_candidate',
  'upstream_async_final', 'upstream_stop_public_signature',
  'upstream_installed_helpers', 'upstream_installed_source_header', 'upstream_installed_canonical_plan',
  'upstream_installed_owned_context', 'upstream_installed_full_owned', 'upstream_installed_authoritative_zero',
  'upstream_installed_checkpoint_context', 'upstream_installed_setup_ownership', 'upstream_installed_ordinary_context',
  'upstream_installed_public_checkpoint', 'upstream_installed_checkpoint_calls', 'upstream_installed_sync_candidate',
  'upstream_installed_sync_final', 'upstream_installed_cached_final', 'upstream_installed_async_candidate',
  'upstream_installed_async_final', 'upstream_installed_stop_public_signature',
  'upstream_reverse_helpers', 'upstream_reverse_source_header', 'upstream_reverse_canonical_plan',
  'upstream_reverse_owned_context', 'upstream_reverse_full_owned', 'upstream_reverse_authoritative_zero',
  'upstream_reverse_checkpoint_context', 'upstream_reverse_setup_ownership', 'upstream_reverse_ordinary_context',
  'upstream_reverse_public_checkpoint', 'upstream_reverse_checkpoint_calls', 'upstream_reverse_sync_candidate',
  'upstream_reverse_sync_final', 'upstream_reverse_cached_final', 'upstream_reverse_async_candidate',
  'upstream_reverse_async_final', 'upstream_reverse_stop_public_signature',
  'aps_native_progress', 'aps_native_post', 'aps_client_incumbent', 'aps_client_persistence',
  'aps_installed_native_progress', 'aps_installed_native_post', 'aps_installed_client_incumbent', 'aps_installed_client_persistence',
  'aps_reverse_native_progress', 'aps_reverse_native_post', 'aps_reverse_client_incumbent', 'aps_reverse_client_persistence',
  'ui_presentation', 'ui_legacy_floor', 'ui_installed_presentation', 'ui_installed_legacy_floor',
  'ui_reverse_presentation', 'ui_reverse_legacy_floor',
  'ui_preview_migration', 'ui_installed_preview_migration', 'ui_reverse_preview_migration',
  'upstream_required_guard', 'aps_required_guard', 'ui_required_guard'
]);
const sourceLabels = new Set(INTEGRATED_SETUP_SOURCE_LABELS);
const marker = 'pp_integrated_native_setup_20261125';
const serverHelpers = '// ' + marker + '\n' + ppNativeScheduleFingerprint.toString() + '\n' + ppCanonicalNativeResult.toString() + '\n';
const uiHelpers = '// ' + marker + '\n' + [ppNativeScheduleFingerprint, ppNativePresentationPlan,
  ppNativePresentationSupersedes, ppInstallNativePresentation].map(fn => fn.toString()).join('\n') + '\nppInstallNativePresentation();\n';

function responseFactoryEdit(source) {
  const installedMarker = '  // pp_integrated_native_response_factory_20261125:';
  const wrapper = '\n  const response = (...args) => {\n' +
    '    const native=ppNativeBaseResponse(...args);\n' +
    "    if(!(native instanceof Response))throw Error('native_response_contract_invalid');\n" +
    '    native.headers.set("' + NATIVE_HEADER + '","' + NATIVE_HEADER_VALUE + '");\n' +
    '    return native;\n  };';
  const fail = () => { throw Error('INTEGRATED_SETUP_RESPONSE_FACTORY_GUARD'); };
  const fallback = [...source.matchAll(/\n  const fallback[ \t]*=/g)];
  if (fallback.length !== 1) fail();
  let original, storedHash;
  if (source.includes(installedMarker)) {
    if (source.split(installedMarker).length !== 2) fail();
    const block = source.slice(source.indexOf(installedMarker), fallback[0].index);
    const header = block.match(/^  \/\/ pp_integrated_native_response_factory_20261125:([0-9a-f]{64})\n/);
    if (!header || !block.endsWith(wrapper)) fail();
    original = block.slice(header[0].length, -wrapper.length);
    if (!original.startsWith('  const ppNativeBaseResponse')) fail();
    original = original.replace('  const ppNativeBaseResponse', '  const response');
    storedHash = header[1];
  } else {
    const declarations = [...source.matchAll(/\n  const response[ \t]*=/g)];
    if (declarations.length !== 1 || declarations[0].index >= fallback[0].index) fail();
    original = source.slice(declarations[0].index + 1, fallback[0].index);
  }
  if (original.length > 8192 || !/^  const response[ \t]*=/.test(original)) fail();
  const expression = original.replace(/^  const response[ \t]*=[ \t]*/, '').trim();
  if (!/^\(\s*body\s*,\s*status\s*=\s*200\s*\)\s*=>/.test(expression) ||
      !/\b(?:Response\s*\.\s*json\s*\(|new\s+Response\s*\()/.test(expression) || !expression.endsWith(';')) fail();
  // One bounded declaration only. Quotes/comments do not change delimiter
  // depth; a second top-level statement before fallback is never accepted.
  const stack = [];
  let quote = null, escaped = false, lineComment = false, blockComment = false;
  for (let i = 0; i < expression.length; i++) {
    const char = expression[i], next = expression[i + 1];
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockComment) { if (char === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '/' && next === '/') { lineComment = true; i++; continue; }
    if (char === '/' && next === '*') { blockComment = true; i++; continue; }
    if (char === '/') fail();
    if ('([{'.includes(char)) stack.push(char);
    else if (')]}'.includes(char) && stack.pop() !== ({')': '(', ']': '[', '}': '{'})[char]) fail();
    else if (char === ';' && !stack.length && i !== expression.length - 1) fail();
  }
  if (quote || escaped || blockComment || stack.length) fail();
  try { new Function('return (' + expression.slice(0, -1) + ');'); } catch { fail(); }
  const sha = createHash('sha256').update(original).digest('hex');
  if (storedHash && storedHash !== sha) fail();
  const updated = installedMarker + sha + '\n' +
    original.replace('  const response', '  const ppNativeBaseResponse') + wrapper;
  return [original, updated, 'source_header'];
}

function exact(source, before, after, name, count = 1) {
  if (source.split(before).length !== count + 1) throw Error('INTEGRATED_SETUP_SOURCE_DRIFT_' + name);
  return source.split(before).join(after);
}
function change(source, edits, identity, inspect = false) {
  if (inspect) {
    const installed = source.includes(marker);
    return edits.map(([before, after, name, expected = 1]) => {
      const label = identity + (installed ? '_installed_' : '_') + name;
      if (!sourceLabels.has(label)) throw Error('INTEGRATED_SETUP_UNKNOWN_SOURCE_LABEL');
      return {label, expected, count: Math.min(100000, source.split(installed ? after : before).length - 1)};
    });
  }
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

export function patchUpstream(source, inspect = false) {
  for (const guard of ['principal=await account(req);model=await readAccountModel(req)',
    'currentJob(principal)', 'state.modelKey!==hashModel(model)', "'x-authenticated-account':principal",
    'const verifiedWorkerCheckpoint = (raw,model) =>', 'pp_scoped_stop_verified_choices_v2'])
    if (!source.includes(guard)) throw Error('INTEGRATED_SETUP_REQUIRED_UPSTREAM_GUARD');
  const response = responseFactoryEdit(source);
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
    response,
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
  const updated = change(source, edits, 'upstream', inspect);
  if (inspect) return updated;
  new Function(updated.replace('export function createPythonGAUpstream', 'function createPythonGAUpstream'));
  return updated;
}

export function patchAps(source, inspect = false) {
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
  ], 'aps', inspect);
}

export function patchUi(source, inspect = false) {
  for (const guard of ['function ppGaQualityFloorV1(){', '__PP_GA_OBJECTIVE_FLOOR_V1__',
    'function ppFixedFirstBestKpiDelta(){', 'function ppSelectedPlanKpiReferenceV2(){',
    'function updatePreviewKpis(preview){'])
    if (!source.includes(guard)) throw Error('INTEGRATED_SETUP_REQUIRED_UI_GUARD');
  const before = '  const incumbent=floor();\n  if(!incumbent)return response;\n  const selectedKey=keyFor(goal());';
  const after = '  const nativePresentation=window.__PP_INTEGRATED_NATIVE_RESULT_V1__;\n' +
    '  if(nativePresentation?.acceptResponse?.(candidate))return response;\n' +
    '  const selectedKey=keyFor(goal());\n' +
    '  const incumbent=nativePresentation?.matchingFloor?.(candidate,selectedKey,prefersNew)||floor();\n' +
    '  if(!incumbent)return response;';
  return change(source, [
    [';(function ppGaQualityFloorV1(){', uiHelpers + ';(function ppGaQualityFloorV1(){', 'presentation'],
    [before, after, 'legacy_floor'],
    [' const render=window.renderKpisWithDelta;\n if(typeof render!=="function")return;',
      ' window.__PP_INTEGRATED_NATIVE_RESULT_V1__?.acceptPreview?.(preview);\n' +
      ' const render=window.renderKpisWithDelta;\n if(typeof render!=="function")return;', 'preview_migration']
  ], 'ui', inspect);
}

export function classifyAppAnchors(files) {
  const results = [];
  for (const [path, identity, patch] of [
    ['python-ga-upstream.mjs', 'upstream', patchUpstream],
    ['baselines/2026-10-10/aps-setup-bridge/index.ts', 'aps', patchAps],
    ['restart-optimizer-ui.js', 'ui', patchUi]
  ]) {
    try { results.push(...patch(files[path], true)); }
    catch (error) {
      if (error.message !== 'INTEGRATED_SETUP_REQUIRED_' + identity.toUpperCase() + '_GUARD') throw error;
      results.push({label: identity + '_required_guard', expected: 1, count: 0});
    }
  }
  return results;
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
  const mismatches = classifyAppAnchors(before).filter(row => row.count !== row.expected);
  if (mismatches.length) console.error('INTEGRATED_SETUP_SOURCE_ANCHORS ' + JSON.stringify(mismatches));
  // All source contracts validate before writing any staged file.
  const after = patchAppSources(before);
  for (const name of names) {
    if (after[name] !== before[name]) writeFileSync(resolve(root, name), after[name]);
    console.log('INTEGRATED_SETUP_APP_PATCH', name, createHash('sha256').update(after[name]).digest('hex'));
  }
}
