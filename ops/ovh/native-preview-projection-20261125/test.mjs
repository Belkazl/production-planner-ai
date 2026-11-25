import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {ppCanonicalNativeResult, ppNativePresentationPlan, ppNativeScheduleFingerprint,
  ppInstallNativePresentation} from '../integrated-setup-result-20261125/canonical.mjs';
import {patchUpstream as patchCanonical} from '../integrated-setup-result-20261125/patch.mjs';
import {patchUpstream as patchLifecycle} from '../first-candidate-preview-20261124/patch.mjs';
import {patchPreview} from '../integrated-setup-preview-20261125/patch.mjs';
import {upstreamHarness, comparePlan} from '../integrated-setup-verify-20261125/verify_app.mjs';
import {resourcePresentationScript} from '../resource-presentation-20261125/resource-presentation.mjs';
import {ppRestoreNativePreviewAlias, ppRestoreNativePreviewEnvelope, nativePreviewProjectionScript,
  patchNativePreviewProjectionUi, PREVIEW_PROJECTION_MARKER} from './projection.mjs';

const repo = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const read = name => readFileSync(resolve(repo, name), 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
const JOB = 'a'.repeat(32), OTHER = 'b'.repeat(32);
const model = {start: '2026-11-25T08:00:00', objective: 'duration', orders: [{id: 'O', quantity: 10}],
  equipment: [{id: 'E', capacity: 10}], employees: [{id: 'P'}], materials: [],
  technical_processes: [{id: 'T', operations: [{id: 'work'}]}], setup_rules: []};
function native() {
  return {ok: true, valid: true, partial: false, start: model.start, objective: 'duration',
    operations: [{order: 'O', operation_id: 'work', batch: 1, batch_id: 'O.1', batch_quantity: 10,
      equipment_ids: ['E'], employee_ids: ['P'], start_min: 20, end_min: 30, duration_min: 10,
      manual_locked: true, materials: []}],
    setup_operations: [{order: 'O', operation_id: '__setup__', equipment_ids: ['E'], employee_ids: ['P'],
      is_setup: true, phase: 'setup', start_min: 15, end_min: 20, duration_min: 5}],
    setup_count: 1, setup_minutes: 5, duration_minutes: 30, batch_count: 1,
    operator_wait_minutes: 15, machine_idle_minutes: 15, order_sequence: ['O'], history_best: [30],
    resume_state: {version: 2, model_hash: 'c'.repeat(64), pin_hash: 'd'.repeat(64), objective: 'duration',
      order_sequence: ['O'], best_duration_minutes: 30,
      batch_genome: {version: 1, order_sequence: ['O'], partitions: [{order_id: 'O', sizes: [10]}]}}};
}
function canonical() {
  const plan = ppCanonicalNativeResult(native(), model, 'synthetic-current-model');
  assert(ppNativePresentationPlan(plan)); return plan;
}

// Exact public installed compactor from:
// https://github.com/Belkazl/production-planner-ai/blob/0158a0514b7bca113fee92b2389747d081a8a1f6/ops/ovh/compact-ga-progress.mjs
// No captured auth-runtime source or production data is included in this test.
function ppCompactGaDuplicateOperations(plan){
 if(!plan||typeof plan!=="object"||Array.isArray(plan))return plan;
 const ops=plan.operations,duplicate=plan.generic_operations;
 if(!Array.isArray(ops)||!Array.isArray(duplicate)||ops.length!==duplicate.length||!ops.length)return plan;
 // Strict content equality. Differing generic rows (setup/material semantics)
 // are never removed. This preserves every field needed by each Gantt mode.
 if(JSON.stringify(ops)!==JSON.stringify(duplicate))return plan;
 const result={...plan};
 delete result.generic_operations;
 return result;
}
async function ppCompactGaProgressResponse(req,res){
 if(req.method!=="GET"||new URL(req.url).pathname!=="/api/plan-progress"||res.status!==200)return res;
 try{
  const data=await res.clone().json();
  if(!data||data.ok!==true||data.running!==true)return res;
  const best=ppCompactGaDuplicateOperations(data.best_preview);
  const candidate=ppCompactGaDuplicateOperations(data.candidate_preview);
  if(best===data.best_preview&&candidate===data.candidate_preview)return res;
  const compact={...data,best_preview:best,candidate_preview:candidate};
  const headers=new Headers(res.headers);
  for(const name of ["content-length","content-encoding","transfer-encoding"])headers.delete(name);
  headers.set("content-type","application/json; charset=utf-8");
  headers.set("cache-control","no-store");
  headers.set("x-liftorbit-progress-payload","lossless-dedup");
  return new Response(JSON.stringify(compact),{status:res.status,headers});
 }catch(_){return res}
}
const compact = plan => ppCompactGaDuplicateOperations(plan);

function browser(fetch, isPlan = ppNativePresentationPlan) {
  const context = {fetch, Response, Request, Headers, URL, console,
    location: {origin: 'https://app.example.test', href: 'https://app.example.test/project'},
    __PP_INTEGRATED_NATIVE_RESULT_V1__: {isPlan}};
  context.window = context;
  vm.createContext(context);
  const install = () => vm.runInContext(nativePreviewProjectionScript(), context);
  install(); return {context, install};
}

test('the public compactor roundtrip restores exactly one alias under the original checksum', () => {
  const full = canonical(), before = JSON.stringify(full), stripped = compact(full);
  assert(!Object.hasOwn(stripped, 'generic_operations'));
  assert.equal(ppNativePresentationPlan(stripped), false);
  const result = ppRestoreNativePreviewAlias(stripped, ppNativePresentationPlan);
  assert.equal(ppNativePresentationPlan(result), true);
  assert.equal(ppNativeScheduleFingerprint(result), full._pp_native_schedule_v1.signature);
  assert.equal(result._pp_native_schedule_v1, full._pp_native_schedule_v1);
  assert.equal(result.generic_operations, stripped.operations);
  assert.deepEqual(result, full);
  assert.equal(JSON.stringify(full), before);
  assert.equal(ppRestoreNativePreviewAlias(result, ppNativePresentationPlan), result);
  assert.deepEqual(Object.keys(result).filter(key => !Object.hasOwn(stripped, key)), ['generic_operations']);
});

test('partial, altered and explicit conflicting aliases never gain a valid presentation', () => {
  const stripped = compact(canonical());
  const rows = clone(stripped.operations); rows[0].start_min++;
  for (const plan of [null, [], {...stripped, partial: true}, {...stripped, valid: false},
    {...stripped, ok: false}, {...stripped, duration_minutes: 35}, {...stripped, operations: rows},
    {...stripped, setup_duration_total_minutes: 10}, {...stripped, _pp_native_schedule_v1: undefined},
    {...stripped, _pp_native_schedule_v1: {...stripped._pp_native_schedule_v1, signature: '0'.repeat(16)}},
    {...stripped, generic_operations: null}, {...stripped, generic_operations: []},
    {...stripped, generic_operations: rows}, {...stripped, generic_operations: undefined}])
    assert.equal(ppRestoreNativePreviewAlias(plan, ppNativePresentationPlan), plan);
  assert.equal(ppRestoreNativePreviewAlias(stripped, undefined), stripped);
  assert.equal(ppRestoreNativePreviewAlias(stripped, () => {throw Error('unavailable');}), stripped);
});

test('running envelope repairs best and candidate independently without publishing private state', () => {
  const full = canonical(), stopped = {...full}; delete stopped.resume_state;
  const data = {ok: true, running: true, job_id: JOB, percent: 50, result: null,
    best_preview: compact(full), candidate_preview: compact(stopped), extra: {same: true}};
  const before = JSON.stringify(data), result = ppRestoreNativePreviewEnvelope(data, ppNativePresentationPlan);
  assert.deepEqual(Object.keys(result), Object.keys(data));
  assert.equal(result.job_id, JOB); assert.equal(result.extra, data.extra); assert.equal(result.result, null);
  assert(ppNativePresentationPlan(result.best_preview)); assert(ppNativePresentationPlan(result.candidate_preview));
  assert.equal(Object.hasOwn(result.candidate_preview, 'resume_state'), false);
  assert.equal(result.best_preview.resume_state, full.resume_state);
  assert.equal(JSON.stringify(data), before);
  for (const value of [{...data, running: false}, {...data, ok: false},
    {...data, best_preview: full, candidate_preview: null}, null, []])
    assert.equal(ppRestoreNativePreviewEnvelope(value, ppNativePresentationPlan), value);
});

test('outer fetch repair preserves the exact scoped forced-GET request and application headers', async () => {
  const data = {ok: true, running: true, job_id: JOB, best_preview: compact(canonical()), candidate_preview: null,
    done: 1, total: 3, percent: 33};
  let seen, calls = 0;
  const response = new Response(JSON.stringify(data), {status: 200, statusText: 'Synthetic OK', headers: {
    'content-type': 'application/json', 'cache-control': 'no-store', 'x-auth-boundary': 'preserved',
    'content-length': '1', 'content-encoding': 'gzip', 'transfer-encoding': 'chunked'}});
  const b = browser(async function (...args) {calls++; seen = {receiver: this, args}; return response;});
  const input = new Request('https://app.example.test/api/plan-progress?ppProgressCache=off&ppStopConfirm=1&job_id=' + JOB,
    {headers: {'x-preserved': 'yes'}}), init = {credentials: 'same-origin', cache: 'no-store'}, receiver = {};
  const result = await b.context.fetch.call(receiver, input, init);
  assert.equal(calls, 1); assert.equal(seen.receiver, receiver);
  assert.equal(seen.args[0], input); assert.equal(seen.args[1], init);
  assert.equal(input.url.endsWith('&job_id=' + JOB), true);
  assert.equal(result.status, response.status); assert.equal(result.statusText, response.statusText);
  assert.equal(result.headers.get('x-auth-boundary'), 'preserved');
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.headers.get('content-type'), 'application/json');
  for (const key of ['content-length', 'content-encoding', 'transfer-encoding']) assert.equal(result.headers.has(key), false);
  const repaired = await result.json(); assert.equal(repaired.job_id, JOB);
  assert(ppNativePresentationPlan(repaired.best_preview));
  assert.equal(response.bodyUsed, false); assert.equal((await response.json()).best_preview.generic_operations, undefined);
  const installedFetch = b.context.fetch, installed = b.context.__PP_NATIVE_PREVIEW_PROJECTION_V1__;
  b.install(); assert.equal(b.context.fetch, installedFetch); assert.equal(b.context.__PP_NATIVE_PREVIEW_PROJECTION_V1__, installed);
});

test('other origins, routes, methods, failed ownership and terminal replies are returned unchanged', async () => {
  const body = {ok: true, running: true, best_preview: compact(canonical()), job_id: JOB};
  const requests = [
    ['/api/plan-progress', {method: 'POST'}], ['/api/optimizer-stop?job_id=' + JOB, {method: 'POST'}],
    ['/api/model'], ['/api/plan'], ['https://other.example.test/api/plan-progress'],
    [new Request('https://app.example.test/api/plan-progress', {method: 'POST'})],
    ['/api/plan-progress/'], ['/api/plan-progress', {}, 401], ['/api/plan-progress', {}, 409],
    ['/api/plan-progress', {}, 200, {...body, running: false, success: true, result: canonical()}]
  ];
  for (const [input, init, status = 200, data = body] of requests) {
    const response = Response.json(data, {status}); let calls = 0;
    const b = browser(async () => {calls++; return response;});
    assert.equal(await b.context.fetch(input, init), response);
    assert.equal(response.bodyUsed, false); assert.equal(calls, 1);
  }
  const redirected = Response.json(body);
  Object.defineProperty(redirected, 'url', {value: 'https://other.example.test/api/plan-progress'});
  assert.equal(await browser(async () => redirected).context.fetch('/api/plan-progress'), redirected);
});

test('a GET init override remains eligible and malformed or unverified responses remain readable', async () => {
  const request = new Request('https://app.example.test/api/plan-progress', {method: 'POST'});
  const response = Response.json({ok: true, running: true, best_preview: compact(canonical())});
  const result = await browser(async () => response).context.fetch(request, {method: 'GET'});
  assert(ppNativePresentationPlan((await result.json()).best_preview));
  for (const response of [new Response('not JSON'), Response.json({ok: true, running: true,
    best_preview: {...compact(canonical()), partial: true}})]) {
    assert.equal(await browser(async () => response).context.fetch('/api/plan-progress'), response);
    assert.equal(response.bodyUsed, false);
  }
  const failure = new DOMException('Synthetic abort', 'AbortError');
  await assert.rejects(browser(async () => {throw failure;}).context.fetch('/api/plan-progress'), error => error === failure);
});

const sourceFixture = process.env.LIFTORBIT_NATIVE_PREVIEW_APP_FIXTURE_ROOT;
function source() {
  if (sourceFixture) return readFileSync(resolve(sourceFixture, 'python-ga-upstream.mjs'), 'utf8');
  let original = read('ops/ovh/ga-complete-setup-final-20261117/python-ga-upstream.mjs');
  original = original.replace('  async function fetchUpstream(req,opts){',
    read('ops/ovh/sse-stream-v1-20261120/backend-stream.js.txt') + '  async function fetchUpstream(req,opts){')
    .replace("    if(path==='/api/plan-progress'&&req.method==='GET')return progress(req);",
      "    if(path==='/api/plan-progress'&&req.method==='GET')return progress(req);\n    if(path==='/api/plan-events'&&req.method==='GET')return stream(req);");
  return patchPreview(patchCanonical(patchLifecycle(original)));
}

test('real bridge running best/candidate survive compaction; final, Stop and job ownership remain intact', async () => {
  const original = source(), fixture = {model, options: {objective: 'duration'}, final: native()};
  const h = upstreamHarness(original, fixture), before = JSON.stringify(fixture);
  let lastServer;
  const b = browser(async request => {
    const raw = await h.bridge.fetch(request);
    lastServer = await ppCompactGaProgressResponse(request, raw);
    return lastServer;
  });
  const request = h.request('/api/plan-progress?job_id=' + JOB + '&ppProgressCache=off');
  const running = await (await b.context.fetch(request)).json();
  assert.equal(running.running, true); assert.equal(running.job_id, JOB);
  for (const key of ['best_preview', 'candidate_preview']) {
    assert(ppNativePresentationPlan(running[key]), key);
    comparePlan(fixture.final, running[key], {publicProjection: true});
  }
  const compacted = await lastServer.json();
  assert.equal(compacted.best_preview.generic_operations, undefined);
  assert.equal(ppNativePresentationPlan(compacted.best_preview), false);
  const foreign = await b.context.fetch(h.request('/api/plan-progress?job_id=' + JOB, 'GET', undefined, 'two'));
  assert.equal(foreign.status, 409); assert.equal(foreign, lastServer);
  const replaced = await b.context.fetch(h.request('/api/plan-progress?job_id=' + OTHER));
  assert.equal(replaced.status, 409); assert.equal(replaced, lastServer);
  h.worker.phase = 'completed';
  const completedResponse = await b.context.fetch(request);
  assert.equal(completedResponse, lastServer);
  const completed = await completedResponse.json();
  assert.equal(completed.running, false); assert(ppNativePresentationPlan(completed.result));
  comparePlan(fixture.final, completed.result);
  const stop = upstreamHarness(original, fixture);
  await stop.bridge.fetch(stop.request('/api/plan-progress'));
  const stopped = await stop.bridge.cancel(stop.request('/api/optimizer-stop?job_id=' + JOB, 'POST', {}));
  assert.equal(stopped.ok, true); assert.equal(stopped.job_id, JOB); assert.equal(stop.worker.cancelCalls, 1);
  assert(ppNativePresentationPlan(stopped.best_preview));
  comparePlan(fixture.final, stopped.best_preview, {publicProjection: true});
  assert.equal(JSON.stringify(fixture), before);
});

function publicUi() {
  return ppNativeScheduleFingerprint.toString() + '\n' + ppNativePresentationPlan.toString() + '\n' +
    ppInstallNativePresentation.toString() + '\nwindow.fetch=function ppSseNativeProgressNoPoll(input,init){};\n' +
    resourcePresentationScript();
}
test('UI transform preserves every previous byte and the resource suffix with exact hash/reverse guards', () => {
  const original = publicUi(), hash = digest(original), addon = nativePreviewProjectionScript(), suffix = resourcePresentationScript();
  const after = patchNativePreviewProjectionUi(original, hash);
  assert.equal(after.slice(0, -addon.length - suffix.length) + suffix, original);
  assert.equal(patchNativePreviewProjectionUi(after, hash), after);
  assert(after.endsWith(suffix)); assert.equal(after.split(PREVIEW_PROJECTION_MARKER).length, 2);
  assert.throws(() => patchNativePreviewProjectionUi(original + ' ', hash), /RESOURCE_SUFFIX_DRIFT/);
  assert.throws(() => patchNativePreviewProjectionUi(original, '0'.repeat(64)), /BASELINE_DRIFT/);
  assert.throws(() => patchNativePreviewProjectionUi(after.replace('repaired === data', 'false'), hash), /INSTALLED_SOURCE_DRIFT/);
  const missing = original.replace('ppSseNativeProgressNoPoll', 'differentController');
  assert.throws(() => patchNativePreviewProjectionUi(missing, digest(missing)), /REQUIRED_SOURCE_GUARD/);
});

test('captured actual restart source accepts the same isolated addition without changing earlier source',
  {skip: !sourceFixture}, () => {
    const original = readFileSync(resolve(sourceFixture, 'restart-optimizer-ui.js'), 'utf8');
    const after = patchNativePreviewProjectionUi(original, digest(original));
    const addon = nativePreviewProjectionScript(), suffix = resourcePresentationScript();
    assert.equal(after.slice(0, -addon.length - suffix.length) + suffix, original);
    assert.equal(patchNativePreviewProjectionUi(after, digest(original)), after);
  });
