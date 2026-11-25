import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';
import {ppCanonicalNativeResult, ppNativePresentationPlan, ppNativeScheduleFingerprint,
  ppInstallNativePresentation} from '../integrated-setup-result-20261125/canonical.mjs';
import {ppNativeResourcePresentation, ppInstallNativeResourcePresentation,
  patchResourcePresentationUi, resourcePresentationScript} from './resource-presentation.mjs';

function model() {
  return {start: '2026-11-25T08:00:00', orders: [{id: 'O', quantity: 10}],
    technical_processes: [{id: 'P', operations: [{id: 'CUT'}, {id: 'PACK'}]}],
    equipment: [{id: 'E1', name: 'Machine one'}, {id: 'E2', name: 'Machine two'}],
    autoclaves: [{id: 'A1'}, {id: 'A2'}], employees: [{id: 'W1', name: 'Worker one'}], setup_rules: []};
}

function plan(duration = 100) {
  const production = [
    {order: 'O', batch: 1, batch_id: 'O.1', batch_quantity: 10, operation_id: 'CUT', operation_name: 'Cut',
      equipment_ids: ['E1'], employee_ids: ['W1'], start_min: 10, end_min: 30, duration_min: 20},
    {order: 'O', batch: 1, batch_id: 'O.1', batch_quantity: 10, operation_id: 'PACK', operation_name: 'Pack',
      equipment_ids: ['E2'], employee_ids: ['W1'], start_min: 40, end_min: 50, duration_min: 10},
  ];
  const setup = {order: 'O', batch: 1, batch_id: 'O.1', operation_id: 'SETUP', operation_name: 'Setup',
    is_setup: true, equipment_ids: ['E1'], employee_ids: ['W1'], start_min: 30, end_min: 35, duration_min: 5};
  const value = ppCanonicalNativeResult({ok: true, valid: true, _revision: 1,
    start: '2026-11-25T08:00:00', finish: '2026-11-25T09:40:00',
    duration_minutes: duration, batch_count: 1, operator_wait_minutes: 0, machine_idle_minutes: 30,
    order_sequence: ['O'], operations: production, setup_operations: [setup],
    resume_state: {version: 2, pin_hash: 'synthetic', objective: 'duration', best_duration_minutes: duration,
      batch_genome: {version: 1, order_sequence: ['O'], partitions: [{order_id: 'O', sizes: [10]}]}}
  }, model(), 'synthetic-model-key');
  assert(value);
  return value;
}

test('generic presentation restores only the missing flag and preserves the same verified schedule', () => {
  const source = plan(), before = JSON.stringify(source), signature = ppNativeScheduleFingerprint(source);
  const presented = ppNativeResourcePresentation(source, model(), ppNativePresentationPlan);
  assert.notEqual(presented, source);
  assert.equal(presented.generic_schedule, true);
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(Object.keys(presented).filter(key => !Object.hasOwn(source, key)), ['generic_schedule']);
  for (const key of Object.keys(source)) assert.equal(presented[key], source[key], key);
  assert.equal(presented.batches, undefined, 'no invented batch spans or cycle assignments');
  assert.equal(ppNativeScheduleFingerprint(presented), signature);
  assert.equal(ppNativePresentationPlan(presented), true);
  assert.equal(ppNativeResourcePresentation(presented, model(), ppNativePresentationPlan), presented);
  // Public Stop projection can omit private continuation without altering the
  // presentation checksum or any schedule fact.
  const stopped = {...source}; delete stopped.resume_state;
  assert.equal(ppNativeResourcePresentation(stopped, model(), ppNativePresentationPlan)?.generic_schedule, true);
});

test('partial, tampered, foreign and non-generic plans never acquire the presentation flag', () => {
  const valid = plan();
  for (const changed of [null, {...valid, partial: true}, {...valid, valid: false},
    {...valid, _pp_native_schedule_v1: undefined}, {...valid, duration_minutes: 1}])
    assert.equal(ppNativeResourcePresentation(changed, model(), ppNativePresentationPlan), null);
  for (const changedModel of [{...model(), technical_processes: []},
    {...model(), orders: [{id: 'OTHER'}]}, {...model(), equipment: [{id: 'OTHER'}]},
    {...model(), employees: [{id: 'OTHER'}]}])
    assert.equal(ppNativeResourcePresentation(valid, changedModel, ppNativePresentationPlan), null);
  assert.equal(ppNativeResourcePresentation(valid, model(), undefined), null);
  assert.equal(ppNativeResourcePresentation(valid, model(), () => {throw Error('unavailable');}), null);
});

test('standalone UI append preserves every original byte and rejects drift or partial installation', () => {
  const original = '/* reviewed unrelated UI */\n' + ppNativePresentationPlan.toString() + '\n' +
    ppInstallNativePresentation.toString() + '\nfunction ppUnifiedGanttV2(){}\n';
  const patched = patchResourcePresentationUi(original);
  assert.equal(patched.slice(0, -resourcePresentationScript().length), original);
  assert.equal(patchResourcePresentationUi(patched), patched);
  assert.throws(() => patchResourcePresentationUi(original.replace('function ppUnifiedGanttV2()', 'function another()')), /REQUIRED_SOURCE_GUARD/);
  assert.throws(() => patchResourcePresentationUi(patched + '/* drift */'), /INSTALLED_SOURCE_DRIFT/);
  assert.throws(() => patchResourcePresentationUi(original + '/* ppInstallNativeResourcePresentation */'), /PARTIAL_INSTALL/);
  new vm.Script(patched);
});

const fixtureRoot = process.env.LIFTORBIT_RESOURCE_UI_FIXTURE_ROOT || '/tmp/liftorbit-resource-ui-20261125';
const fixtureFiles = ['legacy-tabs.js', 'generic-gantt.js'];
const actual = fixtureFiles.every(name => existsSync(join(fixtureRoot, name)));

// A small DOM surface executes the captured scripts unchanged. It contains no
// production HTML/source/model values and does not duplicate renderLoad.
function browser(savedPlan = plan(), initialPlan = savedPlan) {
  const timers = [], docListeners = [], windowListeners = new Map(), nodes = new Map();
  const values = new Map([
    ['prodplan.project.active.v2', 'P'],
    ['prodplan.projects.v2', JSON.stringify([{id: 'P', revision: 1, model: model(), lastPlan: savedPlan}])],
  ]);
  let requests = 0;
  class Event {
    constructor(type, options = {}) {this.type = type; Object.assign(this, options);}
    preventDefault() {this.defaultPrevented = true;}
    stopPropagation() {}
  }
  class Element {
    constructor(text = '') {
      this.textContent = text; this.innerHTML = ''; this.style = {}; this.children = [];
      this.listeners = []; const names = new Set();
      this.classList = {contains: name => names.has(name), toggle: (name, enabled) => {
        const on = enabled ?? !names.has(name); on ? names.add(name) : names.delete(name); return on;
      }};
    }
    addEventListener(type, fn) {this.listeners.push({type, fn});}
    after(value) {this.nextElementSibling = value; if (value.id) nodes.set(value.id, value);}
    appendChild(value) {this.children.push(value); return value;}
    querySelector() {return null;}
    closest(selector) {return selector === '.tabs>div' && tabs.children.includes(this) ? this : null;}
    dispatchEvent(event) {
      event.target = this;
      for (const row of docListeners) if (row.type === event.type && row.capture) row.fn(event);
      if (typeof this['on' + event.type] === 'function') this['on' + event.type](event);
      for (const row of tabs.listeners) if (row.type === event.type) row.fn(event);
      for (const row of docListeners) if (row.type === event.type && !row.capture) row.fn(event);
      return !event.defaultPrevented;
    }
  }
  const tabs = new Element();
  tabs.children = ['Гантт оборудования', 'Гантт сотрудников', 'Материалы', 'Заказы', 'Загрузка ресурсов', 'Узкие места']
    .map(name => new Element(name));
  tabs.children[0].classList.toggle('a', true);
  const get = id => {if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id);};
  const document = {
    createElement: () => new Element(), getElementById: get,
    querySelector: selector => selector === '.tabs' ? tabs : null,
    querySelectorAll: selector => selector === '.tabs>div' ? tabs.children : [],
    addEventListener: (type, fn, capture = false) => docListeners.push({type, fn, capture}),
  };
  const context = {
    document, Event, model: model(), q: get, applyZoom() {}, fmtDate: value => String(value),
    esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
    CSS: {escape: value => String(value)}, console: {warn() {}, info() {}, error() {}},
    buildGanttSkeleton() {}, renderPlan() {}, clearPlan() {},
    localStorage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)},
    setTimeout: fn => {timers.push(fn); return timers.length;}, clearTimeout() {},
    addEventListener(type, fn) {if (!windowListeners.has(type)) windowListeners.set(type, []); windowListeners.get(type).push(fn);},
    fetch: async () => {requests++; return new Response(JSON.stringify(initialPlan), {headers: {'content-type': 'application/json'}});},
    __ppTabPlan: initialPlan,
    __PP_INTEGRATED_NATIVE_RESULT_V1__: {isPlan: ppNativePresentationPlan},
  };
  context.window = context;
  vm.createContext(context);
  for (const name of fixtureFiles) vm.runInContext(readFileSync(join(fixtureRoot, name), 'utf8'), context, {timeout: 1000});
  const flush = () => {let count = 0; while (timers.length) {assert(++count < 50, 'no refresh loop'); timers.shift()();}};
  const click = index => {tabs.children[index].dispatchEvent(new Event('click', {bubbles: true, cancelable: true})); flush();};
  const install = () => {vm.runInContext(resourcePresentationScript(), context, {timeout: 1000}); flush();};
  return {context, values, tabs, get, flush, click, install, get requests() {return requests;},
    get html() {return get('ppTabsView').innerHTML;},
    async seedLegacy() {await context.fetch('/api/plan'); await new Promise(resolve => setImmediate(resolve)); flush();},
  };
}

test('actual saved native plan switches the open utilization tab from legacy zero cycles without a new request', {skip: !actual}, async () => {
  const b = browser();
  await b.seedLegacy(); b.click(4);
  assert.match(b.html, /0\.0%/);
  assert.match(b.html, /0 циклов/);
  const stored = b.values.get('prodplan.projects.v2'), requests = b.requests;
  b.install();
  assert.match(b.html, /Machine one/); assert.match(b.html, /25\.0%/);
  assert.match(b.html, /Machine two/); assert.match(b.html, /10\.0%/);
  assert.match(b.html, /Worker one/); assert.match(b.html, /35\.0%/);
  assert.doesNotMatch(b.html, /циклов/);
  assert.equal(b.requests, requests);
  assert.equal(b.values.get('prodplan.projects.v2'), stored);
  assert.equal(b.context.__ppGenericPlan.generic_schedule, true);
  assert.equal(b.context.__ppTabPlan.generic_schedule, undefined);
});

test('actual final and selected Stop plans refresh the same operations and leave continuation storage intact', {skip: !actual}, () => {
  const b = browser(); b.install(); b.click(4);
  const stored = b.values.get('prodplan.projects.v2');
  const next = plan(50), before = JSON.stringify(next);
  b.context.renderPlan(next); b.flush();
  assert.match(b.html, /50\.0%/); assert.match(b.html, /20\.0%/); assert.match(b.html, /70\.0%/);
  const stop = {...next}; delete stop.resume_state;
  b.context.renderPlan(stop); b.flush();
  assert.equal(b.context.__ppGenericPlan.duration_minutes, 50);
  assert.equal(b.context.__ppGenericPlan.operations, stop.operations);
  assert.equal(JSON.stringify(next), before);
  assert.equal(b.values.get('prodplan.projects.v2'), stored);
  assert.equal(b.requests, 0);
});

test('actual bootstrap uses the saved current project and respects revision and fresh-search clearing', {skip: !actual}, () => {
  const saved = plan(), b = browser(saved, null);
  b.install(); b.click(4); assert.match(b.html, /25\.0%/);
  const stale = {...saved, _revision: 0}, other = browser(stale, null);
  other.install(); assert.equal(other.context.__ppGenericPlan, undefined);
  const fresh = browser(saved);
  fresh.context.__ppFreshRestartMode = true; fresh.context.__ppFreshRestartProject = 'P';
  fresh.install(); assert.equal(fresh.context.__ppGenericPlan, undefined);
  fresh.context.__ppFreshReferencePlan = plan(50);
  fresh.context.__PP_NATIVE_RESOURCE_PRESENTATION_V1__.sync(); fresh.flush(); fresh.click(4);
  assert.match(fresh.html, /50\.0%/);
  fresh.context.clearPlan(); fresh.context.__ppFreshReferencePlan = null;
  fresh.context.__PP_NATIVE_RESOURCE_PRESENTATION_V1__.sync(); fresh.flush();
  assert.notEqual(fresh.context.__ppGenericPlan?.generic_schedule, true);
});

test('actual fresh comparison baseline cannot replace a newer visible full result', {skip: !actual}, () => {
  const b = browser(), reference = plan(100), selected = plan(50);
  b.context.__ppFreshRestartMode = true;
  b.context.__ppFreshRestartProject = 'P';
  b.context.__ppFreshReferencePlan = reference;
  const stored = b.values.get('prodplan.projects.v2'), before = JSON.stringify(reference);
  b.install(); b.click(4); assert.match(b.html, /25\.0%/);
  b.context.renderPlan(selected);
  // Existing completion/Stop handlers publish these aliases after rendering.
  b.context.__ppTabPlan = selected;
  b.context.__ppOptimizerCommittedPlan = selected;
  b.flush(); b.click(4);
  assert.equal(b.context.__ppGenericPlan.duration_minutes, 50);
  assert.equal(b.context.__ppGenericPlan.operations, selected.operations);
  assert.match(b.html, /50\.0%/); assert.match(b.html, /20\.0%/); assert.match(b.html, /70\.0%/);
  assert.doesNotMatch(b.html, /25\.0%/);
  assert.equal(b.context.__ppFreshReferencePlan, reference);
  assert.equal(JSON.stringify(reference), before);
  assert.equal(b.values.get('prodplan.projects.v2'), stored);
  assert.equal(b.requests, 0);
});

test('actual tab refresh cannot resurrect a different saved native plan over an explicit legacy selection', {skip: !actual}, () => {
  const b = browser(); b.install(); b.context.renderPlan(plan()); b.flush();
  const legacy = {ok: true, valid: true, duration_minutes: 20, batches: []};
  b.context.renderPlan(legacy); b.flush();
  b.context.__PP_NATIVE_RESOURCE_PRESENTATION_V1__.sync(); b.flush(); b.click(4);
  assert.equal(b.context.__ppGenericPlan, legacy);
  assert.equal(legacy.generic_schedule, undefined);
});

test('actual unified projection cache is restored to the selected real plan and installation is idempotent', {skip: !actual}, () => {
  const b = browser(), original = b.context.renderPlan;
  b.context.renderPlan = function(value) {
    original(value);
    b.context.__ppGenericPlan = {...value, operations: [], generic_operations: [], projected: true};
  };
  b.install();
  const first = b.context.renderPlan;
  vm.runInContext(ppInstallNativeResourcePresentation.toString() + ';ppInstallNativeResourcePresentation();', b.context);
  assert.equal(b.context.renderPlan, first);
  const selected = plan(50); b.context.renderPlan(selected); b.flush(); b.click(4);
  assert.equal(b.context.__ppGenericPlan.projected, undefined);
  assert.equal(b.context.__ppGenericPlan.operations, selected.operations);
  assert.match(b.html, /50\.0%/);
});

test('actual earlier renderer references can select a different saved plan without restoring an older cache', {skip: !actual}, () => {
  const b = browser(), earlierRenderer = b.context.renderPlan;
  b.install(); b.context.renderPlan(plan()); b.flush();
  const chosen = plan(50);
  earlierRenderer(chosen); b.context.__ppTabPlan = chosen;
  b.click(4);
  assert.match(b.html, /50\.0%/);
  assert.equal(b.context.__ppGenericPlan.operations, chosen.operations);
});

test('actual project changes cannot carry an owned presentation cache into another project', {skip: !actual}, () => {
  const b = browser(); b.install(); b.context.renderPlan(plan()); b.flush();
  const other = {id: 'OTHER', revision: 1, model: model(), lastPlan: plan(50)};
  b.values.set('prodplan.project.active.v2', 'OTHER');
  b.values.set('prodplan.projects.v2', JSON.stringify([other]));
  b.context.__PP_NATIVE_RESOURCE_PRESENTATION_V1__.sync(); b.flush();
  assert.equal(b.context.__ppGenericPlan, null);
  b.context.__ppTabPlan = other.lastPlan;
  b.context.renderPlan(other.lastPlan); b.flush(); b.click(4);
  assert.match(b.html, /50\.0%/);
});
