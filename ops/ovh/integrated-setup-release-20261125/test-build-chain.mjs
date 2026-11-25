import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {patchAps} from '../integrated-setup-result-20261125/patch.mjs';
import {CHECKS, INPUT_FILES, NATIVE_BYPASS, verifyBuildChain} from './verify-build-chain.mjs';

const repo = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const read = path => readFileSync(join(repo, path), 'utf8');
const baseline = INPUT_FILES[0];
const secret = 'PRIVATE_BUILD_OUTPUT_MUST_NEVER_BE_EXPORTED';

function publicFixture(broken = false) {
  const directory = mkdtempSync(join(tmpdir(), 'pp-public-build-chain-test-'));
  const app = join(directory, 'app'), report = join(directory, 'report.json');
  mkdirSync(app);
  let source = read(baseline);
  const reconcileSource = read('ops/ovh/ga-final-progress-reconcile-20261117/patch-progress.mjs');
  const reconcile = JSON.parse(reconcileSource.match(/^const helper=(".*");$/m)[1]);
  source = source.replace('async function progress(req){', reconcile + '\nasync function progress(req){')
    .replace('  data.objective=goal;\n  data.aps_setup_bridge=REV;',
      '  ppReconcileSetupAwareTerminal(data,model);\n  data.objective=goal;\n  data.aps_setup_bridge=REV;');
  source = patchAps(source);
  if (broken) {
    // Reconstruct the failing pre-fix arrangement. The existing build
    // transform requires its complete fetch-plus-error span to stay intact.
    const anchor = read('feature-stop.ts').match(/once\('(const r=await fetch[^\n]+)',\n/)[1];
    const split = anchor.indexOf('if(!r.ok)');
    const preserved = anchor + '\n' + NATIVE_BYPASS;
    assert.equal(source.split(preserved).length, 2);
    source = source.replace(preserved, anchor.slice(0, split) + '\n' + NATIVE_BYPASS + '\n' + anchor.slice(split));
  }
  for (const name of INPUT_FILES) {
    mkdirSync(dirname(join(app, name)), {recursive: true});
    writeFileSync(join(app, name), name === baseline ? source : read(name));
  }
  const originals = new Map(INPUT_FILES.map(name => [name, readFileSync(join(app, name))]));
  return {directory, app, report, originals};
}

// The production CLI has no fallback: all three commands require real Bun.
// This local unit runner executes the public builders unchanged using Node's
// TypeScript support and parses their complete module without starting Bun's
// server. Actual Bun compilation is mandatory in the isolated acceptance gate.
function publicTypeScriptRunner(command, args, options) {
  assert.equal(command, 'bun');
  assert.deepEqual(options.env, {PATH: '/usr/local/bin:/usr/bin:/bin', TMPDIR: '/tmp'});
  if (args[0] === 'run') {
    assert(['build-bridge.ts', 'feature-stop.ts'].includes(args[1]));
    return spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', args[1]], options);
  }
  assert.deepEqual(args, ['build', './index.ts', '--target=bun', '--outdir=./bundle-check']);
  const script = [
    'import {readFileSync,mkdirSync,writeFileSync} from "node:fs";',
    'import {SourceTextModule} from "node:vm";',
    'const source=readFileSync("index.ts","utf8");',
    'new SourceTextModule(source);',
    'mkdirSync("bundle-check");writeFileSync("bundle-check/index.js",source);'
  ].join('\n');
  return spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', '--input-type=module', '-e', script], options);
}

test('public build transforms preserve the fixed native bypass and Stop guards without changing inputs', () => {
  const fixture = publicFixture();
  try {
    const commands = [];
    let copiedApp;
    const report = verifyBuildChain(fixture.app, fixture.report, {runner(command, args, options) {
      commands.push(args); copiedApp = options.cwd;
      return publicTypeScriptRunner(command, args, options);
    }});
    assert.equal(report.failure_code, null);
    assert.equal(report.failure_phase, null);
    assert(CHECKS.every(key => report[key] === true));
    assert.deepEqual(commands, [['run', 'build-bridge.ts'], ['run', 'feature-stop.ts'],
      ['build', './index.ts', '--target=bun', '--outdir=./bundle-check']]);
    for (const [name, original] of fixture.originals)
      assert.deepEqual(readFileSync(join(fixture.app, name)), original);
    assert.deepEqual(JSON.parse(readFileSync(fixture.report, 'utf8')), report);
    assert.throws(() => readFileSync(join(copiedApp, 'index.ts')), {code: 'ENOENT'});
  } finally { rmSync(fixture.directory, {recursive: true, force: true}); }
});

test('the former native-check placement reproduces the actual feature-stop build failure', () => {
  const fixture = publicFixture(true);
  try {
    const report = verifyBuildChain(fixture.app, fixture.report, {runner: publicTypeScriptRunner});
    assert.equal(report.all_checks_passed, false);
    assert.equal(report.build_bridge_passed, true);
    assert.equal(report.feature_stop_passed, false);
    assert.equal(report.bundle_passed, false);
    assert.equal(report.failure_phase, 'feature_stop');
    assert.equal(report.failure_code, 'feature_stop_failed');
    assert.equal(report.original_inputs_unchanged, true);
    for (const [name, original] of fixture.originals)
      assert.deepEqual(readFileSync(join(fixture.app, name)), original);
  } finally { rmSync(fixture.directory, {recursive: true, force: true}); }
});

test('a missing cancellation signal fails before bundling and never publishes subprocess output', () => {
  const fixture = publicFixture();
  try {
    const report = verifyBuildChain(fixture.app, fixture.report, {runner(command, args, options) {
      assert.notEqual(args[0], 'build');
      const result = publicTypeScriptRunner(command, args, options);
      if (args[1] === 'feature-stop.ts' && result.status === 0) {
        const file = join(options.cwd, 'index.ts');
        writeFileSync(file, readFileSync(file, 'utf8').replace('AbortSignal.any(', 'AbortSignal.timeout('));
        result.stderr = Buffer.from(secret);
      }
      return result;
    }});
    assert.equal(report.all_checks_passed, false);
    assert.equal(report.feature_stop_passed, true);
    assert.equal(report.bundle_passed, false);
    assert.equal(report.abort_signal_preserved, false);
    assert.equal(report.failure_phase, 'generated_contract');
    assert.equal(report.failure_code, 'abort_signal_missing');
    assert.equal(report.original_inputs_unchanged, true);
    assert.equal(readFileSync(fixture.report, 'utf8').includes(secret), false);
  } finally { rmSync(fixture.directory, {recursive: true, force: true}); }
});
