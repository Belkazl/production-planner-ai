import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {ppCanonicalNativeResult} from './canonical.mjs';
import {patchUpstreamBuildFixture, patchStateBuildFixture, patchBuildFixtures, BUILD_FIXTURE_FILES} from './build-fixtures.mjs';

const upstreamFixture = '  const plan={ok:true,valid:true,operations:m.orders.map(x=>({order:x.id})),setup_rules_processed:false};';
const stateFixture = '   worker.set(id,{status:"completed",result:{valid:true,operations:[{order:"OA1"}],resume_state:{completed_runs:1}}});';
const model = {orders: [{id: 'OA1'}, {id: 'OA2'}], equipment: [{id: 'E1'}], setup_rules: [{id: 'S', duration_min: 10}]};

test('modernized account fixture supplies full native intervals and keeps tenant-selected IDs', () => {
  const before = '// unchanged prefix\n' + upstreamFixture + '\nassert.equal(result.status,200);\n// unchanged suffix';
  const after = patchUpstreamBuildFixture(before);
  assert.equal(after.slice(0, after.indexOf('  // pp_integrated')), '// unchanged prefix\n');
  assert(after.endsWith('\nassert.equal(result.status,200);\n// unchanged suffix'));
  const body = patchUpstreamBuildFixture(upstreamFixture) + '\nreturn plan;';
  const plan = new Function('m', body)(model);
  const full = ppCanonicalNativeResult(plan, model, 'model');
  assert(full);
  assert.deepEqual(full.operations.map(row => [row.order, row.equipment_ids, row.start_min, row.end_min]),
    [['OA1', ['E1'], 0, 1], ['OA2', ['E1'], 1, 2]]);
  assert.equal(full.duration_minutes, 2);
  assert.deepEqual(full.setup_operations, []);
  const foreign = new Function('m', body)({orders: [{id: 'OTHER'}], equipment: [{id: 'OTHER-EQ'}]});
  assert.equal(foreign.operations[0].order, 'OTHER');
  assert.deepEqual(foreign.operations[0].equipment_ids, ['OTHER-EQ']);
  assert(!foreign.operations.every(row => model.orders.some(order => order.id === row.order)));
});

test('modernized persistence fixture preserves resume payload and supplies coherent zero-setup plan', () => {
  const worker = new Map();
  new Function('worker', 'id', patchStateBuildFixture(stateFixture))(worker, 'job');
  const stored = worker.get('job');
  assert.equal(stored.status, 'completed');
  assert.deepEqual(stored.result.resume_state, {completed_runs: 1});
  const full = ppCanonicalNativeResult(stored.result, {orders: [{id: 'OA1'}]}, 'state-model');
  assert(full);
  assert.equal(full.duration_minutes, 1);
  assert.equal(full.batch_count, 1);
  assert.equal(full.setup_operation_count, 0);
});

test('fixture replacements are exact, idempotent and fail before either unknown source can be written', () => {
  for (const [fn, source] of [[patchUpstreamBuildFixture, upstreamFixture], [patchStateBuildFixture, stateFixture]]) {
    const updated = fn(source);
    assert.equal(fn(updated), updated);
    assert.throws(() => fn(source + '\n' + source), /SOURCE_DRIFT/);
    assert.throws(() => fn(updated.replace('duration_minutes:', 'renamed_duration:')), /INSTALL_DRIFT/);
  }
  const files = {[BUILD_FIXTURE_FILES[0]]: upstreamFixture, [BUILD_FIXTURE_FILES[1]]: stateFixture};
  assert.deepEqual(Object.keys(patchBuildFixtures(files)), BUILD_FIXTURE_FILES);
  assert.throws(() => patchBuildFixtures({...files, [BUILD_FIXTURE_FILES[1]]: '// unknown fixture'}), /SOURCE_DRIFT/);
});

const actualRoot = process.env.LIFTORBIT_INTEGRATED_BUILD_FIXTURE_ROOT;
test('existing full app ownership and persistence build assertions pass unchanged with complete native fixtures', {skip: !actualRoot}, () => {
  const root = resolve(actualRoot);
  const runtime = readFileSync(join(root, 'python-ga-upstream.mjs'), 'utf8');
  assert(runtime.includes('pp_integrated_native_setup_20261125'), 'requires actual staged canonical native bridge');
  const inputs = Object.fromEntries(BUILD_FIXTURE_FILES.map(name => [name, readFileSync(join(root, name), 'utf8')]));
  const updated = patchBuildFixtures(inputs);
  const directory = mkdtempSync(join(tmpdir(), 'integrated-build-fixture-test-'));
  try {
    mkdirSync(join(directory, 'tests'), {mode: 0o700});
    writeFileSync(join(directory, 'python-ga-upstream.mjs'), runtime, {mode: 0o600});
    writeFileSync(join(directory, 'ga-python-state-store.mjs'), readFileSync(join(root, 'ga-python-state-store.mjs')), {mode: 0o600});
    for (const name of BUILD_FIXTURE_FILES) writeFileSync(join(directory, name), updated[name], {mode: 0o600});
    const result = spawnSync(process.execPath, ['--test', ...BUILD_FIXTURE_FILES], {
      cwd: directory, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024,
      env: {PATH: process.env.PATH || '', TMPDIR: directory}
    });
    // Actual source/test output stays private; only this fixed assertion reports.
    assert.equal(result.status, 0, 'existing ownership and persistence build assertions failed');
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});
