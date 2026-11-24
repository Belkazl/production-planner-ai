import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import {ppSelectedBatchGenome, patchSelectedGenomeUi} from './selected_genome_ui.mjs';

function literal(source, name) {
  const match = source.match(new RegExp('^const ' + name + '=(".*");$', 'm'));
  assert(match, 'existing public patch literal is present');
  return JSON.parse(match[1]);
}
const publicBase = readFileSync(new URL('../continuation-seed-ui-20261118/patch.mjs', import.meta.url), 'utf8');
const publicHotfix = readFileSync(new URL('../continuation-seed-ui-20261118/hotfix.mjs', import.meta.url), 'utf8');
const publicIife = literal(publicBase, 'added').replace(literal(publicHotfix, 'old'), literal(publicHotfix, 'updated'));

function plan(sizes) {
  const rows = sizes.map((quantity, index) => ({order: 'O', batch: index + 1, batch_quantity: quantity,
    operation_id: 'WORK', equipment_ids: [quantity > 5 ? 'BIG' : 'SMALL'], employee_ids: [],
    start_min: index * 10, end_min: index * 10 + 10}));
  return {ok: true, valid: true, partial: false, _revision: 4, order_sequence: ['O'],
    operations: rows, generic_operations: rows, duration_minutes: 1234567, model_hash: 'PRIVATE_HASH_SENTINEL',
    batches: sizes.map((quantity, index) => ({order: 'O', batch: index + 1, quantity, area: quantity}))};
}
function project(lastPlan = plan([10, 10, 10])) {
  return {id: 'P', revision: 4, model: {quantity_unit: 'шт.', orders: [{id: 'O', quantity: 30, unit: 'шт.'}],
    equipment: [{id: 'BIG', capacity: 10}, {id: 'SMALL', capacity: 5}], employees: []}, lastPlan};
}

function browser(source = publicIife, activeProject = project()) {
  const calls = [];
  const values = {'prodplan.project.active.v2': 'P', 'prodplan.projects.v2': JSON.stringify([activeProject])};
  const window = {location: {href: 'https://app.invalid/', origin: 'https://app.invalid'},
    fetch: async (input, init) => {calls.push({input, init}); return {ok: true};}};
  vm.runInNewContext(patchSelectedGenomeUi(source), {window, URL, TextEncoder,
    localStorage: {getItem: key => values[key] ?? null}, console: {info() {}, warn() {}}}, {timeout: 1000});
  return {window, calls, async post(body, url = '/api/plan') {
    await window.fetch(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
    return JSON.parse(calls.at(-1).init.body);
  }};
}

function continuationIife(source) {
  const start = source.indexOf(';(()=>{\n"use strict";\n// Augment only real Continue requests.');
  const ending = 'window.__PP_CONTINUATION_SEED_V2__={installed:true,lastSeedLength:0};\n})();';
  const end = source.indexOf(ending, start);
  assert(start >= 0 && end > start, 'actual continuation IIFE anchors');
  return source.slice(start, end + ending.length);
}

test('ordered sizes follow native batch identities, never sorted quantity values', () => {
  const selected = plan([10, 5, 10, 5]);
  selected.batches = [selected.batches[2], selected.batches[0], selected.batches[3], selected.batches[1]];
  const value = ppSelectedBatchGenome(selected, project(), ['O']);
  assert.deepEqual(value, {version: 1, order_sequence: ['O'], partitions: [{order_id: 'O', sizes: [10, 5, 10, 5]}]});
  const encoded = JSON.stringify(value);
  for (const forbidden of ['duration_minutes', 'PRIVATE_HASH_SENTINEL', 'model_hash', 'operations', 'equipment_ids'])
    assert(!encoded.includes(forbidden));
});

test('owned complete partitions reject malformed, fractional, foreign and stale data', () => {
  const mutations = [
    value => {value.batches[1].batch = 1;},
    value => {value.batches[1].batch = 9;},
    value => {value.batches[0].order = 'FOREIGN';},
    value => {value.batches[0].quantity = 0;},
    value => {value.batches[0].quantity = Number.NaN;},
    value => {value.batches[0].quantity = Number.POSITIVE_INFINITY;},
    value => {value.batches[0].quantity = true;},
    value => {value.batches[0].quantity = 9;},
    value => {value.batches[0].quantity = 9.5; value.batches[1].quantity = 5.5;},
    value => {value._revision = 3;},
    value => {value.partial = true;},
  ];
  for (const change of mutations) {
    const selected = plan([10, 5, 10, 5]); change(selected);
    assert.equal(ppSelectedBatchGenome(selected, project(), ['O']), null);
  }
  const owner = project(); owner.model.orders.push({id: 'MISSING', quantity: 1, unit: 'шт.'});
  assert.equal(ppSelectedBatchGenome(plan([10, 5, 10, 5]), owner, ['O', 'MISSING']), null);
  assert.equal(ppSelectedBatchGenome(plan([10, 5, 10, 5]), project(), ['OTHER']), null);
});

test('compact proposal recompaction retains independent ordered copies and drops full plan fields', () => {
  const original = ppSelectedBatchGenome(plan([10, 5, 10, 5]), project(), ['O']);
  const hint = {order_sequence: ['O'], batch_genome: original, duration_minutes: 1, model_hash: 'untrusted'};
  const returned = ppSelectedBatchGenome(hint, project(), ['O']);
  assert.deepEqual(returned, original);
  returned.partitions[0].sizes[0] = 999;
  assert.equal(original.partitions[0].sizes[0], 10);
  original.partitions[0].sizes = [10, 10, 10];
  original.private_context = {};
  assert.equal(ppSelectedBatchGenome(hint, project(), ['O']), null);
});

test('public IIFE preserves two explicit selected partitions with the same order sequence', async () => {
  const b = browser();
  const nativeState = {version: 2, model_hash: 'existing-state-left-for-server-validation'};
  const first = await b.post({continue: true, resume_plan: plan([10, 5, 10, 5]), resume_state: nativeState,
    locked_operations: [{order: 'O', batch: 2, batch_quantity: 5}]});
  const second = await b.post({continue: true, resume_plan: plan([5, 5, 5, 5, 5, 5])});
  assert.deepEqual(first.resume_plan.order_sequence, second.resume_plan.order_sequence);
  assert.deepEqual(first.resume_plan.batch_genome.partitions[0].sizes, [10, 5, 10, 5]);
  assert.deepEqual(second.resume_plan.batch_genome.partitions[0].sizes, [5, 5, 5, 5, 5, 5]);
  assert.deepEqual(Object.keys(first.resume_plan).sort(), ['batch_genome', 'order_sequence']);
  assert.deepEqual(first.resume_state, nativeState);
  assert.deepEqual(first.locked_operations, [{order: 'O', batch: 2, batch_quantity: 5}]);
  assert(!JSON.stringify(first.resume_plan).includes('PRIVATE_HASH_SENTINEL'));
  assert(!JSON.stringify(first.resume_plan).includes('1234567'));
});

test('both saved-plan extraction and already compact recompaction retain the selected genome', async () => {
  const selected = plan([10, 5, 10, 5]);
  const b = browser(publicIife, project(selected));
  const fromSaved = await b.post({continue_run: true});
  assert.deepEqual(fromSaved.resume_plan.batch_genome.partitions[0].sizes, [10, 5, 10, 5]);
  const other = browser();
  const recompacted = await other.post({continue: true, resume_plan: fromSaved.resume_plan});
  assert.deepEqual(recompacted.resume_plan, fromSaved.resume_plan);
});

test('fresh runs, unrelated requests and old order-only hints preserve existing behavior', async () => {
  const b = browser();
  for (const [body, url] of [[{continue: false}, '/api/plan'], [{continue: true}, '/api/optimizer-stop'],
    [{continue: true}, 'https://different.invalid/api/plan']]) {
    assert.deepEqual(await b.post(body, url), body);
  }
  const old = await b.post({continue: true, resume_plan: {order_sequence: ['O'], duration_minutes: 1}});
  assert.deepEqual(old.resume_plan, {order_sequence: ['O']});
  const foreign = project(); foreign.lastPlan.operations[0].equipment_ids = ['FOREIGN'];
  assert.equal((await browser(publicIife, foreign).post({continue: true})).resume_plan, undefined);
});

test('exact patch is reversible, idempotent and rejects partial or drifted source', () => {
  const patched = patchSelectedGenomeUi(publicIife);
  assert.equal(patchSelectedGenomeUi(patched), patched);
  assert.throws(() => patchSelectedGenomeUi(publicIife.replace('hint={order_sequence:ordered};', 'hint={order_sequence:[]};')), /SOURCE_DRIFT/);
  assert.throws(() => patchSelectedGenomeUi(patched.replace('ppSelectedBatchGenome(existing,ownProject,ordered)', 'null')), /SOURCE_DRIFT/);
  new vm.Script(patched);
});

test('CLI writes only the transformed standalone UI file and is idempotent', () => {
  const root = mkdtempSync(join(tmpdir(), 'selected-genome-ui-'));
  try {
    const before = join(root, 'before.js'), after = join(root, 'after.js'), again = join(root, 'again.js');
    writeFileSync(before, '/* unrelated prefix */\n' + publicIife + '\n/* unrelated suffix */');
    const cli = fileURLToPath(new URL('./patch_ui.mjs', import.meta.url));
    const first = execFileSync(process.execPath, [cli, before, after], {encoding: 'utf8'});
    const second = execFileSync(process.execPath, [cli, after, again], {encoding: 'utf8'});
    assert(first.includes('"changed":true'));
    assert(second.includes('"changed":false'));
    assert.equal(readFileSync(again, 'utf8'), readFileSync(after, 'utf8'));
    assert(readFileSync(after, 'utf8').startsWith('/* unrelated prefix */\n'));
    assert(readFileSync(after, 'utf8').endsWith('\n/* unrelated suffix */'));
  } finally {rmSync(root, {recursive: true, force: true});}
});

const actualFixture = process.env.LIFTORBIT_SELECTED_GENOME_UI_FIXTURE ||
  '/tmp/liftorbit-units-utilization-20261124/pp-restart-optimizer-ui.js';
test('actual captured continuation IIFE keeps the explicitly selected mixed partition',
  {skip: !existsSync(actualFixture)}, async () => {
    const source = readFileSync(actualFixture, 'utf8');
    const patched = patchSelectedGenomeUi(source);
    assert.equal(patchSelectedGenomeUi(patched), patched);
    new vm.Script(patched);
    const b = browser(continuationIife(source));
    const out = await b.post({continue: true, resume_plan: plan([10, 5, 10, 5])});
    assert.deepEqual(out.resume_plan.batch_genome.partitions[0].sizes, [10, 5, 10, 5]);
  });
