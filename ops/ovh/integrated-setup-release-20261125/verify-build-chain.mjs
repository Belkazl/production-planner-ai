/** Replay the affected Docker transforms privately; never start the server. */
import {constants, closeSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync,
  readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {basename, dirname, join, resolve, sep} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {NATIVE_HEADER, NATIVE_HEADER_VALUE} from '../integrated-setup-result-20261125/patch.mjs';

export const FORMAT = 'integrated-setup-build-chain-v1';
export const INPUT_FILES = Object.freeze([
  'baselines/2026-10-10/aps-setup-bridge/index.ts', 'build-bridge.ts', 'feature-stop.ts', 'stop-ui.js'
]);
export const CHECKS = Object.freeze([
  'original_inputs_unchanged', 'build_bridge_passed', 'feature_stop_passed', 'bundle_passed',
  'native_bypass_preserved', 'abort_signal_preserved', 'stop_guards_preserved', 'all_checks_passed'
]);
export const PHASES = Object.freeze([
  'input', 'build_bridge', 'feature_stop', 'generated_contract', 'bundle', 'source_integrity'
]);
export const FAILURE_CODES = Object.freeze([
  'source_path', 'source_file', 'source_changed', 'copy_integrity', 'runner_unavailable',
  'runner_timeout', 'runner_output_limit', 'build_bridge_failed', 'feature_stop_failed',
  'bundle_failed', 'generated_file', 'native_bypass_count', 'abort_signal_missing',
  'stop_guards_missing', 'unexpected'
]);
export const NATIVE_BYPASS = 'if(r.headers.get("' + NATIVE_HEADER + '")==="' + NATIVE_HEADER_VALUE +
  '"){state.completed=r.status!==202;return rawResponse(r)}';
const ABORT_SIGNAL = 'AbortSignal.any([AbortSignal.timeout(350000),state.abortController.signal])';
const STOP_GUARD = 'if(state.stopRequested){state.completed=true;return jsonifyBridge({ok:false,stopped:true,error:"optimization_stopped"})}';
const MAX_FILE = 4 * 1024 * 1024, MAX_GENERATED = 32 * 1024 * 1024, MAX_LOG = 2 * 1024 * 1024;
const sha = value => createHash('sha256').update(value).digest('hex');
const occurrences = (source, value) => source.split(value).length - 1;
class BuildChainError extends Error {}
function need(ok, code) { if (!ok) throw new BuildChainError(code); }

export function inspectGenerated(source) {
  need(typeof source === 'string' && Buffer.byteLength(source) <= MAX_GENERATED, 'generated_file');
  const start = 'async function plan(req){', boundary = '\nconst PP_GANTT_INLINE=';
  need(occurrences(source, start) === 1 && occurrences(source, boundary) === 1 &&
    source.indexOf(start) < source.indexOf(boundary), 'generated_file');
  const plan = source.slice(source.indexOf(start), source.indexOf(boundary));
  const bypassAt = plan.indexOf(NATIVE_BYPASS);
  return {
    native_bypass_preserved: occurrences(source, NATIVE_BYPASS) === 1 && bypassAt >= 0,
    abort_signal_preserved: occurrences(plan, ABORT_SIGNAL) === 1 &&
      plan.includes('state.abortController=new AbortController()'),
    stop_guards_preserved: bypassAt >= 0 && occurrences(plan.slice(0, bypassAt), STOP_GUARD) === 2 &&
      plan.includes(STOP_GUARD + 'const choice=ppPreferObservedObjectivePlan(') &&
      source.includes('async function stopOptimization(req) {') &&
      source.includes('state.stopRequested=true;state.completed=true;') &&
      source.includes('state.abortController?.abort("user_stopped")')
  };
}

function readOwned(root, name, maximum = MAX_FILE) {
  const file = join(root, name);
  try {
    const parent = realpathSync(dirname(file));
    need(!lstatSync(file).isSymbolicLink() && (parent === root || parent.startsWith(root + sep)), 'source_path');
    const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = fstatSync(descriptor);
      need(before.isFile() && before.size > 0 && before.size <= maximum, 'source_file');
      const data = readFileSync(descriptor), after = fstatSync(descriptor);
      need(data.length === before.size && data.length <= maximum && before.ino === after.ino &&
        before.dev === after.dev && before.size === after.size && before.mtimeMs === after.mtimeMs, 'source_changed');
      return data;
    } finally { closeSync(descriptor); }
  } catch (error) {
    if (error instanceof BuildChainError) throw error;
    throw new BuildChainError('source_file');
  }
}

function writeReport(path, report) {
  const data = Buffer.from(JSON.stringify(report));
  need(data.length <= 16384, 'unexpected');
  const descriptor = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(descriptor, data); } finally { closeSync(descriptor); }
}

export function verifyBuildChain(appRoot, outputPath, {runner = spawnSync} = {}) {
  const root = resolve(appRoot), output = resolve(outputPath);
  const realOutput = join(realpathSync(dirname(output)), basename(output));
  need(realOutput !== root && !realOutput.startsWith(root + sep), 'source_path');
  const report = {format: FORMAT, ...Object.fromEntries(CHECKS.map(key => [key, false])),
    failure_phase: null, failure_code: null};
  let inputs = null, temporary = null, phase = 'input';
  try {
    need(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink() &&
      realpathSync(root) === root, 'source_path');
    inputs = new Map(INPUT_FILES.map(name => [name, readOwned(root, name)]));
    temporary = mkdtempSync(join(tmpdir(), 'pp-integrated-build-chain-'));
    const copy = join(temporary, 'app');
    mkdirSync(copy, {mode: 0o700});
    for (const [name, data] of inputs) {
      mkdirSync(dirname(join(copy, name)), {recursive: true, mode: 0o700});
      writeFileSync(join(copy, name), data, {mode: 0o600, flag: 'wx'});
      need(sha(readOwned(copy, name)) === sha(data), 'copy_integrity');
    }
    function step(name, args, field) {
      phase = name;
      const result = runner('bun', args, {cwd: copy,
        env: {PATH: '/usr/local/bin:/usr/bin:/bin', TMPDIR: '/tmp'}, input: '',
        timeout: 45000, maxBuffer: MAX_LOG, windowsHide: true});
      // All command output stays private. Only this fixed step and code leave.
      if (result.error) {
        if (result.error.code === 'ETIMEDOUT') throw new BuildChainError('runner_timeout');
        if (result.error.code === 'ENOBUFS') throw new BuildChainError('runner_output_limit');
        throw new BuildChainError('runner_unavailable');
      }
      need(result.status === 0, name + '_failed');
      report[field] = true;
    }
    step('build_bridge', ['run', 'build-bridge.ts'], 'build_bridge_passed');
    step('feature_stop', ['run', 'feature-stop.ts'], 'feature_stop_passed');
    phase = 'generated_contract';
    const generated = readOwned(copy, 'index.ts', MAX_GENERATED).toString('utf8');
    Object.assign(report, inspectGenerated(generated));
    need(report.native_bypass_preserved, 'native_bypass_count');
    need(report.abort_signal_preserved, 'abort_signal_missing');
    need(report.stop_guards_preserved, 'stop_guards_missing');
    step('bundle', ['build', './index.ts', '--target=bun', '--outdir=./bundle-check'], 'bundle_passed');
    readOwned(copy, 'bundle-check/index.js', MAX_GENERATED);
    // The builders may create index.ts and a bundle, but may not rewrite any
    // captured input or make the passing result depend on such a rewrite.
    phase = 'source_integrity';
    for (const [name, data] of inputs) need(sha(readOwned(copy, name)) === sha(data), 'copy_integrity');
  } catch (error) {
    report.failure_phase = PHASES.includes(phase) ? phase : 'input';
    report.failure_code = error instanceof BuildChainError && FAILURE_CODES.includes(error.message)
      ? error.message : 'unexpected';
  } finally {
    if (inputs) {
      try { report.original_inputs_unchanged = INPUT_FILES.every(name => sha(readOwned(root, name)) === sha(inputs.get(name))); }
      catch { report.original_inputs_unchanged = false; }
      if (!report.original_inputs_unchanged) {
        report.failure_phase = 'source_integrity';
        report.failure_code = 'source_changed';
      }
    }
    if (temporary) rmSync(temporary, {recursive: true, force: true});
  }
  report.all_checks_passed = report.failure_code === null && CHECKS.slice(0, -1).every(key => report[key] === true);
  writeReport(realOutput, report);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error('arguments');
    process.exitCode = verifyBuildChain(process.argv[2], process.argv[3]).all_checks_passed ? 0 : 1;
  } catch {
    process.stderr.write('INTEGRATED_SETUP_BUILD_CHAIN_FAILED\n');
    process.exitCode = 1;
  }
}
