import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

// Public mock factories predate the complete native schedule contract. Preserve
// their declarations, tenant IDs, explicit values and every existing assertion.
const marker = 'pp_integrated_setup_complete_build_fixture_20261125';
export const BUILD_FIXTURE_FILES = ['tests/python-ga-upstream.test.mjs', 'tests/python-ga-state.test.mjs'];

export function ppCompleteSyntheticNativeBuildFixture(plan, model) {
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const missing = (value, key, fallback) => { if (!own(value, key)) value[key] = fallback; };
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const setup = row => row?.is_setup === true || String(row?.phase || row?.type || '').toLowerCase() === 'setup';
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || plan.valid !== true ||
      plan.ok === false || plan.partial === true || !Array.isArray(plan.operations) ||
      !plan.operations.length || plan.operations.length > 1000 ||
      plan.operations.some(row => !row || typeof row !== 'object' || Array.isArray(row) || setup(row)) ||
      ['validation_errors', 'errors', 'violations', 'conflicts'].some(key => own(plan, key) &&
        (!Array.isArray(plan[key]) || plan[key].length)) ||
      (own(plan, 'setup_operations') && (!Array.isArray(plan.setup_operations) || plan.setup_operations.length))) return plan;
  let cursor = 0;
  for (const row of plan.operations) {
    // Only fixture omissions are filled. Wrong/foreign IDs, explicit invalid
    // times, booleans, counts and contradictory metadata remain untouched.
    if (!own(row, 'start_min')) {
      if (number(row.end_min) && number(row.duration_min)) row.start_min = row.end_min - row.duration_min;
      else if (!own(row, 'end_min')) row.start_min = cursor;
    }
    if (!own(row, 'end_min') && number(row.start_min)) {
      if (!own(row, 'duration_min')) row.end_min = row.start_min + 1;
      else if (number(row.duration_min)) row.end_min = row.start_min + row.duration_min;
    }
    if (!own(row, 'duration_min') && number(row.start_min) && number(row.end_min))
      row.duration_min = row.end_min - row.start_min;
    missing(row, 'batch', 1);
    if (!own(row, 'equipment_ids')) {
      if (own(row, 'equipment_id')) row.equipment_ids = [row.equipment_id];
      else if (model?.equipment?.length === 1) row.equipment_ids = [model.equipment[0].id];
    }
    if (!own(row, 'employee_ids') && !own(row, 'employee_id')) row.employee_ids = [];
    if (number(row.end_min)) cursor = Math.max(cursor, row.end_min);
  }
  if (!plan.operations.every(row => number(row.start_min) && number(row.end_min) && row.end_min >= row.start_min)) return plan;
  missing(plan, 'setup_operations', []);
  missing(plan, 'setup_count', 0);
  missing(plan, 'setup_minutes', 0);
  missing(plan, 'duration_minutes', cursor);
  missing(plan, 'batch_count', new Set(plan.operations.map(row => JSON.stringify([row.order, row.batch]))).size);
  missing(plan, 'operator_wait_minutes', 0);
  missing(plan, 'machine_idle_minutes', 0);
  missing(plan, 'order_sequence', [...new Set(plan.operations.map(row => row.order))]);
  return plan;
}

const sha = value => createHash('sha256').update(value).digest('hex');
const fail = label => { throw Error('INTEGRATED_SETUP_BUILD_FIXTURE_SOURCE_DRIFT_' + label); };
function one(source, expression, label) {
  const found = [...source.matchAll(expression)];
  if (found.length !== 1) fail(label);
  return found[0];
}

// A bounded declaration/call scanner, not a rewriter. Unknown lexical forms
// fail closed; the original statement is separately syntax-checked unchanged.
function statementEnd(source, start, label) {
  const stack = [];
  let quote = null, escaped = false, lineComment = false, blockComment = false;
  for (let index = start; index < Math.min(source.length, start + 16384); index++) {
    const char = source[index], next = source[index + 1];
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockComment) { if (char === '*' && next === '/') { blockComment = false; index++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '/' && next === '/') { lineComment = true; index++; continue; }
    if (char === '/' && next === '*') { blockComment = true; index++; continue; }
    if (char === '`' || char === '/') fail(label);
    if ('([{'.includes(char)) stack.push(char);
    else if (')]}'.includes(char) && stack.pop() !== ({')': '(', ']': '[', '}': '{'})[char]) fail(label);
    else if (char === ',' && stack.length === 0) fail(label);
    else if (char === ';' && stack.length === 0) return index + 1;
  }
  fail(label);
}

function locate(source, label) {
  if (typeof source !== 'string' || source.length > 4 * 1024 * 1024) fail(label);
  // The known fixture factory precedes the top-level test cases. Identically
  // named declarations inside those assertions are outside the edit scope.
  const testStart = source.search(/^test\s*\(/m);
  const scope = testStart < 0 ? source : source.slice(0, testStart);
  let factory, worker, declaration, tail;
  if (label === 'upstream') {
    factory = one(scope, /\bfunction\s+makeEnv\s*\(/g, label);
    worker = one(scope, /\bconst\s+fetchStub\s*=\s*async\s*\(\s*url\s*,\s*opts\s*\)\s*=>\s*\{/g, label);
    declaration = one(scope, /^[ \t]*const\s+plan\s*=\s*\{/gm, label);
    tail = one(scope, /\bconst\s+bridge\s*=\s*createPythonGAUpstream\s*\(/g, label);
    const prefix = source.slice(worker.index, declaration.index);
    if (!/\bconst\s+m\s*=\s*foreign\s*\?\s*models\s*\.\s*get\(\s*['"]A9['"]\s*\)\s*:\s*j\s*\.\s*model\s*;\s*$/.test(prefix)) fail(label);
  } else {
    factory = one(scope, /\bfunction\s+harness\s*\(/g, label);
    worker = one(scope, /\bconst\s+fetchImpl\s*=\s*async\s*\(\s*url\s*,\s*opts\s*\)\s*=>\s*\{/g, label);
    declaration = one(scope, /^[ \t]*worker\s*\.\s*set\s*\(\s*id\s*,\s*\{/gm, label);
    tail = one(scope, /\bconst\s+create\s*=\s*\(\s*\)\s*=>\s*createPythonGAUpstream\s*\(/g, label);
  }
  if (!(factory.index < worker.index && worker.index < declaration.index && declaration.index < tail.index)) fail(label);
  const start = declaration.index, end = statementEnd(source, start, label);
  if (end > tail.index) fail(label);
  const original = source.slice(start, end);
  const following = source.slice(end, tail.index);
  if (label === 'upstream') {
    if (!/\}\s*;$/.test(original) || !/\boperations\s*:\s*m\s*\.\s*orders\s*\.\s*map\s*\(/.test(original) ||
        !/^\s*return\s+Response\s*\.\s*json\s*\(\s*\{\s*status\s*:\s*j\s*\.\s*status\b/.test(following) ||
        !/\bresult\s*:\s*j\s*\.\s*status\s*===\s*['"]completed['"]\s*\?\s*plan\s*:\s*null\b/.test(following)) fail(label);
  } else if (!/\bresult\s*:\s*\{/.test(original) || !/\bstatus\s*:\s*['"]completed['"]/.test(original) ||
      !/^\s*return\s+Response\s*\.\s*json\s*\(\s*\{\s*job_id\s*:\s*id\s*\}/.test(following)) fail(label);
  try { new Function('m', 'model', 'worker', 'id', original); } catch { fail(label); }
  return {start, end, original, indent: original.match(/^[ \t]*/)[0]};
}

function render(original, label, indent) {
  const call = label === 'upstream' ? 'ppCompleteSyntheticNativeBuildFixture(plan,m);' :
    'ppCompleteSyntheticNativeBuildFixture(worker.get(id)?.result,model);';
  return indent + '// ' + marker + ':' + label + ':' + sha(original) + '\n' + original +
    '\n' + indent + '// ' + marker + ':augment\n' + indent + ppCompleteSyntheticNativeBuildFixture.toString() +
    '\n' + indent + call + '\n' + indent + '// ' + marker + ':end';
}

function patchFixture(source, label) {
  if (typeof source !== 'string' || source.length > 4 * 1024 * 1024) fail(label);
  if (source.includes(marker)) {
    const header = one(source, new RegExp('^[ \\t]*// ' + marker + ':' + label + ':([0-9a-f]{64})\\n', 'gm'), label);
    const middle = one(source, new RegExp('\\n[ \\t]*// ' + marker + ':augment\\n', 'g'), label);
    const footer = one(source, new RegExp('\\n[ \\t]*// ' + marker + ':end', 'g'), label);
    const start = header.index, originalStart = start + header[0].length;
    const end = footer.index + footer[0].length;
    if (!(originalStart < middle.index && middle.index < footer.index)) fail(label);
    const original = source.slice(originalStart, middle.index);
    const restored = source.slice(0, start) + original + source.slice(end);
    if (sha(original) !== header[1] || restored.includes(marker) || patchFixture(restored, label) !== source)
      throw Error('INTEGRATED_SETUP_BUILD_FIXTURE_INSTALL_DRIFT_' + label);
    return source;
  }
  if (source.includes('ppCompleteSyntheticNativeBuildFixture')) fail(label);
  const {start, end, original, indent} = locate(source, label);
  const replacement = render(original, label, indent);
  const updated = source.slice(0, start) + replacement + source.slice(end);
  if (updated.slice(0, start) + original + updated.slice(start + replacement.length) !== source)
    throw Error('INTEGRATED_SETUP_BUILD_FIXTURE_UNRELATED_CHANGE_' + label);
  return updated;
}

export const patchUpstreamBuildFixture = source => patchFixture(source, 'upstream');
export const patchStateBuildFixture = source => patchFixture(source, 'state');
export function patchBuildFixtures(files) {
  return Object.fromEntries(BUILD_FIXTURE_FILES.map((name, index) => [name, patchFixture(files[name], index ? 'state' : 'upstream')]));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw Error('usage: build-fixtures.mjs APP_ROOT');
  const root = resolve(process.argv[2]);
  const before = Object.fromEntries(BUILD_FIXTURE_FILES.map(name => [name, readFileSync(resolve(root, name), 'utf8')]));
  // Reject either source contract before touching either staged test file.
  const after = patchBuildFixtures(before);
  for (const name of BUILD_FIXTURE_FILES) {
    if (before[name] !== after[name]) writeFileSync(resolve(root, name), after[name]);
    console.log('INTEGRATED_SETUP_BUILD_FIXTURE_PATCH', name, sha(after[name]));
  }
}
