import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

// Public mock factories predate the complete native schedule contract. Preserve
// their declarations, tenant IDs, explicit values and every existing assertion.
const marker = 'pp_integrated_setup_complete_build_fixture_20261125';
export const BUILD_FIXTURE_FILES = ['tests/python-ga-upstream.test.mjs', 'tests/python-ga-state.test.mjs'];
// Additional worker fixture proven in public source c228648e41a4c65f2b9f1325c577a3ba03d6fb1b.
const candidateDeclaration = '  const candidate={ok:true,valid:true,operations:[...m.orders].reverse().map(x=>({order:x.id})),candidate:true};';
const candidateCall = '\n  // ' + marker + ':candidate\n  ppCompleteSyntheticNativeBuildFixture(candidate,m);';

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
  const generic = Array.isArray(plan.generic_operations) ? plan.generic_operations : [];
  if (generic.length > 1000) return plan;
  const originals = plan.operations.map(row => ({...row}));
  const identity = row => JSON.stringify([row.order ?? row.order_id ?? null, row.operation_id ?? row.id ?? null,
    row.batch_id ?? row.batch ?? null, row.sequence ?? null]);
  const copyMatches = generic.filter(row => row && typeof row === 'object' && !Array.isArray(row) && !setup(row)).map(copy => {
    const candidates = originals.map((original, index) => ({original, index})).filter(({original}) =>
      identity(original) === identity(copy) && (original.order != null || original.order_id != null || original.operation_id != null || original.id != null) &&
      Object.keys(original).every(key => !own(copy, key) || JSON.stringify(original[key]) === JSON.stringify(copy[key])));
    return candidates.length === 1 ? {copy, index: candidates[0].index} : null;
  }).filter(Boolean);
  const whollyUntimed = originals.every(row => !own(row, 'start_min') && !own(row, 'end_min') && !own(row, 'duration_min'));
  const step = whollyUntimed && number(plan.duration_minutes) && plan.duration_minutes > 0 ?
    Math.min(1, plan.duration_minutes / originals.length) : 1;
  let cursor = 0;
  for (const row of plan.operations) {
    // Only fixture omissions are filled. Wrong/foreign IDs, explicit invalid
    // times, booleans, counts and contradictory metadata remain untouched.
    if (!own(row, 'start_min')) {
      if (number(row.end_min) && number(row.duration_min)) row.start_min = row.end_min - row.duration_min;
      else if (!own(row, 'end_min')) row.start_min = cursor;
    }
    if (!own(row, 'end_min') && number(row.start_min)) {
      if (!own(row, 'duration_min')) row.end_min = row.start_min + step;
      else if (number(row.duration_min)) row.end_min = row.start_min + row.duration_min;
    }
    if (!own(row, 'duration_min') && number(row.start_min) && number(row.end_min))
      row.duration_min = row.end_min - row.start_min;
    if (!own(row, 'employee_ids') && !own(row, 'employee_id')) row.employee_ids = [];
    if (number(row.end_min)) cursor = Math.max(cursor, row.end_min);
  }
  if (!plan.operations.every(row => number(row.start_min) && number(row.end_min) && row.end_min >= row.start_min)) return plan;
  // Propagate only newly supplied omissions to an unambiguous original copy.
  // Existing values/conflicts and optional batch identity are never rewritten.
  for (const {copy, index} of copyMatches) {
    for (const key of ['start_min', 'end_min', 'duration_min', 'employee_ids']) {
      if (key === 'employee_ids' && own(copy, 'employee_id')) continue;
      if (!own(originals[index], key) && own(plan.operations[index], key) && !own(copy, key)) {
        const value = plan.operations[index][key];
        copy[key] = Array.isArray(value) ? [...value] : value;
      }
    }
  }
  if (!generic.some(setup)) {
    missing(plan, 'setup_operations', []);
    missing(plan, 'setup_count', 0);
    missing(plan, 'setup_minutes', 0);
  }
  missing(plan, 'duration_minutes', cursor);
  missing(plan, 'batch_count', new Set(plan.operations.map(row => JSON.stringify([row.order, row.batch_id ?? row.batch ?? 1]))).size);
  missing(plan, 'operator_wait_minutes', 0);
  missing(plan, 'machine_idle_minutes', 0);
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
function statementEnd(source, start, label, identifiers = null) {
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
    if (identifiers && /[A-Za-z_$]/.test(char)) {
      const token = source.slice(index).match(/^[A-Za-z_$][A-Za-z0-9_$]*/)[0];
      identifiers.add(token); index += token.length - 1; continue;
    }
    if ('([{'.includes(char)) stack.push(char);
    else if (')]}'.includes(char) && stack.pop() !== ({')': '(', ']': '[', '}': '{'})[char]) fail(label);
    else if (char === ',' && stack.length === 0) fail(label);
    else if (char === ';' && stack.length === 0) return index + 1;
  }
  fail(label);
}

function visibleReplyCode(source, label, firstOnly = false) {
  const scanFail = () => {
    if (label === 'state') throw Error('INTEGRATED_SETUP_BUILD_FIXTURE_STATE_REPLY_SCAN_GUARD');
    throw Error('INTEGRATED_SETUP_BUILD_FIXTURE_UPSTREAM_REPLY_SCAN_GUARD');
  };
  if (source.length > 65536) scanFail();
  const chars = source.split('');
  let quote = null, escaped = false, line = false, block = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index], next = source[index + 1];
    if (line) { if (char === '\n') line = false; else chars[index] = ' '; continue; }
    if (block) {
      chars[index] = char === '\n' ? '\n' : ' ';
      if (char === '*' && next === '/') { chars[++index] = ' '; block = false; }
      continue;
    }
    if (quote) {
      chars[index] = char === '\n' ? '\n' : ' ';
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; chars[index] = ' '; continue; }
    if (char === '/' && next === '/') { chars[index] = chars[++index] = ' '; line = true; continue; }
    if (char === '/' && next === '*') { chars[index] = chars[++index] = ' '; block = true; continue; }
    if (char === '`' || char === '/') scanFail();
    if (firstOnly && char === '(' && /\breturn\s+Response\s*\.\s*json\s*\($/.test(chars.slice(0, index + 1).join('')))
      return chars.slice(0, index + 1).join('');
  }
  if (quote || block) scanFail();
  return chars.join('');
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
  const start = declaration.index;
  let end = statementEnd(source, start, label);
  if (end > tail.index) fail(label);
  let original = source.slice(start, end), insertion = original.length;
  const following = source.slice(end, tail.index);
  if (label === 'upstream') {
    if (!/\}\s*;$/.test(original)) throw Error('INTEGRATED_SETUP_BUILD_FIXTURE_UPSTREAM_OBJECT_GUARD');
    // Keep all existing enrichment/assertions/comments between the declaration
    // and reply. Ignore comment/string text while selecting the real return.
    const replies = [...visibleReplyCode(following, label).matchAll(/\breturn\s+Response\s*\.\s*json\s*\(/g)];
    if (replies.length !== 1) throw Error('INTEGRATED_SETUP_BUILD_FIXTURE_UPSTREAM_REPLY_COUNT_GUARD');
    const responseStart = replies[0].index, references = new Set();
    const responseEnd = statementEnd(following, responseStart, label, references);
    if (!references.has('plan')) throw Error('INTEGRATED_SETUP_BUILD_FIXTURE_UPSTREAM_PLAN_REFERENCE_GUARD');
    end += responseEnd;
    original = source.slice(start, end);
    const candidates = [...original.matchAll(/\bconst\s+candidate\s*=/g)];
    if (candidates.length > 1 || (candidates.length === 1 && original.split(candidateDeclaration).length !== 2))
      throw Error('INTEGRATED_SETUP_BUILD_FIXTURE_CANDIDATE_SOURCE_GUARD');
    try {
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      new AsyncFunction('m', 'j', 'opts', 'url', original);
    } catch { throw Error('INTEGRATED_SETUP_BUILD_FIXTURE_UPSTREAM_SEGMENT_SYNTAX_GUARD'); }
  } else {
    if (!/\bresult\s*:\s*\{/.test(original) || !/\bstatus\s*:\s*['"]completed['"]/.test(original))
      throw Error('INTEGRATED_SETUP_BUILD_FIXTURE_STATE_RESULT_GUARD');
    // This fixture's known POST branch has a job acknowledgement before its
    // later GET/cancel response branches. Retain all statements up to it.
    const replies = [...visibleReplyCode(following, label, true).matchAll(/\breturn\s+Response\s*\.\s*json\s*\(/g)];
    if (replies.length !== 1) throw Error('INTEGRATED_SETUP_BUILD_FIXTURE_STATE_REPLY_COUNT_GUARD');
    const responseStart = replies[0].index, references = new Set();
    const responseEnd = statementEnd(following, responseStart, label, references);
    if (!references.has('id')) throw Error('INTEGRATED_SETUP_BUILD_FIXTURE_STATE_ID_REFERENCE_GUARD');
    end += responseEnd;
    original = source.slice(start, end);
    try {
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      new AsyncFunction('m', 'model', 'worker', 'id', 'opts', 'url', original);
    } catch { throw Error('INTEGRATED_SETUP_BUILD_FIXTURE_STATE_SEGMENT_SYNTAX_GUARD'); }
  }
  return {start, end, original, insertion, indent: original.match(/^[ \t]*/)[0]};
}

function render(original, label, indent, insertion) {
  const call = label === 'upstream' ? 'ppCompleteSyntheticNativeBuildFixture(plan,m);' :
    'ppCompleteSyntheticNativeBuildFixture(worker.get(id)?.result,model);';
  let suffix = original.slice(insertion);
  if (label === 'upstream' && suffix.includes(candidateDeclaration))
    suffix = suffix.replace(candidateDeclaration, candidateDeclaration + candidateCall);
  return indent + '// ' + marker + ':' + label + ':' + sha(original) + '\n' + original.slice(0, insertion) +
    '\n' + indent + '// ' + marker + ':augment\n' + indent + ppCompleteSyntheticNativeBuildFixture.toString() +
    '\n' + indent + call + '\n' + indent + '// ' + marker + ':resume\n' + suffix +
    '\n' + indent + '// ' + marker + ':end';
}

function patchFixture(source, label) {
  if (typeof source !== 'string' || source.length > 4 * 1024 * 1024) fail(label);
  if (source.includes(marker)) {
    const header = one(source, new RegExp('^[ \\t]*// ' + marker + ':' + label + ':([0-9a-f]{64})\\n', 'gm'), label);
    const middle = one(source, new RegExp('\\n[ \\t]*// ' + marker + ':augment\\n', 'g'), label);
    const resume = one(source, new RegExp('\\n[ \\t]*// ' + marker + ':resume\\n', 'g'), label);
    const footer = one(source, new RegExp('\\n[ \\t]*// ' + marker + ':end', 'g'), label);
    const start = header.index, originalStart = start + header[0].length;
    const end = footer.index + footer[0].length;
    if (!(originalStart < middle.index && middle.index < resume.index && resume.index < footer.index)) fail(label);
    let suffix = source.slice(resume.index + resume[0].length, footer.index);
    if (label === 'upstream' && suffix.includes(candidateCall)) {
      if (suffix.split(candidateCall).length !== 2) fail(label);
      suffix = suffix.replace(candidateCall, '');
    }
    const original = source.slice(originalStart, middle.index) + suffix;
    const restored = source.slice(0, start) + original + source.slice(end);
    if (sha(original) !== header[1] || restored.includes(marker) || patchFixture(restored, label) !== source)
      throw Error('INTEGRATED_SETUP_BUILD_FIXTURE_INSTALL_DRIFT_' + label);
    return source;
  }
  if (source.includes('ppCompleteSyntheticNativeBuildFixture')) fail(label);
  const {start, end, original, insertion, indent} = locate(source, label);
  const replacement = render(original, label, indent, insertion);
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
