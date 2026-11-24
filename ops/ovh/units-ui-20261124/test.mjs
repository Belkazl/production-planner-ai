import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {ppResourceUnitsInlineHtml} from './units-ui.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(process.env.PP_UNITS_UI_FIXTURE_DIR || '/tmp/liftorbit-units-utilization-20261124', 'ppTechProcessJs.js');
const available = existsSync(fixture);
if (process.env.PP_UNITS_UI_REQUIRE_FIXTURES === '1') assert(available, 'actual native editor fixture required');
const original = available ? readFileSync(fixture, 'utf8') : null;
const html = available ? '<!doctype html><body><script id="outside">/* untouched */</script><script id="ppTechProcessJs">' + original + '</script></body>' : null;
const transformed = available ? ppResourceUnitsInlineHtml(html) : null;
const scriptOf = page => page.match(/<script id="ppTechProcessJs">([\s\S]*?)<\/script>/)?.[1];
const quietTransform = vm.runInNewContext('(' + ppResourceUnitsInlineHtml.toString() + ')', {console: {warn() {}}});

test('self-contained transform leaves unrelated or missing editor HTML untouched', () => {
  for (const input of [null, '', 'login-only page', '<script id="ppTechProcessJs">unknown editor</script>'])
    assert.equal(quietTransform(input), input);
});

test('auth patch runs after canonical units, preserves unrelated source and is idempotent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pp-units-ui-'));
  try {
    const tail = '\nfunction ppProjectTextImportHtml(html){return html;}\n';
    const call = 'ppResourceUnitsHtml(ppGanttZoom500Html(ppOptimizerLifecycleHtml(ppNonBlockingDbSyncHtml(enhanced))))';
    const before = 'function page(enhanced){return new Response(' + call + ',{headers:{"x-liftorbit-ui":"etalon-modules-compat"}})}\n' + tail;
    const input = join(dir, 'before.js'), output = join(dir, 'after.js'), repeat = join(dir, 'repeat.js');
    const run = (a, b) => spawnSync(process.execPath, [join(here, 'patch.mjs'), a, b], {encoding: 'utf8'});
    writeFileSync(input, before);
    let result = run(input, output); assert.equal(result.status, 0, result.stderr);
    const patched = readFileSync(output, 'utf8');
    const helper = '\n' + ppResourceUnitsInlineHtml.toString() + '\n';
    assert(patched.includes('return new Response(ppResourceUnitsInlineHtml(' + call + '),{'));
    assert(patched.endsWith(tail));
    assert.equal(patched.replace(helper, '').replace('ppResourceUnitsInlineHtml(' + call + ')', call), before);
    new vm.Script(patched);
    result = run(output, repeat); assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(repeat, 'utf8'), patched);
    writeFileSync(input, before.replace('ppResourceUnitsHtml(', 'unknownCanonicalHelper('));
    result = run(input, join(dir, 'rejected.js'));
    assert.notEqual(result.status, 0);
    assert(!existsSync(join(dir, 'rejected.js')));
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('actual editor transforms atomically, preserves handlers and rejects drift or partial installation', {skip: !available}, () => {
  assert.notEqual(transformed, html);
  assert.equal(ppResourceUnitsInlineHtml(transformed), transformed);
  new vm.Script(scriptOf(transformed));
  assert(transformed.includes('<script id="outside">/* untouched */</script>'));
  const next = scriptOf(transformed);
  assert(next.includes(original.slice(0, original.indexOf('function rr(r){'))));
  assert(next.endsWith(original.slice(original.indexOf('function renderProd(){'))));
  for (const anchor of ['function refresh(row){', 'function ppCanonicalRequirementUnit(req,sourceModel){', '<th>Количество</th><th>Ед.</th><th>Расход</th>']) {
    const drift = html.replace(anchor, '/* changed source anchor */');
    assert.equal(quietTransform(drift), drift);
  }
  const duplicate = html.replace('</body>', '<script id="ppTechProcessJs">' + original + '</script></body>');
  assert.equal(quietTransform(duplicate), duplicate);
  const partial = transformed.replace('<th>Количество</th><th>Расход</th>', '<th>Количество</th><th>Ед.</th><th>Расход</th>');
  assert.equal(quietTransform(partial), partial);
  const missingMarker = transformed.replace('// PP_RESOURCE_UNITS_INLINE_20261124\n', '');
  assert.equal(quietTransform(missingMarker), missingMarker);
});

let JSDOM;
if (available) {
  const require = createRequire(process.env.PP_UNITS_UI_JSDOM_PACKAGE || '/tmp/liftorbit-text-import-test/package.json');
  ({JSDOM} = require('jsdom'));
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function sampleModel() {
  return {
    quantity_unit: 'м²',
    autoclaves: [{id: 'E1', name: 'Press', kind: 'press'}],
    employees: [{id: 'EMP1', name: 'Operator', role: 'Press operator'}],
    materials: [{id: 'M1', name: 'Powder', unit: 'кг', initial_stock: 1000, deliveries: []},
      {id: 'M2', name: 'Boxes', unit: 'шт.', initial_stock: 100, deliveries: []}],
    technical_processes: [{id: 'TP1', name: 'Ceramics', operations: [{
      id: 'OP1', sequence: 10, name: 'Pressing', duration_min: 40, parallel_allowed: false,
      resource_requirements: [
        {id: 'RR-E', resource_type: 'equipment', match_mode: 'specific', resource_ref: 'E1', quantity: 1, unit: 'кг', consumption_rule: 'during_operation'},
        {id: 'RR-L', resource_type: 'employee', match_mode: 'specific', resource_ref: 'EMP1', quantity: 2, unit: 'кг', consumption_rule: 'during_operation'},
        {id: 'RR-M', resource_type: 'material', match_mode: 'specific', resource_ref: 'M1', quantity: 18.5, unit: 'шт.', consumption_rule: 'per_m2'},
      ],
    }]}, {id: 'TP2', name: 'Packing', operations: [{
      id: 'OP2', sequence: 10, name: 'Packing', duration_min: 10,
      resource_requirements: [{id: 'RR-M2', resource_type: 'material', match_mode: 'specific', resource_ref: 'M2', quantity: 4, unit: 'кг', consumption_rule: 'per_operation'}],
    }]}],
  };
}
function harness() {
  const dom = new JSDOM('<!doctype html><html><body><div id="sectionView"></div><div id="planView"></div><div id="valid"></div><div id="meta"></div><button id="opt"></button></body></html>', {
    url: 'https://app.liftorbit.app/', runScripts: 'outside-only'
  });
  const w = dom.window, captured = [];
  w.model = sampleModel(); w.modelReady = true; w.hasResult = false;
  w.q = id => w.document.getElementById(id); w.opt = w.q('opt');
  w.esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
  w.renderSection = () => {}; w.renderSummary = () => {}; w.clearPlan = () => {};
  w.console = {info() {}, warn() {}, error() {}, log() {}};
  w.localStorage.setItem('prodplan.project.active.v2', 'test-project');
  w.localStorage.setItem('prodplan.projects.v2', JSON.stringify([{id: 'test-project', model: w.model, revision: 1}]));
  w.fetch = async (url, init) => {
    assert.equal(url, '/api/project/model/import');
    const next = JSON.parse(init.body).model;
    captured.push(next);
    return {ok: true, json: async () => ({ok: true, model: next, model_ready: true})};
  };
  w.eval(scriptOf(transformed)); w.renderSection('Производство');
  return {w, captured, row: id => w.document.querySelector('[data-r][data-id="' + id + '"]'),
    change(element, value) { element.value = value; element.dispatchEvent(new w.Event('change', {bubbles: true})); },
    async save() { w.document.querySelector('#sectionView [data-save]').click(); await flush(); },
    close() { dom.window.close(); }};
}

test('native Production renders six columns with non-editable canonical units beside quantities, including added rows', {skip: !available}, () => {
  const h = harness();
  try {
    const headings = [...h.w.document.querySelectorAll('.pp-rr-table thead th')].map(node => node.textContent);
    assert.deepEqual(headings, ['Тип', 'Выбор', 'Ресурс / группа', 'Количество', 'Расход', '']);
    assert.equal(h.w.document.querySelectorAll('input[data-rf=unit],select[data-rf=unit],textarea[data-rf=unit]').length, 0);
    for (const [id, unit, quantity] of [['RR-E', 'шт.', '1'], ['RR-L', 'чел.', '2'], ['RR-M', 'кг', '18.5']]) {
      const row = h.row(id), output = row.querySelector('[data-rf=unit]'), input = row.querySelector('[data-rf=quantity]');
      assert.equal(row.cells.length, 6);
      assert.equal(output.tagName, 'OUTPUT'); assert.equal(output.value, unit); assert.equal(output.textContent, unit);
      assert.equal(output.getAttribute('aria-readonly'), 'true'); assert.equal(output.tabIndex, -1);
      assert.equal(output.closest('td'), input.closest('td')); assert.equal(input.value, quantity);
    }
    assert.equal(h.row('RR-M').querySelector('[data-rf=consumption_rule]').value, 'per_m2');
    h.w.document.querySelector('[data-radd]').click();
    const added = [...h.w.document.querySelectorAll('[data-r]')].at(-1);
    assert.equal(added.cells.length, 6); assert.equal(added.querySelector('output[data-rf=unit]').value, 'чел.');
    h.w.document.querySelector('[data-pt="TP2"]').click();
    assert.equal(h.row('RR-M2').querySelector('output[data-rf=unit]').value, 'шт.');
    assert.equal(h.w.document.querySelectorAll('.pp-rr-table thead th').length, 6);
  } finally { h.close(); }
});

test('native resource handlers update Output.value and saving still derives units without changing quantity or consumption', {skip: !available}, async () => {
  const h = harness();
  try {
    const row = h.row('RR-M'), output = row.querySelector('output[data-rf=unit]');
    h.change(row.querySelector('[data-rf=resource_ref]'), 'M2');
    assert.equal(output.value, 'шт.'); assert.equal(output.textContent, 'шт.');
    assert.equal(row.querySelector('[data-rf=quantity]').value, '18.5');
    assert.equal(row.querySelector('[data-rf=consumption_rule]').value, 'per_m2');
    h.change(row.querySelector('[data-rf=resource_ref]'), 'M1');
    assert.equal(output.value, 'кг');
    const type = h.row('RR-E').querySelector('[data-rf=resource_type]');
    h.change(type, 'employee'); assert.equal(h.row('RR-E').querySelector('output').value, 'чел.');
    h.change(type, 'equipment'); assert.equal(h.row('RR-E').querySelector('output').value, 'шт.');
    output.value = 'invalid manual override';
    await h.save();
    assert.equal(h.captured.length, 1);
    const requirements = h.captured[0].technical_processes[0].operations[0].resource_requirements;
    assert.deepEqual(requirements.map(item => item.unit), ['шт.', 'чел.', 'кг']);
    assert.equal(requirements[2].quantity, 18.5); assert.equal(requirements[2].consumption_rule, 'per_m2');
    assert.equal(h.row('RR-M').querySelector('output').value, 'кг');
  } finally { h.close(); }
});

test('Materials retains its editable Unit column and its saved unit appears in Production without conversion', {skip: !available}, async () => {
  const h = harness();
  try {
    h.w.renderSection('Материалы');
    const input = h.w.document.querySelector('#matBody [data-id="M1"] [data-f=unit]');
    assert.equal(input.tagName, 'INPUT'); assert.equal(input.readOnly, false);
    assert([...h.w.document.querySelectorAll('.pp-edit-table th')].some(node => node.textContent === 'Ед.'));
    input.value = 'г'; await h.save();
    assert.equal(h.captured[0].materials[0].unit, 'г');
    const material = h.captured[0].technical_processes[0].operations[0].resource_requirements[2];
    assert.equal(material.unit, 'г'); assert.equal(material.quantity, 18.5); assert.equal(material.consumption_rule, 'per_m2');
    h.w.renderSection('Производство');
    assert.equal(h.row('RR-M').querySelector('output').value, 'г');
    assert.equal(h.row('RR-M').querySelector('[data-rf=quantity]').value, '18.5');
  } finally { h.close(); }
});
