import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';
import {ppIsRetiredPreviewProgressRead, patchNativePreviewPresentationUi, nativePreviewProgressWrapper,
  ORIGINAL_PROGRESS_WRAPPER, BASELINE_UI_SHA, NATIVE_PREVIEW_MARKER} from './presentation.mjs';

const digest = text => createHash('sha256').update(text).digest('hex');
const origin = 'https://planner.example';
const job = '1'.repeat(32);
const immutableBest = Object.freeze({valid: true, duration_minutes: 9830, machine_idle_minutes: 107755,
  operator_wait_minutes: 417021, batch_count: 118, operations: Object.freeze([{order: 'synthetic-order'}])});
const immutableCandidate = Object.freeze({...immutableBest, duration_minutes: 12780, machine_idle_minutes: 149055});

function environment(patched = true, initial = {}) {
  const state = {active: true, completed: false, disposed: false, jobId: job, percent: 50, fullData: null,
    networkFinalGets: 4, previews: 6, kpiUpdates: 6, ...initial};
  const calls = [], paints = [], timeouts = new Map(), intervals = new Map(), listeners = new Map();
  let sequence = 0;
  let backend = {ok: true, running: true, phase: 'running', percent: 50, job_id: job,
    best_preview: immutableBest, candidate_preview: immutableCandidate};
  const classes = () => {
    const values = new Set();
    return {add: (...names) => names.forEach(name => values.add(name)),
      remove: (...names) => names.forEach(name => values.delete(name)),
      contains: name => values.has(name),
      toggle(name, force) { const set = force ?? !values.has(name); if (set) values.add(name); else values.delete(name); return set; }};
  };
  const nodes = new Map();
  function node(id = '') {
    const events = new Map();
    const el = {style: {}, classList: classes(), textContent: '', dataset: {}, disabled: false,
      children: [], attrs: new Map(), events,
      appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
      setAttribute(name, value) { this.attrs.set(name, value); },
      getAttribute(name) { return this.attrs.get(name); },
      addEventListener(name, fn) { if (!events.has(name)) events.set(name, []); events.get(name).push(fn); },
      removeEventListener() {},
      querySelector: () => null, querySelectorAll: () => [],
      contains: () => true,
      closest(selector) { return selector === '[data-mode]' && this.dataset.mode ? this : null; },
      insertAdjacentElement(_position, child) { child.parentElement = this; },
      remove() { this.removed = true; }};
    let currentId = '';
    Object.defineProperty(el, 'id', {get: () => currentId, set(value) {
      if (currentId) nodes.delete(currentId); currentId = value; if (value) nodes.set(value, el);
    }});
    el.id = id;
    return el;
  }
  const opt = node('opt'), planView = node('planView'), toolbar = node('toolbar'), preview = node('ppLivePreview');
  const bestButton = node(), candidateButton = node();
  bestButton.dataset.mode = 'best'; candidateButton.dataset.mode = 'candidate';
  candidateButton.classList.add('a');
  const buttons = [bestButton, candidateButton];
  preview.querySelectorAll = () => buttons;
  planView.querySelectorAll = selector => selector === '[data-mode]' ? buttons : [];
  planView.querySelector = selector => selector === '.toolbar' ? toolbar : null;
  planView.firstElementChild = toolbar;
  node('ppObjectiveWrap'); node('valid');
  opt.onclick = () => new Promise(() => {});
  const context = {
    URL, URLSearchParams, Request, Response, Headers, Promise, Date, Math, Number, JSON,
    AbortSignal, Event, console: {warn() {}, error() {}},
    location: {href: origin + '/', origin},
    document: {getElementById: id => nodes.get(id) || null, createElement: () => node(),
      querySelector: () => toolbar, documentElement: {lang: 'en'}},
    model: {orders: [{id: 'synthetic-order'}]},
    previousKpiMetrics: {duration: 9830},
    localStorage: {getItem: () => null},
    setTimeout(fn, ms) { const id = ++sequence; timeouts.set(id, {fn, ms}); return id; },
    clearTimeout: id => timeouts.delete(id),
    setInterval(fn, ms) { const id = ++sequence; intervals.set(id, {fn, ms}); return id; },
    clearInterval: id => intervals.delete(id),
    queueMicrotask,
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
    removeEventListener() {},
    dispatchEvent(event) { for (const fn of listeners.get(event.type) || []) fn(event); return true; },
    renderPlan: plan => paints.push({kind: 'plan', duration: plan.duration_minutes, idle: plan.machine_idle_minutes}),
    renderKpisWithDelta: plan => paints.push({kind: 'kpi', duration: plan.duration_minutes, idle: plan.machine_idle_minutes}),
    nurl(input) { try { return new URL(typeof input === 'string' ? input : input?.url, origin); } catch { return null; } },
    method: (input, init) => String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase(),
    originalFetch(input, init) { calls.push({input, init}); return Promise.resolve(Response.json(backend)); },
    virtualStatus: () => ({ok: true, running: state.active && !state.completed, success: state.completed,
      done: state.completed ? 100 : Math.min(99, state.percent), total: 100,
      percent: state.completed ? 100 : Math.min(99, state.percent),
      phase: state.completed ? 'completed' : state.active ? 'running' : 'idle',
      job_id: state.jobId, stage: state.active ? 'optimizing' : 'completed',
      best_preview: null, candidate_preview: null,
      result: state.completed ? state.fullData?.result || null : null,
      resume_state: state.completed ? state.fullData?.resume_state || null : null, error: null})
  };
  context.window = context;
  for (const name of ['active', 'completed', 'disposed', 'jobId', 'percent', 'fullData'])
    Object.defineProperty(context, name, {get: () => state[name], set: value => {state[name] = value;}});
  vm.createContext(context);
  vm.runInContext(patched ? nativePreviewProgressWrapper() : ORIGINAL_PROGRESS_WRAPPER, context);
  return {state, context, calls, paints, nodes, opt, planView, buttons, timeouts, intervals,
    setBackend(value) { backend = value; },
    fetch: (input, init) => context.fetch(input, init),
    async timeout(ms) {
      const found = [...timeouts].find(([, entry]) => entry.ms === ms);
      assert(found, 'scheduled timeout exists'); timeouts.delete(found[0]); await found[1].fn();
    },
    async interval(ms) { const found = [...intervals.values()].find(entry => entry.ms === ms); assert(found); await found.fn(); }
  };
}

test('only same-origin GET bare or single-underscore progress reads are retired', () => {
  for (const path of ['/api/plan-progress', '/api/plan-progress?', '/api/plan-progress?_=123'])
    assert.equal(ppIsRetiredPreviewProgressRead(new URL(path, origin), 'GET', origin), true);
  for (const path of ['/api/plan', '/api/plan-progress/', '/api/plan-progress?_=1&_=2',
    '/api/plan-progress?_=1&ppForce=1', '/api/plan-progress?ppForce=1',
    '/api/plan-progress?ppStopConfirm=1&job_id=' + job, '/api/plan-progress?stop_snapshot=1',
    '/api/plan-progress?ppProgressCache=off', '/api/plan-progress?job_id=' + job,
    '/api/plan-progress?ppProgressCache=off&ppReconnect=1', 'https://other.example/api/plan-progress'])
    assert.equal(ppIsRetiredPreviewProgressRead(new URL(path, origin), 'GET', origin), false, path);
  assert.equal(ppIsRetiredPreviewProgressRead(new URL('/api/plan-progress', origin), 'POST', origin), false);
  assert.equal(ppIsRetiredPreviewProgressRead(null, 'GET', origin), false);
});

test('active SSE owns retired readers before and after job binding without changing HTTP or progress facts', async () => {
  for (const jobId of [null, job]) for (const path of ['/api/plan-progress', '/api/plan-progress?_=123']) {
    const f = environment(true, {jobId, percent: 37});
    const before = JSON.stringify(f.state), expected = f.context.virtualStatus();
    const response = await f.fetch(path), data = await response.json();
    assert.equal(response.status, 200); assert.equal(response.ok, true);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(data, {...expected, ok: false, _pp_sse_owned: true});
    assert.equal(f.calls.length, 0); assert.equal(JSON.stringify(f.state), before);
    assert.equal(f.paints.length, 0);
  }
});

test('native transport, Stop, recovery, forced reads, POST and unrelated requests behave exactly as before', async () => {
  const reads = ['/api/plan-progress?ppProgressCache=off',
    '/api/plan-progress?ppProgressCache=off&job_id=' + job,
    '/api/plan-progress?ppProgressCache=off&ppReconnect=123',
    '/api/plan-progress?stop_snapshot=123',
    '/api/plan-progress?ppStopConfirm=123&ppProgressCache=off&job_id=' + job,
    '/api/plan-progress?ppForce=1',
    '/api/plan-progress?ppNoCache=1&ppProgressCache=off&job_id=' + job,
    '/api/plan-progress?_=1&_=2', '/api/plan-events?job_id=' + job,
    'https://other.example/api/plan-progress'];
  for (const jobId of [null, job]) for (const input of [...reads, new Request(origin + '/api/plan-progress?ppForce=1')]) {
    const old = environment(false, {jobId}), next = environment(true, {jobId});
    const a = await old.fetch(input), b = await next.fetch(input);
    assert.equal(b.status, a.status); assert.deepEqual(await b.json(), await a.json());
    assert.equal(next.calls.length, old.calls.length);
  }
  const old = environment(false), next = environment(true);
  const init = {method: 'POST', body: 'synthetic'};
  assert.deepEqual(await (await next.fetch('/api/plan-progress', init)).json(), await (await old.fetch('/api/plan-progress', init)).json());
  assert.equal(next.calls.length, 1); assert.equal(next.calls[0].init, init);
});

test('idle, stopped, disposed and verified-final reads preserve the original result and network behavior', async () => {
  const fullData = {ok: true, running: false, phase: 'completed', success: true, job_id: job, result: immutableBest};
  for (const state of [{active: false, jobId: null}, {active: false, completed: false},
    {disposed: true}, {active: false, completed: true, fullData}]) {
    for (const path of ['/api/plan-progress', '/api/plan-progress?_=123']) {
      const old = environment(false, state), next = environment(true, state);
      const a = await old.fetch(path), b = await next.fetch(path);
      assert.deepEqual(await b.json(), await a.json());
      assert.equal(next.calls.length, old.calls.length);
    }
  }
});

test('both public legacy consumer guards decline owned status and never repaint their cached candidate', async () => {
  const old = environment(false), next = environment(true);
  const legacyReader = async (env, path) => {
    const data = await (await env.fetch(path)).json();
    // Existing CurrentFeatures and OVH preview both require data.ok.
    if (data?.ok && data.running) env.context.renderKpisWithDelta(immutableCandidate);
  };
  old.context.renderKpisWithDelta(immutableBest); next.context.renderKpisWithDelta(immutableBest);
  for (const path of ['/api/plan-progress?_=123', '/api/plan-progress']) {
    await legacyReader(old, path); await legacyReader(next, path);
  }
  assert.equal(old.paints.at(-1).duration, 12780);
  assert.equal(next.paints.length, 1); assert.equal(next.paints[0].duration, 9830);
});

test('explicit tab, accepted-result and Stop render calls remain untouched', () => {
  const f = environment();
  const planRenderer = f.context.renderPlan, kpiRenderer = f.context.renderKpisWithDelta;
  for (const _mode of ['equipment', 'employees', 'orders', 'stop-restore', 'accepted-result']) {
    f.context.renderPlan(immutableBest); f.context.renderKpisWithDelta(immutableBest);
  }
  assert.equal(f.context.renderPlan, planRenderer); assert.equal(f.context.renderKpisWithDelta, kpiRenderer);
  assert.equal(f.paints.length, 10); assert(f.paints.every(row => row.duration === 9830 && row.idle === 107755));
});

const publicFrontend = readFileSync(new URL('../sse-stream-v1-20261120/frontend.js.txt', import.meta.url), 'utf8');
test('guarded transform changes only the public wrapper and rejects unknown, duplicated or drifted installation', () => {
  const hash = digest(publicFrontend), after = patchNativePreviewPresentationUi(publicFrontend, hash);
  assert.equal(after.replace(nativePreviewProgressWrapper(), ORIGINAL_PROGRESS_WRAPPER), publicFrontend);
  assert.equal(patchNativePreviewPresentationUi(after, hash), after);
  assert.equal(after.split(NATIVE_PREVIEW_MARKER).length, 2);
  assert.throws(() => patchNativePreviewPresentationUi(publicFrontend), /BASELINE_DRIFT/);
  for (const broken of [after + '\n', after + nativePreviewProgressWrapper(),
    after.replace('ok:false,_pp_sse_owned:true', 'ok:true,_pp_sse_owned:true'),
    publicFrontend + '\n/* ppIsRetiredPreviewProgressRead */'])
    assert.throws(() => patchNativePreviewPresentationUi(broken, hash));
});

const privateRoot = process.env.LIFTORBIT_NATIVE_PREVIEW_PRIVATE_ROOT || '/tmp/liftorbit-live-client-kpi-20261125';
const appRoot = process.env.LIFTORBIT_NATIVE_PREVIEW_APP_ROOT;
const privateFile = name => join(privateRoot, name);
const privateAvailable = ['other-9-ppCurrentFeaturesV1.js', 'live-preview.js',
  'other-1-ppAsyncPlanTransport.js', 'other-15-ppStopOptimizationV1.js'].every(name => existsSync(privateFile(name)));
if (process.env.LIFTORBIT_NATIVE_PREVIEW_PRIVATE_ROOT && !privateAvailable)
  throw Error('NATIVE_PREVIEW_PRIVATE_FIXTURE_SET_INCOMPLETE');
const appAvailable = !!appRoot;
const readPrivate = name => readFileSync(privateFile(name), 'utf8');

test('actual accepted restart UI receives exactly one reversible wrapper edit', {skip: !appAvailable}, () => {
  const before = readFileSync(join(appRoot, 'restart-optimizer-ui.js'), 'utf8');
  assert.equal(digest(before), BASELINE_UI_SHA);
  const after = patchNativePreviewPresentationUi(before);
  assert.equal(after.replace(nativePreviewProgressWrapper(), ORIGINAL_PROGRESS_WRAPPER), before);
  assert.equal(patchNativePreviewPresentationUi(after), after);
  assert(after.endsWith(before.slice(before.indexOf('\n;/* PP_NATIVE_RESOURCE_PRESENTATION_20261125 */'))));
});

test('actual browser inline source retains its full original bytes outside the owned-reader branch',
  {skip: !existsSync(privateFile('restart-optimizer-ui.js'))}, () => {
    // Inline HTML is a build result, not the pinned raw app source used by the
    // release gate. Never confuse its separate digest with the deploy baseline.
    const before = readPrivate('restart-optimizer-ui.js'), hash = digest(before);
    const after = patchNativePreviewPresentationUi(before, hash);
    assert.equal(after.replace(nativePreviewProgressWrapper(), ORIGINAL_PROGRESS_WRAPPER), before);
    assert.equal(patchNativePreviewPresentationUi(after, hash), after);
    const suffix = before.indexOf('\n;/* PP_NATIVE_RESOURCE_PRESENTATION_20261125 */');
    assert(suffix > 0); assert(after.endsWith(before.slice(suffix)));
  });

test('actual CurrentFeatures script cannot replay cached candidate over SSE best on its next poll', {skip: !privateAvailable}, async () => {
  for (const patched of [false, true]) {
    const f = environment(patched, {active: false, jobId: null});
    vm.runInContext(readPrivate('other-9-ppCurrentFeaturesV1.js'), f.context);
    void f.opt.onclick({});
    await f.timeout(20);
    assert.equal(f.context.__ppLiveCandidate.duration_minutes, 12780);
    assert.equal(f.paints.at(-1).duration, 12780);
    f.state.active = true; f.state.jobId = job;
    f.context.renderKpisWithDelta(immutableBest);
    const previousPaints = f.paints.length;
    await f.interval(2000);
    assert.equal(f.context.__ppLiveMode, 'candidate', 'do not silently rewrite legacy preference');
    assert.equal(f.paints.length, previousPaints + (patched ? 0 : 2));
    assert.equal(f.paints.at(-1).duration, patched ? 9830 : 12780);
    assert.equal(f.paints.at(-1).idle, patched ? 107755 : 149055);
  }
});

test('actual OVH preview rejoin and polls decline SSE ownership, then finish normally', {skip: !privateAvailable}, async () => {
  const f = environment(true, {jobId: null});
  vm.runInContext(readPrivate('live-preview.js'), f.context);
  await f.timeout(350);
  let bridge = f.context.__PP_OVH_LIVE_PREVIEW_BRIDGE__.getState();
  assert.equal(bridge.active, true); assert.equal(bridge.shown, 0); assert.equal(bridge.hasBest, false);
  f.state.jobId = job;
  await f.timeout(2000);
  bridge = f.context.__PP_OVH_LIVE_PREVIEW_BRIDGE__.getState();
  assert.equal(bridge.shown, 0); assert.equal(bridge.failures, 0); assert.equal(f.calls.length, 0);
  f.state.active = false; f.state.completed = true;
  f.state.fullData = {ok: true, running: false, phase: 'completed', success: true, result: immutableBest};
  await f.timeout(2000);
  assert.equal(f.context.__PP_OVH_LIVE_PREVIEW_BRIDGE__.getState().active, false);
  assert.equal(f.paints.length, 0);
});

test('actual OVH fallback still renders when SSE is inactive and Stop clears its timer', {skip: !privateAvailable}, async () => {
  const f = environment(true, {active: false, jobId: null});
  vm.runInContext(readPrivate('live-preview.js'), f.context);
  await f.timeout(350);
  assert.equal(f.context.__PP_OVH_LIVE_PREVIEW_BRIDGE__.getState().shown, 1);
  assert.equal(f.paints.at(-1).duration, 9830);
  f.context.dispatchEvent(new Event('pp:optimizer-stopped'));
  assert.equal(f.context.__PP_OVH_LIVE_PREVIEW_BRIDGE__.getState().active, false);
  assert.equal([...f.timeouts.values()].filter(row => row.ms === 2000).length, 0);
});

function between(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a && source.indexOf(start, a + 1) === -1, 'actual consumer boundary must be unique');
  return source.slice(a, b);
}

test('actual native progressOnce and Stop confirmation functions retain their original request and response contracts', {skip: !privateAvailable}, async () => {
  const transport = readPrivate('other-1-ppAsyncPlanTransport.js');
  const progressFunction = between(transport, 'async function progressOnce(signal,expectedJobId)', 'function waitForWorkerUpdate(');
  const stop = readPrivate('other-15-ppStopOptimizationV1.js');
  const confirmFunction = between(stop, 'async function ppConfirmStoppedAfterAmbiguousResponse(', 'function ppReconcileStoppedUi(');
  for (const jobId of [null, job]) {
    const f = environment(true, {jobId});
    vm.runInContext(progressFunction, f.context);
    const result = await f.context.progressOnce(undefined, job);
    assert.equal(result.r.status, 200); assert.equal(result.data.ok, true);
    assert.equal(result.data._pp_sse_owned, undefined);
    assert.equal(result.data.job_id, job);
    f.context.generation = 7; f.context.valid = value => value?.valid === true;
    f.setBackend({ok: true, running: false, phase: 'cancelled', stopped: true,
      job_id: job, best_preview: immutableBest});
    vm.runInContext(confirmFunction, f.context);
    const confirmation = await f.context.ppConfirmStoppedAfterAmbiguousResponse(job, 7);
    assert.equal(confirmation?.confirmed_by, 'same_job_terminal_status');
    assert.equal(confirmation?.best_preview.duration_minutes, 9830);
    assert(f.calls.some(call => String(call.input).includes('ppStopConfirm=')));
  }
});

test('actual authoritative account reconnect bypasses retired-reader suppression before job binding', {skip: !privateAvailable}, async () => {
  const f = environment(true, {jobId: null});
  const source = readPrivate('other-15-ppStopOptimizationV1.js');
  const recoverFunction = between(source, 'async function ppRecoverRunningGaFromAccount()', 'async function poll(my)');
  const attached = [];
  Object.assign(f.context, {reconnecting: true, running: false, remoteFailureCount: 0,
    ppAttachRecoveredJob: value => attached.push(value)});
  vm.runInContext(recoverFunction, f.context);
  await f.context.ppRecoverRunningGaFromAccount();
  assert.equal(attached.length, 1); assert.equal(attached[0].job_id, job);
  assert.equal(f.context.reconnecting, false); assert.equal(f.context.remoteFailureCount, 0);
  assert.equal(f.calls.length, 1); assert(String(f.calls[0].input).includes('ppReconnect='));
});
