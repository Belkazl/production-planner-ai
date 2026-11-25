import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {ppCanonicalNativeResult, ppNativeScheduleFingerprint} from '../integrated-setup-result-20261125/canonical.mjs';
import {CANONICAL_SITE_COUNT, INPUT_FILES, PUBLIC_TEST_NAMES, diagnoseBuild, instrumentUpstream,
  parseTelemetry, summarizeTestLog} from './diagnose-build.mjs';

const model = {orders: [{id: 'A'}], equipment: [{id: 'M'}], setup_rules: []};
const valid = () => ({ok: true, valid: true, duration_minutes: 10, batch_count: 1,
  operator_wait_minutes: 0, machine_idle_minutes: 0, setup_operations: [],
  operations: [{order: 'A', operation_id: 'WORK', batch: 1, start_min: 0, end_min: 10,
    equipment_ids: ['M'], employee_ids: []}]});
const secret = 'PRIVATE_TEST_SENTINEL_MUST_NEVER_BE_EXPORTED';

function source() {
  return [ppNativeScheduleFingerprint.toString(), ppCanonicalNativeResult.toString(),
    'export function createPythonGAUpstream({plan,model,error}) {',
    ' return {fetch:async()=>{const result=ppCanonicalNativeResult(plan,model,"synthetic");',
    ' return Response.json(result?{result}:{error:error||"native_schedule_contract_invalid"},{status:result?200:409})},',
    ' cancel:async()=>({http_status:409,error:"job_mismatch"})};',
    '}',
    'export {ppCanonicalNativeResult};'].join('\n');
}
function appFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'pp-public-build-diagnostic-test-'));
  const app = join(directory, 'app'), report = join(directory, 'report.json');
  mkdirSync(app); mkdirSync(join(app, 'tests'));
  for (const name of INPUT_FILES)
    writeFileSync(join(app, name), name === INPUT_FILES[0] ? source() : '// unchanged synthetic file\n');
  const originals = new Map(INPUT_FILES.map(name => [name, readFileSync(join(app, name))]));
  return {directory, app, report, originals};
}

test('private replay observes exact public sites and HTTP shapes while all original sources stay unchanged', () => {
  const fixture = appFixture();
  try {
    let temporaryApp;
    const report = diagnoseBuild(fixture.app, fixture.report, {runner(command, args, options) {
      assert.equal(command, 'bun');
      assert.deepEqual(args, ['test', 'tests/python-ga-upstream.test.mjs', 'tests/python-ga-state.test.mjs']);
      assert.deepEqual(options.env, {PATH: '/usr/local/bin:/usr/bin:/bin', TMPDIR: '/tmp'});
      temporaryApp = options.cwd;
      for (const name of INPUT_FILES.slice(1))
        assert.deepEqual(readFileSync(join(options.cwd, name)), fixture.originals.get(name));
      const script = [
        'import {createPythonGAUpstream,ppCanonicalNativeResult} from "./python-ga-upstream.mjs";',
        'const model=' + JSON.stringify(model) + ',good=' + JSON.stringify(valid()) + ';',
        'const broken=structuredClone(good);broken.operations[0].start_min=-1;',
        'await createPythonGAUpstream({plan:good,model}).fetch(new Request("https://synthetic.test/api/plan"));',
        'await createPythonGAUpstream({plan:broken,model}).fetch(new Request("https://synthetic.test/api/plan-progress"));',
        'await createPythonGAUpstream({plan:good,model}).cancel(new Request("https://synthetic.test/api/stop-optimization"));',
        'await createPythonGAUpstream({plan:null,model,error:' + JSON.stringify(secret) + '}).fetch(new Request("https://synthetic.test/api/model"));',
        'const unknown=structuredClone(good);Object.defineProperty(unknown,"valid",{get(){throw Error(' + JSON.stringify(secret) + ')}});',
        'ppCanonicalNativeResult(unknown,model,"synthetic");'
      ].join('\n');
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: options.cwd, env: options.env, timeout: 10000, maxBuffer: 262144
      });
      assert.equal(result.status, 0);
      return {...result, status: 1, stderr: Buffer.from(
        '(fail) ' + PUBLIC_TEST_NAMES[1] + ' [1.00ms]\n(fail) ' + secret + ' [2.00ms]\n' + secret)};
    }});
    assert.equal(report.diagnostic_completed, true);
    assert.equal(report.original_app_unchanged, true);
    assert.equal(report.test_exit_code, 1);
    assert.equal(report.failure_code, null);
    assert.deepEqual(report.canonical_rejections, [{site: 1, count: 1}, {site: 20, count: 2}]);
    assert.deepEqual(report.canonical_errors, [{code: 'interval', count: 1}, {code: 'unknown', count: 1}]);
    assert.deepEqual(report.failed_tests, [PUBLIC_TEST_NAMES[1]]);
    assert.equal(report.unknown_failed_test_count, 1);
    assert.equal(report.route_summaries.length, 4);
    assert.deepEqual(report.route_summaries[0], {kind: 'fetch', route: 'plan', status: 200,
      error: null, has_result: true, result_valid: true, result_operations: 1,
      has_best: false, best_valid: false, best_operations: 0, count: 1});
    assert.equal(report.route_summaries[1].error, 'native_schedule_contract_invalid');
    assert.equal(report.route_summaries[2].kind, 'cancel');
    assert.equal(report.route_summaries[2].error, 'job_mismatch');
    assert.equal(report.route_summaries[3].error, 'unknown');
    const saved = readFileSync(fixture.report, 'utf8');
    assert.equal(saved.includes(secret), false);
    assert.equal(saved.includes(temporaryApp), false);
    assert.deepEqual(JSON.parse(saved), report);
    for (const [name, original] of fixture.originals)
      assert.deepEqual(readFileSync(join(fixture.app, name)), original);
    assert.throws(() => readFileSync(join(temporaryApp, INPUT_FILES[0])), {code: 'ENOENT'});
  } finally { rmSync(fixture.directory, {recursive: true, force: true}); }
});

test('instrumentation refuses source drift and numbers every return without altering public canonical source', () => {
  const original = ppCanonicalNativeResult.toString(), instrumented = instrumentUpstream(source());
  assert.equal((instrumented.match(/return __ppDiagnosticReject\([0-9]+\);/g) || []).length, CANONICAL_SITE_COUNT);
  assert.match(instrumented, /catch \(__ppDiagnosticCaught\) \{ __ppDiagnosticError\(__ppDiagnosticCaught\); return __ppDiagnosticReject\(20\); \}/);
  assert.equal(ppCanonicalNativeResult.toString(), original);
  assert.throws(() => instrumentUpstream(source().replace(original,
    original.replace('return null;', 'return undefined;'))), /canonical_source_mismatch/);
  assert.throws(() => instrumentUpstream(source() + '\n' + original), /canonical_source_mismatch/);
});

test('KPI rejection reports every missing or invalid required field as enums without values or arbitrary phase', () => {
  const fixture = appFixture();
  try {
    const report = diagnoseBuild(fixture.app, fixture.report, {runner(command, args, options) {
      const script = [
        'import {ppCanonicalNativeResult} from "./python-ga-upstream.mjs";',
        'const model=' + JSON.stringify(model) + ',good=' + JSON.stringify(valid()) + ';',
        'const first=structuredClone(good);delete first.duration_minutes;first.batch_count=null;',
        'first.operator_wait_minutes=' + JSON.stringify(secret) + ';first.machine_idle_minutes=false;',
        'first.phase=' + JSON.stringify(secret) + ';first.operations.length=100001;',
        'ppCanonicalNativeResult(first,model,"synthetic");',
        'const second=structuredClone(good);second.duration_minutes=-1;second.batch_count=[];',
        'second.operator_wait_minutes={};second.machine_idle_minutes=undefined;second.phase="running";',
        'ppCanonicalNativeResult(second,model,"synthetic");',
        'ppCanonicalNativeResult(good,model,"synthetic");'
      ].join('\n');
      return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: options.cwd, env: options.env, timeout: 10000, maxBuffer: 262144
      });
    }});
    assert.equal(report.diagnostic_completed, true);
    assert.equal(report.original_app_unchanged, true);
    assert.deepEqual(report.canonical_rejections, [{site: 3, count: 2}]);
    assert.deepEqual(report.canonical_errors, []);
    assert.deepEqual(report.canonical_metric_rejections, [
      ...[['duration_minutes', 'absent'], ['batch_count', 'null'],
        ['operator_wait_minutes', 'string'], ['machine_idle_minutes', 'boolean']]
        .map(([field, type]) => ({field, type, valid_true: true, operation_count: 100000, phase: 'unknown', count: 1})),
      ...[['duration_minutes', 'number'], ['batch_count', 'array'],
        ['operator_wait_minutes', 'object'], ['machine_idle_minutes', 'absent']]
        .map(([field, type]) => ({field, type, valid_true: true, operation_count: 1, phase: 'running', count: 1}))
    ]);
    assert.equal(readFileSync(fixture.report, 'utf8').includes(secret), false);
  } finally { rmSync(fixture.directory, {recursive: true, force: true}); }
});

test('telemetry and test-log projection admit fixed public values only', () => {
  for (const text of [
    '["installed"]\n["error",' + JSON.stringify(secret) + ']\n',
    '["installed"]\n["reject",21]\n',
    '["installed"]\n["metric",' + JSON.stringify(secret) + ',"absent",true,1,"running"]\n',
    '["installed"]\n["metric","batch_count","absent",true,1,' + JSON.stringify(secret) + ']\n',
    '["installed"]\n["route","fetch","plan",409,' + JSON.stringify(secret) + ',false,false,0,false,false,0]\n'
  ]) assert.throws(() => parseTelemetry(text), /telemetry_contract/);
  const facts = summarizeTestLog('(fail) ' + secret + ' [1.00ms]\n(fail) ' + PUBLIC_TEST_NAMES[0] + ' [2ms]\n');
  assert.deepEqual(facts.failed_tests, [PUBLIC_TEST_NAMES[0]]);
  assert.equal(facts.unknown_failed_test_count, 1);
  assert.equal(JSON.stringify(facts).includes(secret), false);
});

test('failed runner reports a fixed code and still proves source preservation', () => {
  const fixture = appFixture();
  try {
    const report = diagnoseBuild(fixture.app, fixture.report, {runner() {
      return {status: null, error: Object.assign(new Error(secret), {code: 'ETIMEDOUT'}),
        stdout: Buffer.from(secret), stderr: Buffer.from(secret)};
    }});
    assert.equal(report.diagnostic_completed, false);
    assert.equal(report.original_app_unchanged, true);
    assert.equal(report.failure_code, 'runner_timeout');
    assert.equal(JSON.stringify(report).includes(secret), false);
  } finally { rmSync(fixture.directory, {recursive: true, force: true}); }
});
