import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {ppOptimizerLifecycleHtml} from './lifecycle.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ids = ['ppAsyncPlanTransport', 'ppStopOptimizationV1', 'pp-restart-optimizer-ui'];
const fixtureDir = process.env.PP_LIFECYCLE_FIXTURE_DIR || '/tmp/liftorbit-current-ui';
const available = ids.every(id => existsSync(join(fixtureDir, id + '.js')));
if (process.env.PP_LIFECYCLE_REQUIRE_FIXTURES === '1') assert(available, 'actual native script fixtures required');
const original = available ? Object.fromEntries(ids.map(id => [id, readFileSync(join(fixtureDir, id + '.js'), 'utf8')])) : null;
const html = available ? '<!doctype html><body>' + ids.map(id => '<script id="' + id + '">' + original[id] + '</script>').join('\n') + '</body>' : null;
const transformed = available ? ppOptimizerLifecycleHtml(html) : null;
const scriptOf = (page, id) => [...page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
  .find(match => match[1].includes('id="' + id + '"'))?.[2];
const moduleOf = (source, name) => {
  const start = source.indexOf(';(function ' + name + '(){');
  const end = source.indexOf('\n})();', start);
  assert(start >= 0 && end > start, 'actual module ' + name);
  return source.slice(start, end + 6);
};
const quietTransform = vm.runInNewContext('(' + ppOptimizerLifecycleHtml.toString() + ')', {console: {warn() {}}});

test('serialized HTML helper is self-contained and fails closed without expected scripts', () => {
  for (const input of [null, '', '<html><body>unchanged</body></html>', '<script id="ppAsyncPlanTransport">partial</script>'])
    assert.equal(quietTransform(input), input);
});

test('auth patch preserves handler bytes and existing trailing import helper, including repeated runs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pp-lifecycle-patch-'));
  try {
    const tail = '\nfunction ppProjectTextImportHtml(html){\n return html;\n}\n';
    const before = 'function handle(enhanced){return new Response(ppGanttZoom500Html(ppNonBlockingDbSyncHtml(enhanced)),{headers:{"x-liftorbit-ui":"etalon-modules-compat"}})}\n' + tail;
    const a = join(dir, 'before.js'), b = join(dir, 'after.js'), c = join(dir, 'repeat.js');
    writeFileSync(a, before);
    const run = (x, y) => {
      const result = spawnSync(process.execPath, [join(here, 'patch.mjs'), x, y], {encoding: 'utf8'});
      assert.equal(result.status, 0, result.stderr);
    };
    run(a, b); run(b, c);
    const patched = readFileSync(b, 'utf8');
    assert.equal(readFileSync(c, 'utf8'), patched);
    assert(patched.endsWith(tail));
    const helper = '\n' + ppOptimizerLifecycleHtml.toString() + '\n';
    assert.equal(patched.replace(helper, '').replace('ppOptimizerLifecycleHtml(ppNonBlockingDbSyncHtml(enhanced))', 'ppNonBlockingDbSyncHtml(enhanced)'), before);
    new vm.Script(patched);
    const upgradeStart = helper.indexOf("    stopSource = one(stopSource,\n      ' if(note&&/optimization_stopped");
    const upgradeEnd = helper.indexOf("    stopSource = one(stopSource, ' const my=++generation;", upgradeStart);
    assert(upgradeStart >= 0 && upgradeEnd > upgradeStart);
    const previousHelper = helper.slice(0, upgradeStart) + helper.slice(upgradeEnd);
    const installed = join(dir, 'installed.js'), upgraded = join(dir, 'upgraded.js');
    writeFileSync(installed, patched.replace(helper, previousHelper));
    run(installed, upgraded);
    assert.equal(readFileSync(upgraded, 'utf8'), patched, 'known deployed helper upgrades without changing other source');
    writeFileSync(installed, patched.replace(helper, previousHelper.replace('PP_OPTIMIZER_LIFECYCLE_SOURCE_DRIFT', 'PP_OPTIMIZER_LIFECYCLE_SOURCE_CHANGED')));
    const rejected = spawnSync(process.execPath, [join(here, 'patch.mjs'), installed, join(dir, 'rejected.js')], {encoding: 'utf8'});
    assert.notEqual(rejected.status, 0, 'an unknown installed helper must fail closed');
    assert(!existsSync(join(dir, 'rejected.js')));
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('actual three modules transform atomically and retain quality-floor and other Gantt code', {skip: !available}, () => {
  assert.notEqual(transformed, html);
  assert.equal(ppOptimizerLifecycleHtml(transformed), transformed);
  for (const id of ids) new vm.Script(scriptOf(transformed, id));
  const before = original['pp-restart-optimizer-ui'];
  const after = scriptOf(transformed, 'pp-restart-optimizer-ui');
  const prefix = before.slice(0, before.indexOf(';(function ppOneSseProgressAndGantt(){'));
  assert(after.endsWith(before.slice(before.indexOf(';(function ppHideObsoleteGanttOptimizationWidgetsV1(){'))));
  assert(after.includes(prefix));
  for (const id of ids) {
    const drift = html.replace('id="' + id + '"', 'id="unexpected-' + id + '"');
    assert.equal(quietTransform(drift), drift);
  }
  const drift = html.replace('let activePlanPromise=null;', 'let activePlanPromise=undefined;');
  assert.equal(quietTransform(drift), drift, 'no partial Stop/SSE rewrite on transport drift');
});

let JSDOM;
if (available) {
  const require = createRequire(process.env.PP_LIFECYCLE_JSDOM_PACKAGE || '/tmp/liftorbit-text-import-test/package.json');
  ({JSDOM} = require('jsdom'));
}
const flush = async () => { for (let i = 0; i < 35; i++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
async function harness(options = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="planView"><div class="tabs"><div class="a">Equipment Gantt</div></div><button id="opt">Continue optimization</button><div id="valid"></div><div id="validator"></div><div id="meta"></div><div id="ppGanttToolV2"></div></div></body></html>', {
    url: 'https://app.liftorbit.app/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window, connections = [], requests = [], logs = [], timers = new Map(), observers = [];
  let clock = 0, nextTimer = 0, posts = 0;
  const previous = {ok: true, valid: true, duration_minutes: 10, batch_count: 1,
    operator_wait_minutes: 0, machine_idle_minutes: 0, operations: [{order: 'A', operation_id: 'A', equipment_ids: ['E'], start_min: 0, end_min: 10}]};
  const result = {...previous, duration_minutes: 8, operations: [{...previous.operations[0], end_min: 8}]};
  const server = {phase: options.recovered ? 'running' : 'idle', jobId: options.recovered ? 'a'.repeat(32) : null, result, stopMode: 'cancel', hook: null};
  const status = () => ({ok: true, job_id: server.jobId,
    running: ['queued', 'running'].includes(server.phase), success: server.phase === 'completed', phase: server.phase,
    percent: server.phase === 'completed' ? 100 : 1,
    stopped: server.phase === 'cancelled', error: server.phase === 'cancelled' ? 'optimization_stopped' : null,
    result: server.phase === 'completed' ? server.result : null, best_preview: server.phase === 'idle' ? null : server.result,
    candidate_preview: null});
  Object.assign(w, {Request, Response, Headers, AbortSignal, AbortController});
  const NativeObserver = w.MutationObserver;
  w.MutationObserver = class extends NativeObserver {
    constructor(callback) { super(callback); observers.push(this); }
  };
  w.console = {warn: (...args) => logs.push(args), error: (...args) => logs.push(args), info() {}, log() {}};
  w.setTimeout = (fn, ms = 0) => { const id = ++nextTimer; timers.set(id, {at: clock + ms, fn}); return id; };
  w.clearTimeout = id => timers.delete(id);
  w.requestAnimationFrame = fn => w.setTimeout(() => fn(clock), 16);
  w.cancelAnimationFrame = w.clearTimeout;
  w.__PP_UNIFIED_GANTT_V2__ = {activeMode: 0};
  const baseline = options.fresh ? null : previous;
  w.__ppOptimizerCommittedPlan = baseline; w.__ppTabPlan = baseline; w.__ppGenericPlan = baseline;
  w.rendered = []; w.kpis = [];
  w.renderPlan = plan => { w.rendered.push(plan); w.shown = plan; };
  w.renderKpisWithDelta = plan => w.kpis.push(plan.duration_minutes);
  w.eval('var hasResult=' + !options.fresh + '; var model={objective:"duration",orders:[{id:"A"}],equipment:[{id:"E"}]};');
  w.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, w.location.href);
    const request = {path: url.pathname, query: Object.fromEntries(url.searchParams), method: init?.method || 'GET', init};
    requests.push(request);
    if (server.hook) { const custom = await server.hook(request); if (custom) return custom; }
    const expected = url.searchParams.get('job_id');
    if (expected && expected !== server.jobId) return Response.json({ok: false, error: 'job_mismatch'}, {status: 409});
    if (url.pathname === '/api/plan-progress') return Response.json(status());
    if (url.pathname === '/api/plan') {
      posts++; server.jobId = String(posts).padStart(32, '0');
      server.phase = options.fast ? 'completed' : 'running';
      return Response.json({ok: true, started: true, job_id: server.jobId}, {status: 202});
    }
    if (url.pathname === '/api/optimizer-stop') {
      if (server.stopMode === 'completed') server.phase = 'completed';
      if (server.phase === 'completed') return Response.json({ok: false, error: 'optimization_not_running', job_id: server.jobId}, {status: 409});
      server.phase = 'cancelled';
      return Response.json({ok: true, stopped: true, job_id: server.jobId, best_preview: server.result, variants: []});
    }
    throw Error('unexpected request ' + url.pathname);
  };
  w.EventSource = class {
    constructor(url) {
      this.url = url; this.readyState = 1; this.handlers = new Map(); connections.push(this);
      Promise.resolve().then(() => {
        if (this.readyState === 2) return;
        this.emit('open');
        this.emit('progress', {job_id: server.jobId, percent: 1, phase: server.phase, seq: 1});
        if (server.phase === 'completed') this.emit('complete', {job_id: server.jobId, percent: 100, verified: true});
      });
    }
    addEventListener(type, fn) { if (!this.handlers.has(type)) this.handlers.set(type, []); this.handlers.get(type).push(fn); }
    close() { this.readyState = 2; }
    emit(type, data, force = false) {
      if (this.readyState === 2 && !force) return;
      for (const fn of this.handlers.get(type) || []) fn({data: JSON.stringify(data)});
    }
  };
  const button = w.document.getElementById('opt');
  button.onclick = async function () {
    w.__ppOptimizationInFlight = true; button.disabled = true; button.classList.add('pp-opt-running');
    try {
      const response = await w.fetch('/api/plan', {method: 'POST', body: '{}'});
      const plan = await response.json();
      if (response.ok && plan.ok && plan.operations?.length) {
        w.__ppOptimizerCommittedPlan = plan; w.__ppTabPlan = plan; w.__ppGenericPlan = plan;
        w.renderPlan(plan); w.renderKpisWithDelta(plan);
      }
    } catch (error) {
      w.document.getElementById('validator').textContent = error.message;
      if (error.name !== 'AbortError') logs.push([error]);
    }
    finally { w.__ppOptimizationInFlight = false; button.disabled = false; button.classList.remove('pp-opt-running'); }
  };
  w.eval(scriptOf(transformed, 'ppAsyncPlanTransport'));
  w.eval(scriptOf(transformed, 'ppStopOptimizationV1'));
  w.eval(moduleOf(scriptOf(transformed, 'pp-restart-optimizer-ui'), 'ppStopRestorePreviousPlanV1'));
  w.eval(moduleOf(scriptOf(transformed, 'pp-restart-optimizer-ui'), 'ppOneSseProgressAndGantt'));
  const advance = async ms => {
    const target = clock + ms;
    let count = 0;
    for (;;) {
      await flush();
      const next = [...timers].filter(([, item]) => item.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      assert(++count < 1500, 'bounded timer work');
      clock = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    clock = target; await flush();
  };
  await advance(90);
  return {w, server, previous, result, connections, requests, logs, advance, get posts() { return posts; },
    async start() { const promise = button.onclick(); await flush(); return {promise}; },
    async stop() { const promise = w.document.getElementById('ppStopOptimizer').onclick(); await flush(); return {promise}; },
    async complete() {
      server.phase = 'completed';
      connections.at(-1).emit('complete', {job_id: server.jobId, verified: true, percent: 100});
      await flush();
    },
    close() { w.__PP_SSE_PROGRESS_V1__?.dispose(); for (const observer of observers) observer.disconnect(); dom.window.close(); }
  };
}

test('fast completed job binds its actual ID and reaches 100 without a simulated running tail', {skip: !available}, async () => {
  const h = await harness({fast: true});
  try {
    const {promise} = await h.start(); await promise; await flush();
    assert.equal(h.connections.length, 1);
    assert.equal(h.connections[0].url, '/api/plan-events?job_id=' + h.server.jobId);
    const state = h.w.__PP_SSE_PROGRESS_V1__.state;
    assert.equal(state.completed, true); assert.equal(state.active, false); assert.equal(state.percent, 100);
    assert.equal((await (await h.w.fetch('/api/plan-progress')).json()).running, false);
    assert.equal(h.w.shown.duration_minutes, 8);
    assert.equal(h.w.document.getElementById('ppStopOptimizer').classList.contains('pp-on'), false);
  } finally { h.close(); }
});

test('live cancellation uses the bound job and restores the pre-run plan through native chooser', {skip: !available}, async () => {
  const h = await harness();
  try {
    const run = await h.start(); const stopping = await h.stop(); await stopping.promise;
    await h.advance(80); await run.promise;
    const request = h.requests.find(item => item.path === '/api/optimizer-stop');
    assert.equal(request.query.job_id, h.server.jobId);
    assert.equal(h.server.phase, 'cancelled');
    assert.equal(h.w.__ppOptimizerCommittedPlan, h.previous);
    assert.equal(h.w.shown, h.previous);
    assert.equal(h.w.__PP_STOP_DEBUG__().running, false);
    assert.equal(h.w.__PP_SSE_PROGRESS_V1__.state.active, false);
    assert(!h.logs.some(row => row[0] === 'PP_STOP_NOT_READY'));
  } finally { h.close(); }
});

test('Stop accepts completion only for the captured job and restores the pre-run plan', {skip: !available}, async () => {
  const h = await harness();
  try {
    const run = await h.start(); h.server.stopMode = 'completed';
    const stopping = await h.stop(); await stopping.promise; await h.advance(80); await run.promise;
    const confirmation = h.requests.find(item => item.query.ppStopConfirm);
    assert.equal(confirmation.query.job_id, h.server.jobId);
    assert.equal(h.w.shown, h.previous);
    assert.equal(h.w.__ppOptimizerCommittedPlan, h.previous);
    assert(!h.logs.some(row => row[0] === 'PP_STOP_NOT_READY'));
  } finally { h.close(); }
});

test('a mismatched terminal response cannot confirm cancellation of this job', {skip: !available}, async () => {
  const h = await harness();
  try {
    await h.start();
    h.server.hook = async request => {
      if (request.path === '/api/optimizer-stop') return Response.json({ok: false, error: 'optimization_not_running'}, {status: 409});
      if (request.query.ppStopConfirm) return Response.json({ok: true, running: false, success: true, phase: 'completed', job_id: 'f'.repeat(32), result: h.result});
    };
    const stopping = await h.stop(); await stopping.promise;
    assert.equal(h.w.__PP_STOP_DEBUG__().running, true);
    assert.equal(h.w.__PP_STOP_DEBUG__().stopped, false);
    assert(h.logs.some(row => row[0] === 'PP_STOP_NOT_READY'));
  } finally { h.close(); }
});

test('wrong-job events and duplicates do not finish or repaint the active run', {skip: !available}, async () => {
  const h = await harness();
  try {
    await h.start(); const connection = h.connections[0], id = h.server.jobId;
    const initialGets = h.requests.length;
    connection.emit('complete', {job_id: 'f'.repeat(32), verified: true});
    connection.emit('stopped', {job_id: 'f'.repeat(32), phase: 'cancelled'});
    connection.emit('progress', {job_id: 'f'.repeat(32), percent: 99, seq: 900});
    await flush(); assert.equal(h.requests.length, initialGets); assert.equal(h.w.__PP_SSE_PROGRESS_V1__.state.active, true);
    const priorEvents = h.w.__PP_SSE_PROGRESS_V1__.state.events;
    for (let i = 0; i < 2; i++) connection.emit('progress', {job_id: id, percent: 10, phase: 'running', seq: 5});
    assert.equal(h.w.__PP_SSE_PROGRESS_V1__.state.events, priorEvents + 1);
    const plan = {...h.result, partial: true, _pp_preview_limited: true, _pp_preview_kpis: h.result};
    connection.emit('preview', {job_id: id, plan}); connection.emit('preview', {job_id: id, plan});
    await h.advance(16); assert.equal(h.w.__PP_SSE_PROGRESS_V1__.state.previews, 1);
    await h.complete(); const terminalReads = h.requests.length;
    connection.emit('complete', {job_id: id, verified: true}, true);
    await flush(); assert.equal(h.requests.length, terminalReads);
  } finally { h.close(); }
});

test('a next fresh start owns a new promise even while an aborted old progress response is late', {skip: !available}, async () => {
  const h = await harness();
  try {
    const first = await h.start(), firstId = h.server.jobId, late = deferred();
    h.server.hook = async request => {
      if (request.path === '/api/plan-progress' && request.query.job_id === firstId && !request.query.ppStopConfirm && !request.query.ppNoCache) return late.promise;
    };
    await h.advance(3010);
    const stopping = await h.stop(); await stopping.promise; await h.advance(80);
    const second = await h.start(); assert.equal(h.posts, 2); assert.notEqual(h.server.jobId, firstId);
    late.resolve(Response.json({ok: true, job_id: firstId, running: false, success: false, stopped: true}));
    await first.promise; await flush();
    assert.equal(h.w.__PP_SSE_PROGRESS_V1__.state.jobId, h.server.jobId);
    assert.equal(h.w.__PP_STOP_DEBUG__().running, true);
    await h.complete(); await second.promise;
    assert.equal(h.w.shown.duration_minutes, 8);
  } finally { h.close(); }
});

test('transport recognizes the stopped:true terminal form without depending on phase aliases', {skip: !available}, async () => {
  const h = await harness();
  try {
    const run = await h.start();
    h.server.hook = async request => {
      if (request.path === '/api/plan-progress' && request.query.job_id && !request.query.ppNoCache)
        return Response.json({ok: true, job_id: h.server.jobId, running: false, success: false, stopped: true});
    };
    h.w.__PP_SSE_PROGRESS_V1__.stop();
    await h.advance(3010); await run.promise;
    assert.equal(h.w.__PP_STOP_DEBUG__().running, false);
    assert.equal(h.w.__ppOptimizerCommittedPlan, h.previous);
  } finally { h.close(); }
});

test('stale closed connections cannot affect the next run', {skip: !available}, async () => {
  const h = await harness();
  try {
    const first = await h.start(); const oldConnection = h.connections[0], oldId = h.server.jobId;
    await h.complete(); await first.promise;
    const second = await h.start(); const nextId = h.server.jobId;
    oldConnection.emit('stopped', {job_id: oldId}, true);
    oldConnection.emit('complete', {job_id: oldId, verified: true}, true);
    oldConnection.emit('progress', {job_id: oldId, percent: 99, seq: 1000}, true);
    await flush();
    assert.equal(h.w.__PP_SSE_PROGRESS_V1__.state.jobId, nextId);
    assert.equal(h.w.__PP_SSE_PROGRESS_V1__.state.active, true);
    assert.equal(h.connections.at(-1).url, '/api/plan-events?job_id=' + nextId);
    await h.complete(); await second.promise;
  } finally { h.close(); }
});

test('an already running job recovered after reload binds its ID and finishes without a presentation delay', {skip: !available}, async () => {
  const h = await harness({recovered: true});
  try {
    assert.equal(h.posts, 0, 'recovery does not create a new job');
    assert.equal(h.connections[0].url, '/api/plan-events?job_id=' + h.server.jobId);
    assert.equal(h.w.__PP_STOP_DEBUG__().recoveredSession, true);
    await h.complete(); await flush();
    assert.equal(h.w.__PP_STOP_DEBUG__().running, false);
    assert.equal(h.w.shown.duration_minutes, 8);
    assert.equal(h.w.__PP_SSE_PROGRESS_V1__.state.percent, 100);
  } finally { h.close(); }
});

test('Stop queued before the POST acknowledgement cancels the exact acknowledged job', {skip: !available}, async () => {
  const h = await harness();
  try {
    const acknowledgement = deferred();
    h.server.hook = async request => {
      if (request.path === '/api/plan') {
        h.server.jobId = 'b'.repeat(32); h.server.phase = 'running';
        await acknowledgement.promise;
        return Response.json({ok: true, started: true, job_id: h.server.jobId}, {status: 202});
      }
    };
    const run = await h.start();
    assert.equal(h.connections.length, 0, 'no unbound SSE stream');
    const stopping = await h.stop();
    assert.equal(h.w.document.getElementById('ppStopOptimizer').disabled, true);
    acknowledgement.resolve(); await flush(); await stopping.promise; await h.advance(80); await run.promise;
    assert.equal(h.server.phase, 'cancelled');
    assert.equal(h.requests.find(item => item.path === '/api/optimizer-stop').query.job_id, 'b'.repeat(32));
    assert.equal(h.w.__ppOptimizerCommittedPlan, h.previous);
  } finally { h.close(); }
});

test('verified completion arriving during Stop cannot accept or persist the candidate before cancellation resolves', {skip: !available}, async () => {
  const h = await harness();
  try {
    const stopped = deferred();
    h.server.hook = async request => request.path === '/api/optimizer-stop' ? stopped.promise : null;
    const run = await h.start(), stopping = await h.stop();
    await h.complete(); await flush();
    assert.equal(h.w.__ppOptimizerCommittedPlan, h.previous, 'Stop intent holds native result acceptance');
    assert(!h.w.rendered.some(plan => plan.duration_minutes === 8));
    stopped.resolve(Response.json({ok: false, error: 'optimization_not_running', job_id: h.server.jobId}, {status: 409}));
    await stopping.promise; await h.advance(80); await run.promise;
    assert.equal(h.w.shown, h.previous);
    assert.equal(h.w.__ppOptimizerCommittedPlan, h.previous);
  } finally { h.close(); }
});

test('immediate fresh starts after completion or cancellation bypass the stale account progress cache', {skip: !available}, async () => {
  const h = await harness();
  try {
    assert.equal(h.requests.find(request => request.query.ppReconnect)?.query.ppProgressCache, 'off');
    const first = await h.start(); await h.complete(); await first.promise;
    let cachedId = h.server.jobId, staleReads = 0;
    h.server.hook = async request => {
      if (request.path === '/api/plan-progress' && !request.query.job_id && request.query.ppProgressCache !== 'off') {
        staleReads++;
        return Response.json({ok: true, running: true, success: false, phase: 'running', job_id: cachedId});
      }
    };
    const second = await h.start();
    assert.equal(h.posts, 2, 'completed old job must not be rejoined from cache');
    const stopping = await h.stop(); await stopping.promise; await h.advance(80); await second.promise;
    cachedId = h.server.jobId;
    const third = await h.start();
    assert.equal(h.posts, 3, 'cancelled old job must not be rejoined from cache');
    assert.equal(staleReads, 0);
    await h.complete(); await third.promise;
  } finally { h.close(); }
});

test('a replaced-job 409 releases its SSE run and late old terminal cleanup cannot reset the next run', {skip: !available}, async () => {
  const h = await harness();
  try {
    const ended = [];
    h.w.addEventListener('pp:ga-transport-ended', event => ended.push({...event.detail}));
    const first = await h.start(), firstId = h.server.jobId;
    const firstEpoch = h.w.__PP_SSE_PROGRESS_V1__.state.runEpoch;
    h.server.jobId = 'f'.repeat(32); h.server.phase = 'completed';
    const priorFetch = h.w.fetch;
    h.w.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, h.w.location.href);
      if (url.pathname === '/api/plan-progress' && url.searchParams.get('job_id') === firstId)
        return Promise.resolve(Response.json({ok: false, error: 'job_mismatch'}, {status: 409}));
      return priorFetch(input, init);
    };
    await h.advance(3010); await first.promise;
    assert.deepEqual(ended, [{job_id: firstId, run_epoch: firstEpoch}]);
    assert.equal(h.connections[0].readyState, 2);
    assert.equal(h.w.__PP_SSE_PROGRESS_V1__.state.active, false);

    const second = await h.start(), nextId = h.server.jobId;
    const nextEpoch = h.w.__PP_SSE_PROGRESS_V1__.state.runEpoch;
    assert.equal(h.posts, 2);
    assert.notEqual(nextEpoch, firstEpoch);
    assert.equal(h.connections.at(-1).url, '/api/plan-events?job_id=' + nextId);
    h.w.dispatchEvent(new h.w.CustomEvent('pp:ga-transport-ended', {detail: ended[0]}));
    h.w.dispatchEvent(new h.w.CustomEvent('pp:ga-transport-ended', {detail: {job_id: nextId, run_epoch: firstEpoch}}));
    assert.equal(h.w.__PP_SSE_PROGRESS_V1__.state.active, true);
    assert.equal(h.w.__PP_SSE_PROGRESS_V1__.state.jobId, nextId);
    assert.equal(h.connections.at(-1).readyState, 1);

    await h.complete(); await second.promise;
    h.w.dispatchEvent(new h.w.CustomEvent('pp:ga-transport-ended', {detail: {job_id: nextId, run_epoch: nextEpoch}}));
    assert.equal(h.w.__PP_SSE_PROGRESS_V1__.state.completed, true);
    assert.equal(h.w.__PP_SSE_PROGRESS_V1__.state.percent, 100);
  } finally { h.close(); }
});

test('confirmed Stop normalizes the native abort message without changing fresh reset or previous-plan restoration', {skip: !available}, async () => {
  for (const fresh of [true, false]) {
    const h = await harness({fresh});
    try {
      const run = await h.start(); h.server.stopMode = 'completed';
      const stopping = await h.stop(); await stopping.promise; await h.advance(80); await run.promise;
      assert.equal(h.w.document.getElementById('validator').textContent, 'Optimization stopped.');
      assert.equal(h.w.__PP_STOP_DEBUG__().stopped, true);
      assert.equal(h.w.__PP_STOP_DEBUG__().running, false);
      assert.equal(h.w.__ppOptimizerCommittedPlan, fresh ? null : h.previous);
      if (fresh) assert.equal(h.w.rendered.length, 0, 'fresh reset stays empty after Stop');
      else assert.equal(h.w.shown, h.previous);
      assert(!h.w.rendered.some(plan => plan.duration_minutes === 8));
    } finally { h.close(); }
  }
});

test('an abort without a confirmed user Stop retains the native error', {skip: !available}, async () => {
  const h = await harness();
  try {
    const run = await h.start();
    h.w.__ppCurrentOptimizationAbort.abort('unconfirmed_abort');
    await run.promise; await h.advance(80);
    assert.equal(h.w.__PP_STOP_DEBUG__().stopped, false);
    assert.equal(h.w.document.getElementById('validator').textContent, 'The operation was aborted.');
  } finally { h.close(); }
});
