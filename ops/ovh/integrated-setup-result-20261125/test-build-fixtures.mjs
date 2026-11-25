import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {ppCanonicalNativeResult} from './canonical.mjs';
import {ppCompleteSyntheticNativeBuildFixture, patchUpstreamBuildFixture, patchStateBuildFixture,
  patchBuildFixtures, BUILD_FIXTURE_FILES} from './build-fixtures.mjs';

const upstreamDeclaration = '  const plan={ok:true,valid:true,operations:m.orders.map(x=>({order:x.id})),setup_rules_processed:false};';
const stateDeclaration = '   worker.set(id,{status:"completed",result:{valid:true,operations:[{order:"OA1"}],resume_state:{completed_runs:1}}});';
const model = {orders: [{id: 'OA1'}, {id: 'OA2'}], equipment: [{id: 'E1'}], setup_rules: [{id: 'S', duration_min: 10}]};
function upstreamSource(declaration = upstreamDeclaration) {
  return `// unchanged public fixture prefix
function makeEnv({hold=false,foreign=false,outage=false}={}){
 const fetchStub=async(url,opts)=>{
  const j={model:models.get('A0'),status:hold?'running':'completed'};
  const m=foreign?models.get('A9'):j.model;
${declaration}
  return Response.json({status:j.status,progress:100,result:j.status==='completed'?plan:null,best_preview:null});
 };
 const bridge=createPythonGAUpstream({fetchImpl:fetchStub});
 return {bridge,fetchStub};
}
// All later existing assertions stay byte-identical.
`;
}
function stateSource(declaration = stateDeclaration) {
  return `// unchanged public persistence fixture prefix
function harness({storeBroken=false}={}){
 const worker=new Map();
 const fetchImpl=async(url,opts)=>{
   const id='job';
${declaration}
   return Response.json({job_id:id},{status:202});
 };
 const create=()=>createPythonGAUpstream({fetchImpl});
 return {create,worker,fetchImpl};
}
// All later existing assertions stay byte-identical.
`;
}
async function upstreamPlan(source, foreign = false) {
  const models = new Map([['A0', model], ['A9', {orders: [{id: 'FOREIGN'}], equipment: [{id: 'FOREIGN-EQ'}]}]]);
  const make = new Function('models', 'createPythonGAUpstream', source + '\nreturn makeEnv;')(models, value => value);
  return (await (await make({foreign}).fetchStub()).json()).result;
}

test('original declaration and all surrounding assertions survive byte-identically with a pinned SHA', async () => {
  const assertions = "test('public ownership assertion',()=>{ const bridge=createPythonGAUpstream({}); assert.equal(result.status,200); });\n";
  const before = upstreamSource() + assertions;
  const after = patchUpstreamBuildFixture(before);
  assert(after.includes(upstreamDeclaration));
  const sha = createHash('sha256').update(upstreamDeclaration).digest('hex');
  assert(after.includes(':upstream:' + sha + '\n' + upstreamDeclaration));
  assert.equal(after.slice(0, after.indexOf('  // pp_integrated')), before.slice(0, before.indexOf(upstreamDeclaration)));
  assert(after.endsWith(before.slice(before.indexOf(upstreamDeclaration) + upstreamDeclaration.length)));
  assert(after.endsWith(assertions));
  const plan = await upstreamPlan(patchUpstreamBuildFixture(upstreamSource()));
  assert.equal(plan.setup_rules_processed, false, 'an existing explicit false is not rewritten');
  const full = ppCanonicalNativeResult(plan, model, 'model');
  assert(full);
  assert.deepEqual(full.operations.map(row => [row.order, row.equipment_ids, row.start_min, row.end_min]),
    [['OA1', ['E1'], 0, 1], ['OA2', ['E1'], 1, 2]]);
  assert.equal(full.duration_minutes, 2);
  assert.deepEqual(full.setup_operations, []);
});

test('expanded and reformatted factory declarations retain their explicit values and source', async () => {
  const declaration = `  const plan = {
    ok: true, valid: true, objective: 'duration', duration_minutes: 4,
    operations: m.orders.map(x => ({ order: x.id, duration_min: 2, equipment_ids: ['EXPLICIT-EQ'] })),
    history_best: [4], setup_rules_processed: false, extra: {sentinel: 'preserved;{}'}
  };`;
  const source = upstreamSource(declaration).replace('const m=foreign?', 'const m = foreign ?');
  const after = patchUpstreamBuildFixture(source);
  assert(after.includes(declaration));
  const plan = await upstreamPlan(after);
  assert.deepEqual(plan.history_best, [4]);
  assert.equal(plan.duration_minutes, 4);
  assert.equal(plan.extra.sentinel, 'preserved;{}');
  assert.deepEqual(plan.operations.map(row => [row.start_min, row.end_min, row.equipment_ids]),
    [[0, 2, ['EXPLICIT-EQ']], [2, 4, ['EXPLICIT-EQ']]]);
  assert(ppCanonicalNativeResult(plan, model, 'model'));
  assert.equal(patchUpstreamBuildFixture(after), after);
});

test('unchanged mock reply supports field reordering and alternate plan construction', async () => {
  const declaration = '  const plan={ok:true,valid:true,operations:Array.from(m.orders,x=>({order:x.id})),setup_rules_processed:false};';
  const originalReply = "return Response.json({status:j.status,progress:100,result:j.status==='completed'?plan:null,best_preview:null});";
  const reorderedReply = "return Response.json({progress:100,best_preview:null,result:plan,status:j.status});";
  const source = upstreamSource(declaration).replace(originalReply, reorderedReply);
  const after = patchUpstreamBuildFixture(source);
  assert(after.includes(declaration));
  assert(after.includes(reorderedReply));
  assert.equal(patchUpstreamBuildFixture(after), after);
  assert(ppCanonicalNativeResult(await upstreamPlan(after), model, 'model'));
  assert.throws(() => patchUpstreamBuildFixture(source.replace(reorderedReply,
    "plan.operations=[]; " + reorderedReply)), /UPSTREAM_RESPONSE_GUARD/);
  assert.throws(() => patchUpstreamBuildFixture(source.replace(reorderedReply,
    "return Response.json({result:'plan',status:j.status});")), /UPSTREAM_PLAN_REFERENCE_GUARD/);
  assert.throws(() => patchUpstreamBuildFixture(source.replace('function makeEnv(', 'function unrelatedFactory(')), /SOURCE_DRIFT/);
});

test('tenant-selected foreign IDs and existing equipment IDs are never repaired or rewritten', async () => {
  const plan = await upstreamPlan(patchUpstreamBuildFixture(upstreamSource()), true);
  assert.equal(plan.operations[0].order, 'FOREIGN');
  assert.deepEqual(plan.operations[0].equipment_ids, ['FOREIGN-EQ']);
  assert(!plan.operations.every(row => model.orders.some(order => order.id === row.order)));
  const own = {valid: true, operations: [{order: 'WRONG-ORDER', equipment_id: 'WRONG-EQ'}]};
  ppCompleteSyntheticNativeBuildFixture(own, model);
  assert.equal(own.operations[0].order, 'WRONG-ORDER');
  assert.deepEqual(own.operations[0].equipment_ids, ['WRONG-EQ']);
});

test('explicit invalid flags, intervals, metrics and failure evidence stay invalid', () => {
  const cases = [
    {valid: false, operations: [{order: 'OA1'}]},
    {valid: true, ok: false, operations: [{order: 'OA1'}]},
    {valid: true, partial: true, operations: [{order: 'OA1'}]},
    {valid: true, errors: ['existing-error'], operations: [{order: 'OA1'}]},
    {valid: true, duration_minutes: 0, operations: [{order: 'OA1'}]},
    {valid: true, operator_wait_minutes: false, operations: [{order: 'OA1'}]},
    {valid: true, setup_count: 3, operations: [{order: 'OA1'}]},
    {valid: true, operations: [{order: 'OA1', start_min: -1, end_min: 1}]},
    {valid: true, operations: [{order: 'OA1', start_min: 3, end_min: 1}]},
    {valid: true, operations: [{order: 'OA1', start_min: null, end_min: 1}]},
  ];
  for (const plan of cases) {
    const original = structuredClone(plan);
    ppCompleteSyntheticNativeBuildFixture(plan, model);
    for (const key of Object.keys(original).filter(key => key !== 'operations')) assert.deepEqual(plan[key], original[key]);
    for (const key of Object.keys(original.operations[0])) assert.deepEqual(plan.operations[0][key], original.operations[0][key]);
    assert.equal(ppCanonicalNativeResult(plan, model, 'model'), null);
  }
});

test('state fixture preserves original worker.set and resume metadata while adding omitted data', async () => {
  const after = patchStateBuildFixture(stateSource());
  assert(after.includes(stateDeclaration));
  const make = new Function('model', 'createPythonGAUpstream', after + '\nreturn harness;')(model, value => value);
  const harness = make();
  await harness.fetchImpl();
  const stored = harness.worker.get('job');
  assert.equal(stored.status, 'completed');
  assert.deepEqual(stored.result.resume_state, {completed_runs: 1});
  const full = ppCanonicalNativeResult(stored.result, model, 'state-model');
  assert(full);
  assert.equal(full.duration_minutes, 1);
  assert.equal(full.batch_count, 1);
  assert.equal(full.setup_operation_count, 0);
});

test('factory guards, syntax, original SHA and injected helper bytes all fail closed on drift', () => {
  for (const [fn, source, original] of [[patchUpstreamBuildFixture, upstreamSource(), upstreamDeclaration],
                                     [patchStateBuildFixture, stateSource(), stateDeclaration]]) {
    const updated = fn(source);
    assert.equal(fn(updated), updated);
    assert.throws(() => fn(source + source), /SOURCE_DRIFT/);
    assert.throws(() => fn(updated.replace('cursor = 0;', 'cursor = 100;')), /INSTALL_DRIFT/);
    assert.throws(() => fn(updated.replace(original, original.replace('true', 'false'))), /INSTALL_DRIFT/);
    assert.throws(() => fn(source.replace('createPythonGAUpstream', 'unknownFactory')), /SOURCE_DRIFT/);
  }
  assert.throws(() => patchUpstreamBuildFixture(upstreamSource(upstreamDeclaration.replace('};', '];'))), /SOURCE_DRIFT/);
  assert.throws(() => patchUpstreamBuildFixture(upstreamSource(upstreamDeclaration.replace('};', '}, anotherBinding=1;'))), /SOURCE_DRIFT/);
  assert.throws(() => patchUpstreamBuildFixture(upstreamSource().replace("models.get('A9')", "models.get('A0')")), /SOURCE_DRIFT/);
  const files = {[BUILD_FIXTURE_FILES[0]]: upstreamSource(), [BUILD_FIXTURE_FILES[1]]: stateSource()};
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
