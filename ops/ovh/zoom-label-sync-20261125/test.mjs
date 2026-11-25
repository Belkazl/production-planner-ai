import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';
import {ppInstallNativeGanttZoomLabelSync, patchZoomLabelUi, zoomLabelScript,
  BASELINE_UI_SHA, ZOOM_LABEL_MARKER} from './zoom-label.mjs';
import {resourcePresentationScript, patchResourcePresentationUi} from '../resource-presentation-20261125/resource-presentation.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const engineVersion = 'equipment-gantt-component-v2-20261009';

function environment({zoom = 5, hidden = false, missing = null, installed = true} = {}) {
  const observers = [], pending = new Set(), warnings = [], nativeCalls = [];
  const plan = Object.freeze({quantity: 137, operations: Object.freeze([{id: 'synthetic'}])});
  const model = Object.freeze({equipment: Object.freeze([{id: 'original-machine'}])});
  const beforeData = JSON.stringify({plan, model});
  const toolbar = {}, heading = {};
  const group = {classList: {contains: name => name === 'zoom'}, parentElement: toolbar};
  const stage = {hidden, width: 31536, footer: '893 operations · 67 setups · zoom 500%'};
  const notify = target => {
    for (const observer of observers) if (observer.targets.has(target)) pending.add(observer);
  };
  let labelText = '100%', textWrites = 0;
  const label = {id: 'zoomLabel', parentElement: group, listeners: [],
    get textContent() { return labelText; },
    set textContent(value) { labelText = value; textWrites++; notify(label); }};
  const plus = {id: 'zoomIn', parentElement: group, listeners: []};
  const minus = {id: 'zoomOut', parentElement: group, listeners: []};
  const nodes = {ppGanttToolV2: stage, zoomLabel: label, zoomIn: plus, zoomOut: minus};
  const window = {__PP_GANTT_TOOL_V2_INSTALLED__: installed,
    __PP_GANTT_TOOL_V2__: {version: engineVersion, zoom, operations: 893, setups: 67}};
  let nativeScale = zoom;
  const nativeDraw = scale => {
    nativeScale = scale;
    stage.hidden = false;
    stage.width = 6307.2 * nativeScale;
    stage.footer = `893 operations · 67 setups · zoom ${Math.round(nativeScale * 100)}%`;
    // The real renderer creates a new diagnostic object on every draw.
    window.__PP_GANTT_TOOL_V2__ = {version: engineVersion, zoom: nativeScale, operations: 893, setups: 67};
    notify(stage);
  };
  const nativeZoomTo = scale => {
    nativeCalls.push(scale);
    label.textContent = Math.round(scale * 100) + '%';
    nativeDraw(scale);
  };
  plus.listeners.push(() => nativeZoomTo(Math.min(5, nativeScale + .25)));
  minus.listeners.push(() => nativeZoomTo(Math.max(.5, nativeScale - .25)));
  label.listeners.push(() => nativeZoomTo(1));
  const context = vm.createContext({window, document: {getElementById: id => id === missing ? null : nodes[id] || null},
    model, plan, console: {warn: message => warnings.push(message)},
    renderPlan() { throw Error('Label sync must not redraw the plan'); },
    clearPlan() { throw Error('Label sync must not clear the plan'); },
    localStorage: {setItem() { throw Error('Label sync must not persist state'); }},
    fetch() { throw Error('Label sync must not make requests'); },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.targets = new Map(); observers.push(this); }
      observe(target, options) { this.targets.set(target, options); }
      disconnect() { this.targets.clear(); pending.delete(this); }
    }});
  const install = () => vm.runInContext(`(${ppInstallNativeGanttZoomLabelSync.toString()})()`, context);
  const flush = () => {
    let turns = 0;
    while (pending.size) {
      assert(++turns < 4, 'no observer recursion or mutation loop');
      const batch = [...pending]; pending.clear();
      for (const observer of batch) observer.callback();
    }
    return turns;
  };
  return {window, stage, label, plus, minus, group, toolbar, heading, observers, pending, warnings,
    nativeCalls, nativeDraw, notify, install, flush, nodes, model, plan, beforeData,
    get textWrites() { return textWrites; },
    click(control) { for (const listener of control.listeners) listener(); },
    tab(mode) {
      group.parentElement = mode === 0 ? toolbar : heading;
      // Existing tab rendering resets its independent legacy zoom label.
      label.textContent = '100%';
      notify(stage);
    }};
}

test('Employees, Orders and Equipment retain real width/footer 500% and correct label 100% to 500%', () => {
  const f = environment();
  const diagnostic = f.window.__PP_GANTT_TOOL_V2__;
  const api = f.install();
  assert.equal(api.installed, true);
  for (const mode of [1, 3, 0, 1, 3, 0]) {
    f.tab(mode);
    assert.equal(f.label.textContent, '100%');
    assert.equal(f.flush(), 1, 'own text correction does not enqueue another observer callback');
    assert.equal(f.label.textContent, '500%');
    assert.equal(f.stage.width, 31536);
    assert.equal(f.stage.footer, '893 operations · 67 setups · zoom 500%');
    assert.equal(f.window.__PP_GANTT_TOOL_V2__, diagnostic, 'diagnostic state is read-only');
    assert.equal(f.group.parentElement, mode === 0 ? f.toolbar : f.heading, 'sync never relocates controls');
  }
  assert.equal(f.nativeCalls.length, 0);
  assert.equal(JSON.stringify({plan: f.plan, model: f.model}), f.beforeData);
});

test('native plus, minus and reset listeners stay attached and use the true engine scale', () => {
  const f = environment();
  const handlers = [f.minus, f.label, f.plus].map(control => control.listeners[0]);
  f.install(); f.tab(3);
  f.click(f.minus); f.flush();
  assert.equal(f.label.textContent, '475%');
  assert.equal(f.window.__PP_GANTT_TOOL_V2__.zoom, 4.75);
  f.click(f.plus); f.flush();
  assert.equal(f.label.textContent, '500%');
  f.click(f.label); f.flush();
  assert.equal(f.label.textContent, '100%');
  assert.equal(f.window.__PP_GANTT_TOOL_V2__.zoom, 1);
  [f.minus, f.label, f.plus].forEach((control, index) => {
    assert.equal(control.listeners.length, 1);
    assert.equal(control.listeners[0], handlers[index]);
  });
});

test('delayed legacy label reset without redraw still restores the latest native diagnostic value', () => {
  const f = environment(); f.install();
  f.nativeDraw(2.75); f.flush();
  assert.equal(f.label.textContent, '275%');
  f.label.textContent = '100%';
  const width = f.stage.width, footer = f.stage.footer;
  f.flush();
  assert.equal(f.label.textContent, '275%');
  assert.equal(f.stage.width, width); assert.equal(f.stage.footer, footer);
  const writes = f.textWrites;
  f.notify(f.stage); f.flush();
  assert.equal(f.textWrites, writes, 'matching label is never rewritten');
});

test('clear and fresh-search empty stages do not resurrect a previous zoom label', () => {
  const f = environment(); const api = f.install();
  f.stage.hidden = true; f.label.textContent = '100%'; f.notify(f.stage); f.flush();
  assert.equal(f.window.__PP_GANTT_TOOL_V2__.zoom, 5, 'native clear leaves the last published diagnostic');
  assert.equal(f.label.textContent, '100%');
  assert.equal(api.actualZoom, null);
  f.notify(f.stage); f.flush();
  assert.equal(f.label.textContent, '100%');
  f.nativeDraw(1.5); f.flush();
  assert.equal(f.label.textContent, '150%', 'the first actual fresh render supplies its own scale');
  assert.equal(api.actualZoom, 1.5);
});

test('installation before the first native draw waits for valid current renderer metadata', () => {
  const f = environment({hidden: true});
  delete f.window.__PP_GANTT_TOOL_V2__;
  const api = f.install();
  assert.equal(f.label.textContent, '100%');
  assert.equal(api.actualZoom, null);
  f.nativeDraw(.5); f.flush();
  assert.equal(f.label.textContent, '50%');
});

test('invalid or unknown renderer metadata fails closed and never guesses scale from the label', () => {
  const f = environment(); const api = f.install();
  for (const zoom of [undefined, null, '5', NaN, Infinity, .49, 5.01]) {
    f.window.__PP_GANTT_TOOL_V2__ = {version: engineVersion, zoom};
    f.label.textContent = '125%'; f.flush();
    assert.equal(f.label.textContent, '125%');
    assert.equal(api.actualZoom, null);
  }
  f.window.__PP_GANTT_TOOL_V2__ = {version: 'different-renderer', zoom: 5};
  f.notify(f.stage); f.flush();
  assert.equal(f.label.textContent, '125%');
  f.nativeDraw(5); f.flush(); assert.equal(f.label.textContent, '500%');
  f.nodes.zoomLabel = {textContent: '100%'};
  assert.equal(api.sync(), false, 'a replaced DOM node is not silently adopted');
});

test('installer is idempotent and missing native controls cannot create a competing UI', () => {
  const f = environment(); const api = f.install();
  assert.equal(f.install(), api); assert.equal(f.observers.length, 1);
  assert.equal(f.observers[0].targets.size, 2);
  for (const options of [{missing: 'zoomIn'}, {missing: 'zoomLabel'}, {installed: false}]) {
    const broken = environment(options);
    assert.equal(broken.install(), null);
    assert.equal(broken.observers.length, 0);
    assert.equal(broken.label.textContent, '100%');
  }
});

const syntheticUi = 'function ppUnifiedGanttV2(){}\nfunction ppSecondaryGanttZoom(){}\n' +
  'function ppNativePresentationPlan(plan){return plan;}\nfunction ppInstallNativePresentation(){}\n' +
  'window.__PP_INTEGRATED_NATIVE_RESULT_V1__ = {};\n' + resourcePresentationScript();
test('guarded transform inserts before the frozen resource suffix and preserves every original byte', () => {
  const after = patchZoomLabelUi(syntheticUi, digest(syntheticUi));
  const resource = resourcePresentationScript(), addon = zoomLabelScript();
  assert.equal(after, syntheticUi.slice(0, -resource.length) + addon + resource);
  assert.equal(after.slice(0, -addon.length - resource.length) + resource, syntheticUi);
  assert.equal(patchZoomLabelUi(after, digest(syntheticUi)), after);
  assert.equal(patchResourcePresentationUi(after), after);
  assert.equal(after.split(ZOOM_LABEL_MARKER).length, 2);
  assert.throws(() => patchZoomLabelUi(syntheticUi), /BASELINE_DRIFT/);
  for (const broken of [after + '\n', after + addon,
    after.replace('ppUnifiedGanttV2()', 'renamedGantt()'), syntheticUi + addon])
    assert.throws(() => patchZoomLabelUi(broken, digest(syntheticUi)));
});

const beforeRoot = process.env.LIFTORBIT_ZOOM_LABEL_FIXTURE_ROOT;
const afterRoot = process.env.LIFTORBIT_ZOOM_LABEL_PATCHED_ROOT;
test('actual captured UI matches the accepted baseline and exact label-only insertion', {skip: !beforeRoot && !afterRoot}, () => {
  assert(beforeRoot && afterRoot, 'both captured and patched source roots are required');
  const before = readFileSync(join(beforeRoot, 'restart-optimizer-ui.js'), 'utf8');
  const after = readFileSync(join(afterRoot, 'restart-optimizer-ui.js'), 'utf8');
  assert.equal(digest(before), BASELINE_UI_SHA);
  assert.equal(patchZoomLabelUi(before), after);
  assert.equal(patchZoomLabelUi(after), after);
  assert.equal(patchResourcePresentationUi(after), after);
  const resource = resourcePresentationScript(), addon = zoomLabelScript();
  assert.equal(after.slice(0, -addon.length - resource.length) + resource, before);
});
