import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {execFileSync} from 'node:child_process';
import {ppCanonicalNativeResult, ppNativeScheduleFingerprint, ppNativePresentationPlan,
  ppNativePresentationSupersedes} from './canonical.mjs';
import {patchUpstream, patchAps, patchUi, NATIVE_HEADER, NATIVE_HEADER_VALUE,
  classifyAppAnchors, INTEGRATED_SETUP_SOURCE_LABELS} from './patch.mjs';
import {createApsHarness} from './pipeline.mjs';
import {patchUpstream as patchPreview} from '../first-candidate-preview-20261124/patch.mjs';

const repo = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const read = name => readFileSync(resolve(repo, name), 'utf8');
const clone = value => structuredClone(value);
const model = {start: '2026-11-25T08:00:00', objective: 'duration', orders: [{id: 'A', quantity: 1}, {id: 'B', quantity: 1}],
  equipment: [{id: 'E', capacity: 1, capacity_unit: 'pcs'}], employees: [{id: 'P'}], materials: [{id: 'M'}],
  setup_rules: [{id: 'AB', equipment_ref: 'E', setup_parameter: 'color', from_state: '*', to_state: '*', duration_min: 10}]};
const operations = [
  {order: 'A', batch: 1, batch_id: 'A.1', operation_id: 'work', sequence: 1, equipment_ids: ['E'], employee_ids: ['P'],
    start_min: 600, end_min: 610, duration_min: 10, batch_quantity: 1, materials: [{material_id: 'M', quantity: 1}]},
  {order: 'B', batch: 1, batch_id: 'B.1', operation_id: 'work', sequence: 1, equipment_ids: ['E'], employee_ids: ['P'],
    start_min: 650, end_min: 660, duration_min: 10, batch_quantity: 1, materials: [{material_id: 'M', quantity: 1}]}];
const setups = [{operation_id: '__setup__', equipment_ids: ['E'], employee_ids: [],
  start_min: 640, end_min: 650, duration_min: 10, is_setup: true, phase: 'setup', setup_rule_id: 'AB'}];
function native(extra = {}) {
  return {ok: true, valid: true, partial: false, start: model.start, objective: 'duration',
    operations: clone(operations), generic_operations: clone(operations), setup_operations: clone(setups),
    setup_count: 1, setup_minutes: 10, duration_minutes: 660, batch_count: 2,
    operator_wait_minutes: 12345, machine_idle_minutes: 30, staff_shift_repaired: true,
    order_sequence: ['A', 'B'], history_best: [660],
    resume_state: {version: 1, model_hash: 'c'.repeat(64), pin_hash: 'd'.repeat(64),
      objective: 'duration', order_sequence: ['A', 'B'], best_duration_minutes: 660}, ...extra};
}
const canonical = plan => ppCanonicalNativeResult(plan, model, 'current-model');
let upstream = read('ops/ovh/ga-complete-setup-final-20261117/python-ga-upstream.mjs');
const stream = read('ops/ovh/sse-stream-v1-20261120/backend-stream.js.txt');
upstream = upstream.replace('  async function fetchUpstream(req,opts){', stream + '  async function fetchUpstream(req,opts){')
  .replace("    if(path==='/api/plan-progress'&&req.method==='GET')return progress(req);",
    "    if(path==='/api/plan-progress'&&req.method==='GET')return progress(req);\n    if(path==='/api/plan-events'&&req.method==='GET')return stream(req);");
upstream = patchPreview(upstream);
const patchedUpstream = patchUpstream(upstream);
const reconcileSource = read('ops/ovh/ga-final-progress-reconcile-20261117/patch-progress.mjs');
const reconcile = JSON.parse(reconcileSource.match(/^const helper=(".*");$/m)[1]);
const originalAps = read('baselines/2026-10-10/aps-setup-bridge/index.ts');
const aps = originalAps.replace('async function progress(req){', reconcile + '\nasync function progress(req){')
  .replace('  data.objective=goal;\n  data.aps_setup_bridge=REV;', '  ppReconcileSetupAwareTerminal(data,model);\n  data.objective=goal;\n  data.aps_setup_bridge=REV;');
const patchedAps = patchAps(aps);
const floorSource = read('ops/ovh/ga-objective-floor-active-ui-20261118/patch.mjs');
const floor = JSON.parse(floorSource.match(/^const appended=(".*");$/m)[1]);
const sseSource = read('ops/ovh/sse-stream-v1-20261120/frontend.js.txt');
const consumer = sseSource.slice(sseSource.indexOf('function updatePreviewKpis(preview){'), sseSource.indexOf('\nfunction paintPreview(){'));
assert(consumer.startsWith('function updatePreviewKpis(preview){') && consumer.endsWith('}'));
const ui = 'function ppFixedFirstBestKpiDelta(){}\nfunction ppSelectedPlanKpiReferenceV2(){}\n' + floor +
  '\n' + consumer + '\nfunction paintPreview(){}';
const patchedUi = patchUi(ui);

test('source diagnostics report all fixed anchor counts without source excerpts', () => {
  const files = {'python-ga-upstream.mjs': upstream,
    'baselines/2026-10-10/aps-setup-bridge/index.ts': aps, 'restart-optimizer-ui.js': ui};
  const installed = {'python-ga-upstream.mjs': patchedUpstream,
    'baselines/2026-10-10/aps-setup-bridge/index.ts': patchedAps, 'restart-optimizer-ui.js': patchedUi};
  for (const sources of [files, installed]) {
    const facts = classifyAppAnchors(sources);
    assert.equal(facts.length, 24);
    assert(facts.every(row => row.count === row.expected && INTEGRATED_SETUP_SOURCE_LABELS.includes(row.label)));
  }
  const secret = 'PRIVATE_SOURCE_SENTINEL_NOT_METADATA';
  const changed = {...files, 'python-ga-upstream.mjs': upstream.replace('publicPlan(status.candidate_preview)',
    'publicPlan(status.other_preview)') + '\npublicCheckpoint(state.best); // ' + secret};
  const mismatches = classifyAppAnchors(changed).filter(row => row.count !== row.expected);
  assert.deepEqual(mismatches, [
    {label: 'upstream_checkpoint_calls', expected: 2, count: 3},
    {label: 'upstream_async_candidate', expected: 1, count: 0}
  ]);
  assert(!JSON.stringify(mismatches).includes(secret));
  assert.throws(() => patchUpstream(changed['python-ga-upstream.mjs']), /INTEGRATED_SETUP_SOURCE_DRIFT_upstream_checkpoint_calls/);
});

function bridgeHarness({result = native(), best = result, state = 'completed', saved = null, source = patchedUpstream} = {}) {
  const requests = [], stored = new Map();
  if (saved) stored.set('owner', saved);
  const job = 'a'.repeat(32);
  const create = new Function('console', source.replace('export function createPythonGAUpstream', 'function createPythonGAUpstream') +
    '\nreturn createPythonGAUpstream;')({warn() {}});
  const bridge = create({enabled: true, origin: 'http://ga-worker.railway.internal:8080', token: 'synthetic-token'.repeat(4),
    sessionKey: async () => 'owner', verifyLogin: async () => true, upstreamUrl: req => req.url,
    readAccountModel: async () => clone(model), hashModel: () => 'current-model',
    checkPlan: plan => plan.operations.every(row => row.order == null || ['A', 'B'].includes(row.order)),
    stateStore: {load: async key => stored.get(key) || null, save: async (key, value) => stored.set(key, {
      job_id: value.id, model_hash: value.modelKey, status: value.state, best_preview: value.best,
      result: value.result, resume_state: value.resume_state, progress: value.progress})},
    fetchImpl: async (url, options) => {
      requests.push({path: new URL(url).pathname, options});
      if (new URL(url).pathname === '/internal/jobs' && options.method === 'POST') return Response.json({job_id: job}, {status: 202});
      if (new URL(url).pathname.endsWith('/cancel')) {
        state = 'cancelled';
        return Response.json({job_id: job, status: 'cancelled', best_preview: {...clone(best), _pp_verified_checkpoint_v1: true}, variants: []});
      }
      return Response.json({job_id: job, status: state, progress: state === 'completed' ? 100 : 50,
        best_preview: clone(best), candidate_preview: state === 'running' ? clone(best) : null,
        result: state === 'completed' ? clone(result) : null});
    }});
  const req = (path, method = 'GET') => new Request('https://app.example.test' + path, {method});
  return {bridge, requests, stored, req, job,
    start: () => bridge.fetch(req('/api/plan', 'POST'), {body: JSON.stringify({__pp_async_start: true})}),
    progress: () => bridge.fetch(req('/api/plan-progress?job_id=' + job))};
}

function floorHarness(incoming, previous, source = patchedUi) {
  const values = new Map([
    ['prodplan.project.active.v2', 'project'],
    ['prodplan.projects.v2', JSON.stringify([{id: 'project', revision: 7, model, lastPlan: previous}])],
    ['pp.kpi.first-best.v1.project', JSON.stringify({projectId: 'project', revision: 7, compare: true,
      metrics: {duration: previous.duration_minutes, cycles: previous.batch_count, wait: previous.operator_wait_minutes, idle: previous.machine_idle_minutes}})]
  ]);
  const window = {location: {href: 'https://app.example.test/'}, __ppOptimizerObjectiveAtStart: 'duration',
    __ppOptimizerCommittedPlan: clone(previous), __ppKpiBaselinePlan: clone(previous),
    fetch: async () => Response.json(incoming)};
  const context = {window, localStorage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)},
    URL, Headers, Response, console: {warn() {}}, previousKpiMetrics: {duration: previous.duration_minutes}};
  const start = source.indexOf('// pp_integrated_native_setup_20261125');
  const floorAt = source.indexOf(';(function ppGaQualityFloorV1(){', start);
  const end = source.indexOf('\n})();', floorAt) + '\n})();'.length;
  assert(start >= 0 && floorAt > start && end > floorAt);
  runInNewContext(source.slice(start, end), context, {timeout: 1000});
  return {window, values, context};
}

function previewKpiHarness(incoming, previous) {
  const h = floorHarness(incoming, previous), classes = new Set();
  h.context.document = {createElement: () => ({}), head: {appendChild() {}},
    documentElement: {classList: {contains: name => classes.has(name),
      toggle(name, active) { if (active) classes.add(name); else classes.delete(name); }}},
    getElementById: () => null};
  h.context.setInterval = () => 0;
  h.context.window.addEventListener = () => {};
  h.context.localStorage.removeItem = key => h.values.delete(key);
  h.context.rendered = [];
  runInNewContext('window.renderKpisWithDelta=function(plan){rendered.push({duration:plan.duration_minutes,' +
    'baseline:previousKpiMetrics?{...previousKpiMetrics}:null,' +
    'delta:previousKpiMetrics?plan.duration_minutes-previousKpiMetrics.duration:null});};', h.context);
  const pluginSource = read('ops/ovh/kpi-delta-first-best-20261118/patch.mjs');
  const plugin = JSON.parse(pluginSource.match(/const addon=("(?:\\.|[^"\\])*");/)[1]);
  runInNewContext(plugin, h.context, {timeout: 1000});
  const actualConsumer = patchedUi.slice(patchedUi.indexOf('function updatePreviewKpis(preview){'),
    patchedUi.indexOf('\nfunction paintPreview(){'));
  runInNewContext('let kpiUpdates=0,lastKpiMetrics=null;\n' + actualConsumer +
    '\nwindow.__testUpdatePreviewKpis=updatePreviewKpis;', h.context, {timeout: 1000});
  return {...h, update: value => h.window.__testUpdatePreviewKpis(value)};
}

function nativePreview(plan, duration = plan.duration_minutes) {
  return {partial: true, _pp_preview_limited: true, _pp_preview_origin: 'best',
    operations: clone(plan.operations.slice(0, 1)),
    _pp_preview_kpis: {duration_minutes: duration, batch_count: plan.batch_count,
      operator_wait_minutes: plan.operator_wait_minutes, machine_idle_minutes: plan.machine_idle_minutes},
    _pp_preview_native_context: {version: plan._pp_native_schedule_v1.version,
      context: clone(plan._pp_native_schedule_v1.context)}};
}

test('delayed native production and setup are joined without any retiming or KPI/resume rewrite', () => {
  const before = native(), frozen = JSON.stringify(before), out = canonical(before);
  assert(out);
  assert.equal(JSON.stringify(before), frozen);
  assert.equal(out.operations.length, 3);
  assert.deepEqual(out.operations.map(row => [row.start_min, row.end_min]), [[600, 610], [640, 650], [650, 660]]);
  for (const key of ['duration_minutes', 'operator_wait_minutes', 'machine_idle_minutes', 'batch_count', 'resume_state', 'history_best'])
    assert.deepEqual(out[key], before[key]);
  assert.deepEqual(out.operations, out.generic_operations);
  assert.equal(out.setup_operation_count, 1);
  assert.equal(out.setup_duration_total_minutes, 10);
  assert(ppNativePresentationPlan(out));
  assert.deepEqual(canonical(out), out);
});

test('legitimate zero setups remain authoritative for models that have setup rules', () => {
  for (const input of [native({setup_operations: [], setup_count: 0, setup_minutes: 0}),
    native({setup_operations: undefined, setup_count: 0, setup_minutes: 0})]) {
    const out = canonical(input);
    assert(out);
    assert.equal(out.setup_operations.length, 0);
    assert.equal(out.operations.length, 2);
    assert.equal(out.duration_minutes, 660);
  }
  assert.equal(canonical(native({setup_operations: undefined, setup_count: undefined, setup_minutes: undefined})), null);
});

test('conflicting representations, repeated rows, stale result metrics and reconciled legacy finals fail closed', () => {
  const modifications = [
    p => p.generic_operations[0].start_min = 599,
    p => p.operations.push(clone(p.operations[0])),
    p => p.generic_operations.push(clone(p.generic_operations[0])),
    p => p.setup_operations.push(clone(p.setup_operations[0])),
    p => p.setup_count = 0,
    p => p.setup_minutes = 9,
    p => p.resume_state.best_duration_minutes = 10260,
    p => p.history_best = [10260],
    p => p.diagnostic_final = {duration_minutes: 10260},
    p => p.optimization_termination_reason = 'reconciled_setup_aware_final',
    p => p.setup_enrichment_stage = 'scheduler_reservation',
    p => p.valid = false
  ];
  for (const modify of modifications) {
    const plan = native(); modify(plan);
    assert.equal(canonical(plan), null);
  }
});

test('shared native setup template IDs can identify distinct physical intervals', () => {
  const plan = native({setup_count: 2, setup_minutes: 20});
  plan.setup_operations.push({...clone(setups[0]), start_min: 620, end_min: 630});
  const out = canonical(plan);
  assert(out);
  assert.equal(out.setup_operations.length, 2);
  assert.deepEqual(out.setup_operations.map(row => row.start_min), [620, 640]);
  const withInline = native();
  withInline.generic_operations.push(clone(setups[0]));
  assert.equal(canonical(withInline).operations.length, 3);
});

test('browser checksum detects modified generic operations as well as production/setup and KPI changes', () => {
  const out = canonical(native());
  for (const modify of [p => p.generic_operations = p.generic_operations.map((row, i) => i ? row : {...row, start_min: 1}),
    p => p.setup_operations[0].start_min = 0, p => p.operator_wait_minutes = 0]) {
    const changed = clone(out); modify(changed);
    assert.equal(ppNativePresentationPlan(changed), false);
    assert.notEqual(ppNativeScheduleFingerprint(changed), out._pp_native_schedule_v1.signature);
  }
});

test('actual worker bridge + actual APS progress preserve the native schedule and never invoke legacy search', async () => {
  const h = bridgeHarness();
  assert.equal((await h.start()).status, 202);
  const app = createApsHarness(patchedAps, {model, fetchUpstream: (req, opts) => h.bridge.fetch(req, opts)});
  const response = await app.progress(h.req('/api/plan-progress?job_id=' + h.job));
  assert.equal(response.headers.get(NATIVE_HEADER), NATIVE_HEADER_VALUE);
  const data = await response.json();
  assert.equal(data.result.duration_minutes, 660);
  assert.equal(data.result.operations.length, 3);
  assert.equal(Math.min(...data.result.operations.map(row => row.start_min)), 600);
  assert.equal(data.result.operator_wait_minutes, 12345);
  assert.equal(data.result.resume_state.best_duration_minutes, 660);
  assert.equal(app.legacyCalls(), 0);
  assert.deepEqual(data.best_preview, data.result);
});

test('native provenance wraps the existing response factory without replacing its headers, status or body', async () => {
  const original = "  const response = (body, status=200) => Response.json(body,{status,headers:{'cache-control':'no-store'}});";
  const variant = "  const response = (body, status=200) => Response.json(body,{status,statusText:'Native result',headers:{'cache-control':'private, no-store','content-type':'application/vnd.native+json','x-existing-server-header':'preserved'}});";
  assert.equal(upstream.split(original).length, 2);
  const changed = upstream.replace(original, variant);
  const patched = patchUpstream(changed);
  assert.equal(patchUpstream(patched), patched);
  const h = bridgeHarness({source: patched});
  const started = await h.start();
  assert.equal(started.status, 202);
  assert.equal(started.statusText, 'Native result');
  assert.equal(started.headers.get('x-existing-server-header'), 'preserved');
  const result = await h.progress();
  assert.equal(result.status, 200);
  assert.equal(result.statusText, 'Native result');
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.equal(result.headers.get('content-type'), 'application/vnd.native+json');
  assert.equal(result.headers.get('x-existing-server-header'), 'preserved');
  assert.equal(result.headers.get(NATIVE_HEADER), NATIVE_HEADER_VALUE);
  assert.equal((await result.json()).result.duration_minutes, 660);
  assert.throws(() => patchUpstream(patched.replace("'preserved'", "'changed'")), /RESPONSE_FACTORY_GUARD/);
  assert.throws(() => patchUpstream(upstream.replace(original, original + '\n  const unrelated = 1;')), /RESPONSE_FACTORY_GUARD/);
});

test('synchronous plan, native errors and async202 cross the same provenance boundary without synthesis', async () => {
  for (const [status, body] of [[200, canonical(native())], [422, {ok: false, error: 'native_schedule_contract_invalid'}],
    [202, {ok: true, started: true, job_id: 'a'.repeat(32)}]]) {
    const app = createApsHarness(patchedAps, {model, fetchUpstream: async () => Response.json(body,
      {status, headers: {[NATIVE_HEADER]: NATIVE_HEADER_VALUE}})});
    const response = await app.plan(new Request('https://app.example.test/api/plan', {method: 'POST', body: '{}'}));
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), body);
    assert.equal(app.legacyCalls(), 0);
  }
});

test('client-supplied provenance header never grants the native bypass to a legacy response', async () => {
  const legacy = native({setup_operations: undefined, setup_count: undefined, setup_minutes: undefined});
  const app = createApsHarness(patchedAps, {model, accountPlanBelongsToModel: () => true,
    fetchUpstream: async () => Response.json({ok: true, running: false, success: true, best_preview: legacy, result: legacy})});
  await app.progress(new Request('https://app.example.test/api/plan-progress', {headers: {[NATIVE_HEADER]: NATIVE_HEADER_VALUE}}));
  assert(app.legacyCalls() > 0);
});

test('authoritative zero-setup final is not replaced by an earlier checkpoint with setups', async () => {
  const zero = native({setup_operations: [], setup_count: 0, setup_minutes: 0});
  const h = bridgeHarness({result: zero, best: native()});
  await h.start();
  const data = await (await h.progress()).json();
  assert.equal(data.success, true);
  assert.equal(data.result.operations.length, 2);
  assert.equal(data.result.setup_operations.length, 0);
  assert.equal(data.result.optimization_termination_reason, undefined);
});

test('Stop retains detached setup with no order and every presentation signature field', async () => {
  const h = bridgeHarness({state: 'running'});
  await h.start();
  const progress = await (await h.progress()).json();
  assert.equal(progress.best_preview.operations.length, 3);
  const stopped = await h.bridge.cancel(h.req('/api/optimizer-stop?job_id=' + h.job, 'POST'));
  assert.equal(stopped.stopped, true);
  assert.equal(stopped.best_preview.operations.length, 3);
  assert.equal(stopped.best_preview.setup_operations[0].order, undefined);
  assert.equal(stopped.best_preview.resume_state, undefined);
  assert(ppNativePresentationPlan(stopped.best_preview));
  const state = h.stored.get('owner');
  assert.deepEqual(state.best_preview.resume_state, native().resume_state);
});

test('old4368 floor cannot replace a currently authoritative10260 result or retain misleading comparison delta', async () => {
  const previous = native({duration_minutes: 4368, history_best: undefined, resume_state: undefined});
  const next = canonical(native({duration_minutes: 10260, history_best: [10260],
    resume_state: {...native().resume_state, best_duration_minutes: 10260}}));
  const h = floorHarness({ok: true, running: false, success: true, phase: 'completed', result: next}, previous);
  const data = await (await h.window.fetch('/api/plan-progress')).json();
  assert.equal(data.result.duration_minutes, 10260);
  assert.equal(data.optimization_previous_best_preserved, undefined);
  const reference = JSON.parse(h.values.get('pp.kpi.first-best.v1.project'));
  assert.equal(reference.compare, false);
  assert.equal(reference.metrics.duration, 10260);
  assert.equal(reference.obsolete_metrics.duration, 4368);
  assert.equal(reference.obsolete_comparison, true);
  assert.equal(h.window.__ppKpiBaselinePlan, null);
});

test('actual SSE KPI consumer and first-best plugin remove the legacy comparison once through previews and final', async () => {
  const previous = native({duration_minutes: 4368, history_best: undefined, resume_state: undefined});
  const final = canonical(native({duration_minutes: 9600, history_best: [9600],
    resume_state: {...native().resume_state, best_duration_minutes: 9600}}));
  const h = previewKpiHarness(final, previous), key = 'pp.kpi.first-best.v1.project';
  h.update(nativePreview(final, 10260));
  const first = h.values.get(key), record = JSON.parse(first);
  assert.equal(record.metrics.duration, 10260);
  assert.equal(record.obsolete_metrics.duration, 4368);
  assert.equal(record.compare, false);
  assert.deepEqual(record.native_context, final._pp_native_schedule_v1.context);
  assert.equal(h.context.rendered.at(-1).baseline, null);
  assert.equal(h.context.rendered.at(-1).delta, null);
  h.update(nativePreview(final, 9900));
  assert.equal(h.values.get(key), first, 'improving previews must not move the first native reference');
  assert.equal(h.context.rendered.at(-1).duration, 9900);
  assert.equal(h.context.rendered.at(-1).delta, null);
  const accepted = await (await h.window.fetch('/api/plan', {method: 'POST'})).json();
  assert.equal(accepted.duration_minutes, 9600);
  assert.equal(h.values.get(key), first, 'the final must retain the same migration baseline');
  delete h.window.__PP_INTEGRATED_NATIVE_RESULT_V1__;
  const start = patchedUi.indexOf('// pp_integrated_native_setup_20261125');
  const end = patchedUi.indexOf(';(function ppGaQualityFloorV1(){', start);
  runInNewContext(patchedUi.slice(start, end), h.context, {timeout: 1000});
  h.update(nativePreview(final, 9500));
  assert.equal(h.values.get(key), first, 'persisted native context prevents migration rebasing after reinstall');
});

test('native-to-native preview comparisons keep their accepted baseline and unmarked candidates cannot reset it', () => {
  const previous = canonical(native({duration_minutes: 9000, history_best: [9000],
    resume_state: {...native().resume_state, best_duration_minutes: 9000}}));
  const next = canonical(native({duration_minutes: 8500, history_best: [8500],
    resume_state: {...native().resume_state, best_duration_minutes: 8500}}));
  const h = previewKpiHarness(next, previous), key = 'pp.kpi.first-best.v1.project', before = h.values.get(key);
  h.update(nativePreview(next));
  assert.equal(h.values.get(key), before);
  assert.equal(h.context.rendered.at(-1).baseline.duration, 9000);
  assert.equal(h.context.rendered.at(-1).delta, -500);
  const legacy = floorHarness(next, native({duration_minutes: 4368, history_best: undefined, resume_state: undefined}));
  const original = legacy.values.get(key);
  for (const change of [p => delete p._pp_preview_native_context, p => p._pp_preview_origin = 'candidate',
    p => p.partial = false, p => p._pp_preview_kpis.duration_minutes = NaN,
    p => p._pp_preview_native_context.context.model_key = '']) {
    const preview = nativePreview(next); change(preview);
    assert.equal(legacy.window.__PP_INTEGRATED_NATIVE_RESULT_V1__.acceptPreview(preview), false);
    assert.equal(legacy.values.get(key), original);
  }
});

test('Stop previous followed by Continue restores the same first native reference without using an improved preview as baseline', () => {
  const previous = native({duration_minutes: 4368, history_best: undefined, resume_state: undefined});
  const final = canonical(native({duration_minutes: 9600, history_best: [9600],
    resume_state: {...native().resume_state, best_duration_minutes: 9600}}));
  const h = previewKpiHarness(final, previous), key = 'pp.kpi.first-best.v1.project';
  const legacyReference = JSON.parse(h.values.get(key));
  h.update(nativePreview(final, 10260));
  const firstNativeReference = h.values.get(key);
  // Existing selected-reference plugin records explicit Stop previous and
  // the next Continue enables comparison with that selected legacy record.
  h.values.set(key, JSON.stringify({...legacyReference, selectedSource: 'stop_previous', compare: true}));
  h.update(nativePreview(final, 9900));
  assert.equal(h.values.get(key), firstNativeReference);
  assert.equal(JSON.parse(h.values.get(key)).metrics.duration, 10260);
  assert.equal(h.context.rendered.at(-1).duration, 9900);
  assert.equal(h.context.rendered.at(-1).delta, null);
  h.update(nativePreview(final, 9800));
  assert.equal(h.values.get(key), firstNativeReference);
});

test('fresh mode compares only its accepted new reference and never revives an older canonical saved plan', async () => {
  const planAt = duration => canonical(native({duration_minutes: duration, history_best: [duration],
    resume_state: {...native().resume_state, best_duration_minutes: duration}}));
  const h = floorHarness(planAt(10000), planAt(9000));
  h.window.__ppFreshRestartMode = true;
  h.window.__ppFreshRestartProject = 'project';
  h.window.__ppFreshReferencePlan = null;
  const first = await (await h.window.fetch('/api/plan', {method: 'POST'})).json();
  assert.equal(first.duration_minutes, 10000);
  assert.equal(first.optimization_previous_best_preserved, undefined);
  h.window.__ppFreshReferencePlan = planAt(9500);
  const second = await (await h.window.fetch('/api/plan', {method: 'POST'})).json();
  assert.equal(second.duration_minutes, 9500);
  assert.equal(JSON.parse(h.values.get('prodplan.projects.v2'))[0].lastPlan.duration_minutes, 9000,
    'saved history is preserved while excluded from the fresh comparison');
});

test('matching canonical context still preserves the better accepted objective value', async () => {
  const previous = canonical(native({duration_minutes: 9000, history_best: [9000],
    resume_state: {...native().resume_state, best_duration_minutes: 9000}}));
  const next = canonical(native({duration_minutes: 10260, history_best: [10260],
    resume_state: {...native().resume_state, best_duration_minutes: 10260}}));
  const h = floorHarness(next, previous);
  const data = await (await h.window.fetch('/api/plan', {method: 'POST'})).json();
  assert.equal(data.duration_minutes, 9000);
  assert.equal(data.optimization_previous_best_preserved, true);
  assert.equal(JSON.parse(h.values.get('pp.kpi.first-best.v1.project')).compare, true);
  assert.equal(ppNativePresentationSupersedes(next, previous), false);
});

test('actual generated incumbent decision and persistence guard accept valid10260 over obsolete4368', () => {
  const prior = native({duration_minutes: 4368, history_best: undefined, resume_state: undefined});
  const next = canonical(native({duration_minutes: 10260, history_best: [10260],
    resume_state: {...native().resume_state, best_duration_minutes: 10260}}));
  const h = floorHarness(next, prior);
  const literal = patchedAps.match(/html=html\.slice\(0,a\)\+("(?:\\.|[^"\\])*")\+/)[1];
  const decisionCode = JSON.parse(literal);
  const decision = new Function('window', 'model', decisionCode + '\nreturn ppIncumbentDecision;')(h.window, model);
  assert.equal(decision(next, prior).accept, true);
  const canonicalPrior = canonical(native({duration_minutes: 9000, history_best: [9000],
    resume_state: {...native().resume_state, best_duration_minutes: 9000}}));
  assert.equal(decision(next, canonicalPrior).accept, false);
  const strings = [...patchedAps.matchAll(/"(?:\\.|[^"\\])*"/g)].map(match => {try {return JSON.parse(match[0]);} catch {return '';}});
  const generated = strings.find(value => value.startsWith('window.ppProjectAfterPlan=function(d){') && value.includes('PP_OPT_SAVE_REGRESSION_PREVENTED'));
  assert(generated);
  let saved = null;
  const window = {...h.window};
  new Function('window', 'model', 'active', 'find', 'mutate', 'console',
    generated + 'x.lastPlan=d;});};')(window, model, () => 'project', () => ({revision: 7, lastPlan: prior}),
      (_id, fn) => {const record = {}; fn(record); saved = record.lastPlan;}, {warn() {}});
  window.ppProjectAfterPlan(next);
  assert.equal(saved, next);
});

test('all three source patches are exact/idempotent and reject source drift', () => {
  for (const [patch, before, after] of [[patchUpstream, upstream, patchedUpstream], [patchAps, aps, patchedAps], [patchUi, ui, patchedUi]])
    assert.equal(patch(after), after);
  assert.throws(() => patchAps(aps.replace('AbortSignal.timeout(30000)', 'AbortSignal.timeout(30001)')), /SOURCE_DRIFT/);
  assert.throws(() => patchUpstream(upstream.replace('plan=publicPlan(plan);', 'plan=someOtherFunction(plan);')), /SOURCE_DRIFT/);
  assert.throws(() => patchUi(ui.replace('const incumbent=floor();', 'const incumbent=other();')), /SOURCE_DRIFT/);
  execFileSync(process.execPath, ['--check', '--input-type=module'], {input: patchedUpstream, stdio: ['pipe', 'pipe', 'pipe']});
  execFileSync(process.execPath, ['--check'], {input: patchedUi, stdio: ['pipe', 'pipe', 'pipe']});
});

test('optional actual application sources patch, parse and retain terminal native schedule', {
  skip: !process.env.LIFTORBIT_INTEGRATED_SETUP_APP_FIXTURE_ROOT
}, async () => {
  const root = process.env.LIFTORBIT_INTEGRATED_SETUP_APP_FIXTURE_ROOT;
  const actualBridge = patchUpstream(readFileSync(resolve(root, 'python-ga-upstream.mjs'), 'utf8'));
  const actualAps = patchAps(readFileSync(resolve(root, 'baselines/2026-10-10/aps-setup-bridge/index.ts'), 'utf8'));
  const actualUi = patchUi(readFileSync(resolve(root, 'restart-optimizer-ui.js'), 'utf8'));
  assert.equal(patchUpstream(actualBridge), actualBridge);
  assert.equal(patchAps(actualAps), actualAps);
  assert.equal(patchUi(actualUi), actualUi);
  const h = bridgeHarness({source: actualBridge}); await h.start();
  const app = createApsHarness(actualAps, {model, fetchUpstream: (req, opts) => h.bridge.fetch(req, opts)});
  const data = await (await app.progress(h.req('/api/plan-progress?job_id=' + h.job))).json();
  assert.equal(data.result.duration_minutes, 660);
  assert.equal(data.result.operations.length, 3);
  assert.equal(app.legacyCalls(), 0);
  assert(ppNativePresentationPlan(data.result));
});
