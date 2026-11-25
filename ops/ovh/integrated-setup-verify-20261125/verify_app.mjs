/** Actual authenticated worker bridge + complete APS handlers; no network. */
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createApsHarness} from '../integrated-setup-result-20261125/pipeline.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const stable = value => value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(stable) : Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]))
  : value;
const encode = value => JSON.stringify(stable(value));
const digest = value => createHash('sha256').update(encode(value)).digest('hex');
const setup = row => row?.is_setup === true || ['setup'].includes(String(row?.phase || row?.type || '').toLowerCase());
const JOB = 'a'.repeat(32), OTHER = 'b'.repeat(32), NEXT = 'c'.repeat(32);
const CASES = new Set(['setup_sequence', 'delayed_material_shift', 'pinned_native', 'zero_setups']);
const CHECKS = ['pipeline_preserves_native_schedule', 'pipeline_preserves_native_metrics',
  'pipeline_preserves_server_resume', 'public_stop_projection_coherent', 'zero_setups_authoritative',
  'delayed_material_shift_preserved', 'pins_preserved', 'scoped_stop_isolated',
  'no_legacy_rescheduling', 'all_app_checks_passed'];
class GateError extends Error {}
function need(ok, code) { if (!ok) throw new GateError(code); }

function rowKey(row, forcedSetup = false) {
  return [forcedSetup || setup(row), String(row.order), String(row.operation_id),
    row.batch ?? null, row.batch_id ?? null, row.batch_quantity ?? null, row.batch_unit ?? null,
    row.start_min, row.end_min, row.duration_min ?? null, row.start ?? null, row.end ?? null,
    [...(row.equipment_ids || [])].map(String).sort(), [...(row.employee_ids || [])].map(String).sort(),
    (row.materials || []).map(m => [String(m.id), m.quantity]).sort((a, b) => encode(a).localeCompare(encode(b))),
    row.manual_locked === true];
}

export function scheduleFacts(plan) {
  const native = plan?.operations || [], generic = plan?.generic_operations || [], detached = plan?.setup_operations || [];
  need([native, generic, detached].every(Array.isArray), 'schedule_arrays');
  const primary = native.length ? native : generic;
  const production = primary.filter(row => !setup(row)).map(row => rowKey(row));
  need(production.length > 0, 'production_missing');
  if (native.length && generic.length)
    need(encode(native.filter(row => !setup(row)).map(row => rowKey(row)).sort()) ===
      encode(generic.filter(row => !setup(row)).map(row => rowKey(row)).sort()), 'production_arrays_disagree');
  const setups = new Map();
  for (const [array, forced] of [[native, false], [generic, false], [detached, true]]) {
    const seen = new Set();
    for (const row of array) {
      if (!forced && !setup(row)) continue;
      const value = rowKey(row, true), key = encode(value);
      need(!seen.has(key), 'duplicate_setup'); seen.add(key); setups.set(key, value);
    }
  }
  return {rows: [...production, ...setups.values()].sort((a, b) => encode(a).localeCompare(encode(b))),
    production_count: production.length, setup_count: setups.size};
}

export function comparePlan(before, after, {publicProjection = false, objective = 'duration'} = {}) {
  need(after?.valid === true && after.partial !== true, 'output_not_complete_valid_plan');
  need(after.optimization_termination_reason !== 'reconciled_setup_aware_final' &&
    after.setup_enrichment_stage !== 'scheduler_reservation', 'legacy_reconciliation_marker');
  const left = scheduleFacts(before), right = scheduleFacts(after);
  need(encode(left) === encode(right), 'schedule_or_material_or_pin_changed');
  for (const key of ['duration_minutes', 'operator_wait_minutes', 'machine_idle_minutes', 'batch_count',
    'start', 'finish', 'order_sequence']) {
    if (Object.hasOwn(before, key)) need(encode(after[key]) === encode(before[key]), 'native_metrics_changed');
  }
  // Scoped Stop deliberately publishes a bounded projection. History and the
  // native setup aliases may be omitted, but their public canonical counts
  // and intervals must still agree exactly with this same native schedule.
  for (const key of ['setup_count', 'setup_minutes', 'history_best']) {
    if (Object.hasOwn(before, key) && (!publicProjection || Object.hasOwn(after, key)))
      need(encode(after[key]) === encode(before[key]), 'native_metrics_changed');
  }
  if (publicProjection) {
    const minutes = right.rows.filter(row => row[0]).reduce((sum, row) => sum + row[8] - row[7], 0);
    need(after.setup_operation_count === right.setup_count, 'public_setup_count_changed');
    need(typeof after.setup_duration_total_minutes === 'number' &&
      Math.abs(after.setup_duration_total_minutes - minutes) <= 1e-5, 'public_setup_minutes_changed');
  }
  if (!publicProjection || after.resume_state != null)
    need(encode(after.resume_state) === encode(before.resume_state), 'native_resume_changed');
  const expectedObjective = before.resume_state?.objective || before.objective || objective || 'duration';
  if (after.resume_state) need((after.resume_state.objective || 'duration') === expectedObjective, 'resume_objective_changed');
  if (after._pp_native_schedule_v1)
    need(after._pp_native_schedule_v1.context?.objective === expectedObjective, 'presentation_objective_changed');
  return {production_count: right.production_count, setup_count: right.setup_count,
    schedule_sha256: digest(right), duration_minutes: after.duration_minutes};
}

export function upstreamHarness(source, fixture, {phase = 'running', initial = true, expected = fixture.final} = {}) {
  need(source.split('export function createPythonGAUpstream').length === 2, 'upstream_export_contract');
  const factory = new Function('console', source.replace('export function createPythonGAUpstream', 'function createPythonGAUpstream') +
    '\nreturn createPythonGAUpstream;')({log() {}, warn() {}, error() {}});
  const sourceModel = clone(fixture.model), modelKey = digest(sourceModel), persisted = new Map();
  const worker = {phase, cancelCalls: 0, statusCalls: 0};
  if (initial) persisted.set('one', {job_id: JOB, model_hash: modelKey, status: 'running', progress: 12,
    result: null, best_preview: null, resume_state: null});
  persisted.set('two', {job_id: OTHER, model_hash: modelKey, status: 'running', progress: 12});
  function snapshot(id) {
    return {job_id: id, status: worker.phase, progress: worker.phase === 'completed' ? 100 : 12,
      best_preview: clone(expected), candidate_preview: worker.phase === 'running' ? clone(expected) : null,
      result: worker.phase === 'completed' ? clone(fixture.final) : undefined, error: null};
  }
  const bridge = factory({enabled: true, origin: 'http://ga-worker.railway.internal:8080',
    token: 'synthetic-verification-token-'.repeat(3), upstreamUrl: req => req.url,
    sessionKey: async req => req.headers.get('x-test-account') || 'one', verifyLogin: async () => true,
    readAccountModel: async () => clone(sourceModel), hashModel: digest,
    checkPlan: (plan, candidate) => {
      const orders = new Set(candidate.orders.map(row => String(row.id)));
      const equipment = new Set(candidate.equipment.map(row => String(row.id)));
      const employees = new Set(candidate.employees.map(row => String(row.id)));
      return plan?.valid === true && plan.partial !== true && Array.isArray(plan.operations) && plan.operations.length > 0 &&
        plan.operations.every(row => (setup(row) || orders.has(String(row.order))) &&
          (row.equipment_ids || []).every(id => equipment.has(String(id))) &&
          (row.employee_ids || []).every(id => employees.has(String(id))));
    },
    stateStore: {load: async principal => clone(persisted.get(principal) || null),
      save: async (principal, state) => persisted.set(principal, clone({job_id: state.id, model_hash: state.modelKey,
        status: state.state, result: state.result, best_preview: state.best, resume_state: state.resume_state,
        progress: state.progress, error: state.error}))},
    sleep: async () => {}, maxWaitMs: 1000,
    fetchImpl: async (url, options) => {
      const path = new URL(url).pathname, principal = options.headers['x-authenticated-account'];
      if (path === '/internal/jobs' && options.method === 'POST') return Response.json({job_id: NEXT}, {status: 202});
      const id = path.split('/')[3];
      need([JOB, OTHER, NEXT].includes(id), 'unexpected_worker_path');
      if ((principal === 'two') !== (id === OTHER)) return Response.json({error: 'account_mismatch'}, {status: 403});
      if (path.endsWith('/cancel')) { worker.cancelCalls++; worker.phase = 'cancelled'; }
      else worker.statusCalls++;
      return Response.json(snapshot(id));
    }});
  const request = (path, method = 'GET', body = undefined, account = 'one') => new Request('https://app.example.test' + path,
    {method, headers: {'x-test-account': account, 'content-type': 'application/json'},
      ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  return {bridge, worker, persisted, request, model: sourceModel};
}

function retainedResume(harness, expected) {
  const saved = harness.persisted.get('one');
  const resume = saved?.result?.resume_state || saved?.best_preview?.resume_state || saved?.resume_state;
  need(encode(resume) === encode(expected.resume_state), 'server_resume_lost');
}

async function checkedResponse(response, code) {
  if (!(response instanceof Response) || !response.ok) {
    const error = new GateError(code);
    if (response instanceof Response) error.httpStatus = response.status;
    throw error;
  }
  return response.json();
}

function apsFor(source, inner) {
  return createApsHarness(source, {fetchUpstream: (req, opts) => inner.bridge.fetch(req, opts), model: inner.model});
}

export async function verify(upstreamSource, apsSource, fixtures) {
  const report = {format: 'integrated-setup-app-v1', schema: 'integrated-setup-app-v1',
    ...Object.fromEntries(CHECKS.map(key => [key, false])), cases: {}, production_writes: false};
  need(fixtures?.schema === 'integrated-setup-fixtures-v1' && Array.isArray(fixtures.cases) && fixtures.cases.length === 4 &&
    new Set(fixtures.cases.map(row => row.name)).size === 4 && fixtures.cases.every(row => CASES.has(row.name)), 'fixture_contract');
  for (const fixture of fixtures.cases) {
    let phase = 'running', checks = 0, legacy = 0;
    try {
      // A previously computed native incumbent is a legitimate running/Stop
      // candidate on Continue. The existing separate 11-case gate exercises a
      // real process Stop; here the actual app routes replay immutable native
      // records through their deterministic worker transport boundary.
      const live = upstreamHarness(upstreamSource, fixture), liveAps = apsFor(apsSource, live);
      const running = await checkedResponse(await liveAps.progress(live.request('/api/plan-progress')), 'running_http');
      need(running.running === true, 'running_status');
      comparePlan(fixture.final, running.best_preview, {publicProjection: true, objective: fixture.options.objective}); checks++;
      if (running.candidate_preview) { comparePlan(fixture.final, running.candidate_preview,
        {publicProjection: true, objective: fixture.options.objective}); checks++; }
      retainedResume(live, fixture.final);
      phase = 'completed_progress'; live.worker.phase = 'completed';
      const completed = await checkedResponse(await liveAps.progress(live.request('/api/plan-progress')), 'completed_http');
      need(completed.success === true && completed.running === false, 'completed_status');
      comparePlan(fixture.final, completed.result, {objective: fixture.options.objective}); checks++;
      retainedResume(live, fixture.final); legacy += liveAps.legacyCalls();
      phase = 'synchronous_plan';
      const sync = upstreamHarness(upstreamSource, fixture, {phase: 'completed', initial: false}), syncAps = apsFor(apsSource, sync);
      const syncPlan = await checkedResponse(await syncAps.plan(sync.request('/api/plan', 'POST',
        {generations: 3, population: 6, objective: fixture.options.objective || 'duration'})), 'synchronous_http');
      comparePlan(fixture.final, syncPlan.result || syncPlan, {objective: fixture.options.objective}); checks++;
      retainedResume(sync, fixture.final); legacy += syncAps.legacyCalls();
      phase = 'scoped_stop';
      const stop = upstreamHarness(upstreamSource, fixture), stopAps = apsFor(apsSource, stop);
      await checkedResponse(await stopAps.progress(stop.request('/api/plan-progress')), 'stop_prepare_http');
      const stopped = await stop.bridge.cancel(stop.request('/api/stop-optimization?job_id=' + JOB, 'POST', {}));
      need(stopped?.ok === true && stopped.stopped === true && stop.worker.cancelCalls === 1, 'scoped_stop_result');
      comparePlan(fixture.final, stopped.best_preview, {publicProjection: true, objective: fixture.options.objective}); checks++;
      for (const choice of stopped.variants || []) {
        comparePlan(fixture.final, choice.plan || choice, {publicProjection: true, objective: fixture.options.objective}); checks++;
      }
      retainedResume(stop, fixture.final); legacy += stopAps.legacyCalls();
      const foreign = upstreamHarness(upstreamSource, fixture);
      const denied = await foreign.bridge.cancel(foreign.request('/api/stop-optimization?job_id=' + JOB, 'POST', {}, 'two'));
      need(denied?.http_status === 409 && foreign.worker.cancelCalls === 0, 'foreign_stop_not_isolated');
      const replaced = await foreign.bridge.cancel(foreign.request('/api/stop-optimization?job_id=' + NEXT, 'POST', {}));
      need(replaced?.http_status === 409 && foreign.worker.cancelCalls === 0, 'replaced_stop_not_isolated');
      need(legacy === 0, 'native_result_replanned');
      const facts = scheduleFacts(fixture.final);
      if (fixture.name === 'zero_setups') need(facts.setup_count === 0, 'zero_setup_not_authoritative');
      report.cases[fixture.name] = {valid: true, comparisons: checks, legacy_calls: legacy,
        production_count: facts.production_count, setup_count: facts.setup_count,
        schedule_sha256: digest(facts), objective: fixture.options.objective || 'duration'};
    } catch (error) {
      report.cases[fixture.name] = {valid: false, phase, error_type: error instanceof GateError ? 'GateError' :
        ['TypeError', 'SyntaxError', 'ReferenceError', 'AssertionError'].includes(error?.name) ? error.name : 'Error',
        ...(error instanceof GateError ? {error_code: error.message} : {}),
        ...(Number.isInteger(error?.httpStatus) ? {http_status: error.httpStatus} : {})};
    }
  }
  const passed = Object.values(report.cases).length === 4 && Object.values(report.cases).every(row => row.valid === true);
  for (const key of CHECKS) report[key] = passed;
  return report;
}

async function main() {
  const args = new Map();
  for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
  need(args.size === 3 && ['--app-root', '--native-fixtures', '--report'].every(key => args.has(key)), 'arguments');
  const app = resolve(args.get('--app-root'));
  let report;
  try {
    report = await verify(readFileSync(resolve(app, 'python-ga-upstream.mjs'), 'utf8'),
      readFileSync(resolve(app, 'baselines/2026-10-10/aps-setup-bridge/index.ts'), 'utf8'),
      JSON.parse(readFileSync(args.get('--native-fixtures'), 'utf8')));
  } catch (error) {
    report = {format: 'integrated-setup-app-v1', ...Object.fromEntries(CHECKS.map(key => [key, false])),
      failure: {phase: 'bootstrap', error_type: error instanceof GateError ? 'GateError' : 'Error',
        ...(error instanceof GateError ? {error_code: error.message} : {})}, production_writes: false};
  }
  writeFileSync(args.get('--report'), JSON.stringify(report), {mode: 0o600, flag: 'wx'});
  process.exitCode = report.all_app_checks_passed ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
