/** Mandatory CI runtime cases using synthetic renderer/storage/DOM stubs only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {resourcePresentationScript} from '../resource-presentation-20261125/resource-presentation.mjs';

const model = () => ({orders: [{id: 'ORDER', quantity: 7}], equipment: [{id: 'MACHINE'}],
  employees: [{id: 'OPERATOR'}], technical_processes: [{id: 'PROCESS', operations: [{id: 'CUT'}]}]});
const plan = duration => ({syntheticVerified: true, _revision: 1, duration_minutes: duration,
  generic_operations: [{order: 'ORDER', batch: 1, quantity: 7, operation_id: 'CUT',
    equipment_ids: ['MACHINE'], employee_ids: ['OPERATOR'], start_min: 0, end_min: duration}]});

function environment({fresh = false, projection = false} = {}) {
  const original = plan(100), baseline = plan(100);
  const projects = [{id: 'PROJECT', revision: 1, model: model(), lastPlan: original}];
  let activeProject = 'PROJECT';
  const nativeCalls = [], tabCalls = [], queue = [], docEvents = {}, windowEvents = {};
  const window = {
    __ppTabPlan: original, __ppGenericPlan: original,
    __PP_INTEGRATED_NATIVE_RESULT_V1__: {isPlan: value => value?.syntheticVerified === true},
    __ppFreshRestartMode: fresh, __ppFreshRestartProject: 'PROJECT', __ppFreshReferencePlan: fresh ? baseline : null,
    addEventListener(name, handler) { windowEvents[name] = handler; }
  };
  const nativeRender = value => {
    nativeCalls.push(value);
    window.__ppTabPlan = value;
    if (projection) window.__ppGenericPlan = {...value, generic_operations: [], virtualResourceProjection: true};
    return 'native-render-result';
  };
  window.renderPlan = nativeRender;
  window.clearPlan = () => { window.__ppTabPlan = null; return 'native-clear-result'; };
  const tabs = Array.from({length: 6}, (_, index) => ({
    classList: {contains: name => name === 'a' && index === 4},
    dispatchEvent() { tabCalls.push(window.__ppGenericPlan); }
  }));
  const document = {querySelectorAll: selector => selector === '.tabs>div' ? tabs : [],
    addEventListener(name, handler) { docEvents[name] = handler; }};
  const localStorage = {
    getItem(key) {
      return key === 'prodplan.project.active.v2' ? activeProject :
        key === 'prodplan.projects.v2' ? JSON.stringify(projects) : null;
    },
    setItem() { throw Error('Presentation must not write storage'); },
    removeItem() { throw Error('Presentation must not remove storage'); }
  };
  const context = vm.createContext({window, document, localStorage, model: projects[0].model,
    Event: class { constructor(type, options) { this.type = type; this.options = options; } },
    setTimeout(callback) { queue.push(callback); },
    fetch() { throw Error('Presentation must not request another plan'); }, console});
  const originalStorage = JSON.stringify(projects);
  const install = () => vm.runInContext(resourcePresentationScript(), context);
  const flush = () => {
    let count = 0;
    while (queue.length) { assert(++count < 20, 'no refresh loop'); queue.shift()(); }
  };
  install(); flush();
  return {window, original, baseline, nativeRender, nativeCalls, tabCalls, projects, originalStorage,
    install, flush, activate(id) { activeProject = id; }, docEvents, windowEvents};
}

test('synthetic saved native schedule is presented through the existing utilization tab without persistence', () => {
  const f = environment();
  assert.equal(f.window.__ppGenericPlan.generic_schedule, true);
  assert.equal(f.window.__ppGenericPlan.generic_operations, f.original.generic_operations);
  assert.equal(f.tabCalls.at(-1).duration_minutes, 100);
  assert.equal(f.original.generic_schedule, undefined);
  assert.equal(JSON.stringify(f.projects), f.originalStorage);
  assert.equal(f.nativeCalls.length, 0, 'bootstrap refresh does not schedule or redraw a different plan');
});

test('synthetic fresh selection 50 remains visible with an earlier comparison reference 100', () => {
  const f = environment({fresh: true});
  const selected = plan(50), before = JSON.stringify(selected);
  assert.equal(f.window.renderPlan(selected), 'native-render-result');
  f.flush();
  assert.equal(f.window.__ppGenericPlan.duration_minutes, 50);
  assert.equal(f.tabCalls.at(-1).duration_minutes, 50);
  assert.equal(f.window.__ppGenericPlan.generic_operations, selected.generic_operations);
  assert.equal(f.window.__ppFreshReferencePlan, f.baseline);
  assert.equal(JSON.stringify(selected), before);
  assert.equal(JSON.stringify(f.projects), f.originalStorage);
  const nextSelected = plan(60);
  f.nativeRender(nextSelected); // Saved-plan/Stop handlers may retain this old reference.
  f.window.__PP_NATIVE_RESOURCE_PRESENTATION_V1__.sync(); f.flush();
  assert.equal(f.window.__ppGenericPlan.duration_minutes, 60);
  assert.equal(f.tabCalls.at(-1).duration_minutes, 60);
});

test('synthetic projected Gantt cache returns to the actual selected schedule after native rendering', () => {
  const f = environment({projection: true});
  const selected = plan(70);
  f.window.renderPlan(selected); f.flush();
  assert.equal(f.window.__ppGenericPlan.virtualResourceProjection, undefined);
  assert.equal(f.window.__ppGenericPlan.generic_operations, selected.generic_operations);
  assert.equal(f.tabCalls.at(-1).duration_minutes, 70);
});

test('synthetic explicit unverified selection cannot resurrect an older saved native plan', () => {
  const f = environment();
  const explicit = {...plan(80), syntheticVerified: false};
  f.window.renderPlan(explicit);
  f.window.__PP_NATIVE_RESOURCE_PRESENTATION_V1__.sync(); f.flush();
  assert.equal(f.window.__ppTabPlan, explicit);
  assert.equal(f.window.__ppGenericPlan, explicit);
  assert.equal(explicit.generic_schedule, undefined);
  assert.equal(JSON.stringify(f.projects), f.originalStorage);
});

test('synthetic clear and project changes do not leak a previous presentation cache', () => {
  const f = environment();
  assert.equal(f.window.clearPlan(), 'native-clear-result');
  f.window.__PP_NATIVE_RESOURCE_PRESENTATION_V1__.sync(); f.flush();
  assert.equal(f.window.__ppGenericPlan, null);
  f.window.renderPlan(plan(55)); f.flush();
  f.projects.push({id: 'OTHER', revision: 1, model: model(), lastPlan: plan(90)});
  f.activate('OTHER');
  f.window.__PP_NATIVE_RESOURCE_PRESENTATION_V1__.sync(); f.flush();
  assert.equal(f.window.__ppGenericPlan, null);
});

test('synthetic repeated installer keeps the same wrappers and event handlers', () => {
  const f = environment();
  const render = f.window.renderPlan, clear = f.window.clearPlan, click = f.docEvents.click;
  f.install(); f.flush();
  assert.equal(f.window.renderPlan, render);
  assert.equal(f.window.clearPlan, clear);
  assert.equal(f.docEvents.click, click);
});
