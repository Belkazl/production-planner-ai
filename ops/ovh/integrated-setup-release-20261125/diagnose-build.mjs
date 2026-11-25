/** Private, synthetic-only diagnostic replay. Never an acceptance gate. */
import {constants, closeSync, fstatSync, lstatSync, mkdirSync, mkdtempSync,
  openSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {basename, dirname, join, resolve, sep} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ppCanonicalNativeResult} from '../integrated-setup-result-20261125/canonical.mjs';

export const FORMAT = 'integrated-setup-build-diagnostic-v1';
export const INPUT_FILES = Object.freeze(['python-ga-upstream.mjs', 'ga-python-state-store.mjs',
  'tests/python-ga-upstream.test.mjs', 'tests/python-ga-state.test.mjs']);
export const TEST_FILES = Object.freeze(INPUT_FILES.slice(2));
export const PUBLIC_TEST_NAMES = Object.freeze([
  'disabled follows existing upstream including request options',
  'ten real upstream requests route account models to distinct jobs',
  'worker cannot replace schedule with foreign orders',
  'stop one job without stopping other sessions',
  'down worker fails closed without fallback to shared Python GA',
  'unrelated model route still uses the original authenticated API',
  'manual operation locks are passed through to original GA unchanged',
  'progress remains account-scoped while legacy GA is running',
  'state is written and a fresh Bun bridge restores the completed plan',
  'persistence failure fails closed and cancels the remote worker',
  'state store cannot point at a public database or accept weak internal secrets'
]);
export const CANONICAL_SITE_COUNT = 20;
export const CANONICAL_ERRORS = Object.freeze([
  'interval', 'setup_kind', 'setup_interval', 'duration', 'conflicting_row', 'duplicate_row', 'unknown'
]);
export const REQUIRED_METRICS = Object.freeze([
  'duration_minutes', 'batch_count', 'operator_wait_minutes', 'machine_idle_minutes'
]);
export const METRIC_TYPES = Object.freeze(['absent', 'null', 'string', 'boolean', 'number', 'array', 'object']);
export const INPUT_PHASES = Object.freeze([
  'absent', 'starting', 'optimizing', 'running', 'complete', 'completed', 'cancelled', 'failed', 'timed_out', 'unknown'
]);
export const RESPONSE_ERRORS = Object.freeze([
  'native_schedule_contract_invalid', 'authentication_or_model_unavailable', 'account_model_not_ready',
  'ga_state_unavailable', 'invalid_ga_options', 'ga_options_too_large', 'optimization_running_stop_first',
  'ga_worker_unavailable', 'account_model_changed_during_run', 'account_model_changed_since_run',
  'account_plan_mismatch', 'optimization_stopped', 'ga_worker_timeout', 'ga_worker_interrupted',
  'job_mismatch', 'invalid_job_id', 'optimization_not_running', 'worker_cancel_failed',
  'continuation_seed_missing_or_invalid', 'ga_worker_failed', 'ga_worker_timed_out', 'unknown'
]);
export const FAILURE_CODES = Object.freeze([
  'source_path', 'source_file', 'source_changed', 'canonical_source_mismatch',
  'canonical_instrumentation_contract', 'upstream_export_contract', 'temporary_copy',
  'runner_unavailable', 'runner_timeout', 'runner_output_limit', 'runner_failed',
  'telemetry_contract', 'telemetry_size', 'test_source_changed', 'unexpected'
]);
const MAX_FILE = 4 * 1024 * 1024, MAX_LOG = 2 * 1024 * 1024, MAX_EVENTS = 10000;
const HELPER_FILE = 'pp-build-diagnostic-helper.mjs';
const MARKER = '__ppIntegratedSetupBuildDiagnosticV1';
const sha = value => createHash('sha256').update(value).digest('hex');
class DiagnosticError extends Error {}
function need(ok, code) { if (!ok) throw new DiagnosticError(code); }
const count = value => Number.isInteger(value) && value >= 0 && value <= 1000000;
const status = value => value === null || Number.isInteger(value) && value >= 100 && value <= 599;

// Fixed public site meanings, in source order:
// 1 input, 2 legacy markers, 3 KPIs, 4 validation arrays, 5 resume duration,
// 6 diagnostic duration, 7 history, 8 primary rows, 9 detached type,
// 10 detached size, 11 missing setup evidence, 12 empty/inline conflict,
// 13 no production, 14 generic identity, 15 combined size, 16 detached coverage,
// 17 setup counts, 18 setup minutes, 19 fingerprint, 20 caught validation error.
export function instrumentUpstream(source) {
  const original = ppCanonicalNativeResult.toString();
  const tail = '  } catch { return null; }\n}';
  need((original.match(/return null;/g) || []).length === CANONICAL_SITE_COUNT &&
    original.endsWith(tail) &&
    JSON.stringify([...original.matchAll(/throw Error\('([a-z_]+)'\)/g)].map(match => match[1])) ===
      JSON.stringify(CANONICAL_ERRORS.slice(0, -1)), 'canonical_instrumentation_contract');
  need(typeof source === 'string' && source.split(original).length === 2 &&
    !source.includes(MARKER), 'canonical_source_mismatch');
  const metricCheck = 'if (!numeric(plan[key])) return null;';
  need(original.split(metricCheck).length === 2, 'canonical_instrumentation_contract');
  const declaration = 'export function createPythonGAUpstream(';
  need(source.split(declaration).length === 2, 'upstream_export_contract');
  let site = 0;
  let instrumented = original.replace(tail,
    '  } catch (__ppDiagnosticCaught) { __ppDiagnosticError(__ppDiagnosticCaught); return null; }\n}');
  instrumented = instrumented.replace(metricCheck,
    'if (!numeric(plan[key])) { __ppDiagnosticMetrics(plan); return null; }');
  instrumented = instrumented.replaceAll('return null;', () => 'return __ppDiagnosticReject(' + (++site) + ');');
  need(site === CANONICAL_SITE_COUNT, 'canonical_instrumentation_contract');
  const imports = '// ' + MARKER + '\nimport {reject as __ppDiagnosticReject, recordError as __ppDiagnosticError, ' +
    'recordMetrics as __ppDiagnosticMetrics, wrapBridge as __ppDiagnosticWrap} from "./' + HELPER_FILE + '";\n';
  return imports + source.replace(original, instrumented)
    .replace(declaration, 'function __ppDiagnosticOriginalFactory(') +
    '\nexport function createPythonGAUpstream(...args) {\n' +
    '  return __ppDiagnosticWrap(__ppDiagnosticOriginalFactory.apply(this,args));\n}\n';
}

// This function becomes a private helper module. It emits only values from the
// closed enums above, booleans and bounded counts; no response/source is logged.
function diagnosticRuntime(append, telemetryPath, canonicalErrors, responseErrors, maxEvents,
  metricFields, metricTypes, inputPhases) {
  let written = 0;
  function emit(row) {
    try {
      if (written >= maxEvents) {
        if (written === maxEvents) append(telemetryPath, '["truncated"]\n');
        written++;
        return;
      }
      append(telemetryPath, JSON.stringify(row) + '\n');
      written++;
    } catch {}
  }
  function reject(site) { emit(['reject', site]); return null; }
  function recordError(error) {
    let code = 'unknown';
    try { if (canonicalErrors.includes(error?.message)) code = error.message; } catch {}
    emit(['error', code]);
  }
  function recordMetrics(plan) {
    // The canonical loop stops at its first invalid KPI. Observe every invalid
    // required field at that rejection, so a missing count cannot hide the
    // missing wait/idle fields. Only enum types and bounded shape facts leave.
    try {
      const rawPhase = plan.phase;
      const phase = rawPhase == null ? 'absent' : inputPhases.includes(rawPhase) ? rawPhase : 'unknown';
      const operations = Array.isArray(plan.operations) ? Math.min(100000, plan.operations.length) : 0;
      for (const field of metricFields) {
        const value = plan[field];
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) continue;
        const type = value === undefined ? 'absent' : value === null ? 'null' :
          Array.isArray(value) ? 'array' : typeof value;
        if (metricTypes.includes(type))
          emit(['metric', field, type, plan.valid === true, operations, phase]);
      }
    } catch {}
  }
  async function bodyOf(response) {
    const reader = response.clone().body?.getReader();
    if (!reader) return null;
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 262144) {
          void reader.cancel().catch(() => {});
          return null;
        }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch { return null; }
  }
  async function observe(kind, request, returned) {
    try {
      let route = 'other';
      try {
        const path = new URL(request?.url).pathname;
        route = path === '/api/plan' ? 'plan' : path === '/api/plan-progress' ? 'progress' :
          path === '/api/model' ? 'model' : 'other';
      } catch {}
      const response = returned instanceof Response;
      const body = response ? await bodyOf(returned) : returned;
      const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
      const rawStatus = response ? returned.status : body?.http_status;
      const httpStatus = Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599 ? rawStatus : null;
      const error = body?.error == null ? null : responseErrors.includes(body.error) ? body.error : 'unknown';
      const result = object(body?.result) ? body.result : object(body) && Array.isArray(body.operations) ? body : null;
      const best = object(body?.best_preview) ? body.best_preview : null;
      const operations = plan => Array.isArray(plan?.operations) ? Math.min(100000, plan.operations.length) : 0;
      emit(['route', kind, route, httpStatus, error, !!result, result?.valid === true, operations(result),
        !!best, best?.valid === true, operations(best)]);
    } catch {}
  }
  function wrapBridge(bridge) {
    for (const kind of ['fetch', 'cancel']) {
      if (typeof bridge?.[kind] !== 'function') continue;
      const original = bridge[kind];
      bridge[kind] = async function (...args) {
        const result = await original.apply(this, args);
        await observe(kind, args[0], result);
        return result;
      };
    }
    return bridge;
  }
  emit(['installed']);
  return {reject, recordError, recordMetrics, wrapBridge};
}

function helperSource(telemetryPath) {
  return 'import {appendFileSync} from "node:fs";\nconst __ppRuntime=(' + diagnosticRuntime.toString() +
    ')(appendFileSync,' + JSON.stringify(telemetryPath) + ',' + JSON.stringify(CANONICAL_ERRORS) + ',' +
    JSON.stringify(RESPONSE_ERRORS) + ',' + MAX_EVENTS + ',' + JSON.stringify(REQUIRED_METRICS) + ',' +
    JSON.stringify(METRIC_TYPES) + ',' + JSON.stringify(INPUT_PHASES) + ');\n' +
    'export const {reject,recordError,recordMetrics,wrapBridge}=__ppRuntime;\n';
}

export function parseTelemetry(text) {
  need(typeof text === 'string' && Buffer.byteLength(text) <= MAX_LOG, 'telemetry_size');
  const rejections = new Map(), errors = new Map(), metrics = new Map(), routes = new Map();
  let installed = false, truncated = false;
  const add = (map, key) => map.set(key, Math.min(1000000, (map.get(key) || 0) + 1));
  const lines = text.split('\n').filter(Boolean);
  need(lines.length <= MAX_EVENTS + 1, 'telemetry_size');
  for (const line of lines) {
    need(line.length <= 1024, 'telemetry_contract');
    let row;
    try { row = JSON.parse(line); } catch { throw new DiagnosticError('telemetry_contract'); }
    need(Array.isArray(row), 'telemetry_contract');
    if (row.length === 1 && row[0] === 'installed') installed = true;
    else if (row.length === 1 && row[0] === 'truncated') truncated = true;
    else if (row.length === 2 && row[0] === 'reject' && Number.isInteger(row[1]) &&
      row[1] >= 1 && row[1] <= CANONICAL_SITE_COUNT) add(rejections, row[1]);
    else if (row.length === 2 && row[0] === 'error' && CANONICAL_ERRORS.includes(row[1])) add(errors, row[1]);
    else if (row.length === 6 && row[0] === 'metric' && REQUIRED_METRICS.includes(row[1]) &&
      METRIC_TYPES.includes(row[2]) && typeof row[3] === 'boolean' && count(row[4]) && row[4] <= 100000 &&
      INPUT_PHASES.includes(row[5])) {
      const key = JSON.stringify(row.slice(1));
      if (metrics.has(key) || metrics.size < 32) add(metrics, key);
      else truncated = true;
    }
    else if (row.length === 11 && row[0] === 'route' && ['fetch', 'cancel'].includes(row[1]) &&
      ['plan', 'progress', 'model', 'other'].includes(row[2]) && status(row[3]) &&
      (row[4] === null || RESPONSE_ERRORS.includes(row[4])) &&
      [row[5], row[6], row[8], row[9]].every(value => typeof value === 'boolean') &&
      [row[7], row[10]].every(value => count(value) && value <= 100000)) {
      const key = JSON.stringify(row.slice(1));
      if (routes.has(key) || routes.size < 32) add(routes, key);
      else truncated = true;
    } else throw new DiagnosticError('telemetry_contract');
  }
  need(installed, 'telemetry_contract');
  return {
    canonical_rejections: [...rejections].sort((a, b) => a[0] - b[0]).map(([site, count]) => ({site, count})),
    canonical_errors: CANONICAL_ERRORS.filter(code => errors.has(code)).map(code => ({code, count: errors.get(code)})),
    canonical_metric_rejections: [...metrics].map(([key, count]) => {
      const [field, type, valid_true, operation_count, phase] = JSON.parse(key);
      return {field, type, valid_true, operation_count, phase, count};
    }),
    route_summaries: [...routes].map(([key, count]) => {
      const [kind, route, status, error, has_result, result_valid, result_operations,
        has_best, best_valid, best_operations] = JSON.parse(key);
      return {kind, route, status, error, has_result, result_valid, result_operations,
        has_best, best_valid, best_operations, count};
    }),
    events_truncated: truncated
  };
}

export function summarizeTestLog(output) {
  const raw = Buffer.isBuffer(output) ? output : Buffer.from(typeof output === 'string' ? output : '');
  const text = raw.subarray(0, MAX_LOG).toString('utf8').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  const known = new Set(), unknown = new Set();
  for (const match of text.matchAll(/^\(fail\) ([^\r\n]{1,2000})$/gm)) {
    const name = match[1].replace(/\s+\[[0-9.,]+\s*(?:ms|s)\]\s*$/, '').trim();
    if (PUBLIC_TEST_NAMES.includes(name)) known.add(name);
    else if (unknown.size < 1000000) unknown.add(name);
  }
  return {failed_tests: PUBLIC_TEST_NAMES.filter(name => known.has(name)),
    unknown_failed_test_count: unknown.size, log_truncated: raw.length > MAX_LOG};
}

function readInput(root, name) {
  const file = join(root, name);
  try {
    const parent = realpathSync(dirname(file));
    need(!lstatSync(file).isSymbolicLink() && (parent === root || parent.startsWith(root + sep)),
      'source_path');
    const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = fstatSync(descriptor);
      need(before.isFile() && before.size > 0 && before.size <= MAX_FILE, 'source_file');
      const bytes = readFileSync(descriptor);
      const after = fstatSync(descriptor);
      need(bytes.length === before.size && bytes.length <= MAX_FILE && before.ino === after.ino &&
        before.dev === after.dev && before.size === after.size && before.mtimeMs === after.mtimeMs, 'source_changed');
      return bytes;
    } finally { closeSync(descriptor); }
  } catch (error) {
    if (error instanceof DiagnosticError) throw error;
    throw new DiagnosticError('source_file');
  }
}

function writeReport(output, report) {
  const bytes = Buffer.from(JSON.stringify(report));
  need(bytes.length <= 65536, 'unexpected');
  const descriptor = openSync(output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(descriptor, bytes); } finally { closeSync(descriptor); }
}

export function diagnoseBuild(appRoot, outputPath, {runner = spawnSync} = {}) {
  const root = resolve(appRoot), output = resolve(outputPath);
  // The report cannot be a write into the source tree, even through a symlink.
  const realOutput = join(realpathSync(dirname(output)), basename(output));
  need(realOutput !== root && !realOutput.startsWith(root + sep), 'source_path');
  const report = {format: FORMAT, diagnostic_completed: false, original_app_unchanged: false,
    canonical_rejections: [], canonical_errors: [], canonical_metric_rejections: [],
    failed_tests: [], unknown_failed_test_count: 0,
    test_exit_code: null, route_summaries: [], failure_code: null, log_truncated: false, events_truncated: false};
  let directory = null, inputs = null;
  try {
    need(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink() &&
      realpathSync(root) === root, 'source_path');
    inputs = new Map(INPUT_FILES.map(name => [name, readInput(root, name)]));
    directory = mkdtempSync(join(tmpdir(), 'pp-integrated-build-diagnostic-'));
    const copy = join(directory, 'app'), telemetry = join(directory, 'events.jsonl');
    mkdirSync(copy, {mode: 0o700});
    mkdirSync(join(copy, 'tests'), {mode: 0o700});
    for (const [name, bytes] of inputs) writeFileSync(join(copy, name), bytes, {mode: 0o600, flag: 'wx'});
    writeFileSync(telemetry, '', {mode: 0o600, flag: 'wx'});
    writeFileSync(join(copy, HELPER_FILE), helperSource(telemetry), {mode: 0o600, flag: 'wx'});
    writeFileSync(join(copy, INPUT_FILES[0]), instrumentUpstream(inputs.get(INPUT_FILES[0]).toString('utf8')), {mode: 0o600});
    for (const name of TEST_FILES)
      need(sha(readFileSync(join(copy, name))) === sha(inputs.get(name)), 'test_source_changed');
    const result = runner('bun', ['test', ...TEST_FILES], {cwd: copy,
      env: {PATH: '/usr/local/bin:/usr/bin:/bin', TMPDIR: '/tmp'}, input: '',
      timeout: 90000, maxBuffer: MAX_LOG, windowsHide: true});
    Object.assign(report, summarizeTestLog(Buffer.concat([
      Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || ''),
      Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr || '')
    ])));
    if (Number.isInteger(result.status) && result.status >= 0 && result.status <= 255)
      report.test_exit_code = result.status;
    if (result.error) {
      if (result.error.code === 'ETIMEDOUT') throw new DiagnosticError('runner_timeout');
      if (result.error.code === 'ENOBUFS') { report.log_truncated = true; throw new DiagnosticError('runner_output_limit'); }
      throw new DiagnosticError('runner_unavailable');
    }
    need(report.test_exit_code !== null, 'runner_failed');
    Object.assign(report, parseTelemetry(readFileSync(telemetry, 'utf8')));
    for (const name of TEST_FILES)
      need(sha(readFileSync(join(copy, name))) === sha(inputs.get(name)), 'test_source_changed');
    report.diagnostic_completed = true;
  } catch (error) {
    report.failure_code = error instanceof DiagnosticError && FAILURE_CODES.includes(error.message) ? error.message : 'unexpected';
  } finally {
    if (inputs) {
      try { report.original_app_unchanged = INPUT_FILES.every(name => sha(readInput(root, name)) === sha(inputs.get(name))); }
      catch { report.original_app_unchanged = false; }
      if (!report.original_app_unchanged) {
        report.failure_code = 'source_changed';
        report.diagnostic_completed = false;
      }
    }
    if (directory) rmSync(directory, {recursive: true, force: true});
  }
  writeReport(realOutput, report);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error('arguments');
    const report = diagnoseBuild(process.argv[2], process.argv[3]);
    process.exitCode = report.diagnostic_completed && report.original_app_unchanged ? 0 : 1;
  } catch {
    // Never print an exception, path, stack, subprocess output or private source.
    process.stderr.write('INTEGRATED_SETUP_BUILD_DIAGNOSTIC_FAILED\n');
    process.exitCode = 1;
  }
}
