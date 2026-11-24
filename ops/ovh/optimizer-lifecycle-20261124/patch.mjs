import {readFileSync, writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ppOptimizerLifecycleHtml} from './lifecycle.mjs';

const [beforePath, afterPath] = process.argv.slice(2);
assert(beforePath && afterPath, 'OPTIMIZER_LIFECYCLE_INPUTS_REQUIRED');
const original = readFileSync(beforePath, 'utf8');
const before = 'ppNonBlockingDbSyncHtml(enhanced)';
const after = 'ppOptimizerLifecycleHtml(ppNonBlockingDbSyncHtml(enhanced))';
const helper = '\n' + ppOptimizerLifecycleHtml.toString() + '\n';
const importMarker = '\nfunction ppProjectTextImportHtml(';
// Exact helper shipped in commit 50050644; no other installed version is replaced.
const previousHelperSha256 = '7a1c9f251b426efc404dd7c88c99377cc107d41762a2f26990fa003a7973f8c8';
assert(original.includes('"x-liftorbit-ui":"etalon-modules-compat"'), 'OPTIMIZER_LIFECYCLE_NATIVE_HTML_MISSING');
assert.equal(original.split(before).length, 2, 'OPTIMIZER_LIFECYCLE_WRAPPER_ANCHOR_DRIFT');
assert(original.split(importMarker).length <= 2, 'OPTIMIZER_LIFECYCLE_IMPORT_HELPER_DRIFT');
let output;
if (original.includes('ppOptimizerLifecycleHtml')) {
  assert.equal(original.split(after).length, 2, 'OPTIMIZER_LIFECYCLE_INSTALLED_WRAPPER_DRIFT');
  assert.equal(original.split('function ppOptimizerLifecycleHtml(').length, 2, 'OPTIMIZER_LIFECYCLE_DUPLICATE_HELPER');
  if (original.split(helper).length === 2) output = original;
  else {
    const start = original.indexOf('\nfunction ppOptimizerLifecycleHtml(');
    const end = original.indexOf('\n}\n', start);
    assert(start >= 0 && end > start, 'OPTIMIZER_LIFECYCLE_INSTALLED_HELPER_BOUNDARY_DRIFT');
    const installed = original.slice(start, end + 3);
    assert.equal(createHash('sha256').update(installed).digest('hex'), previousHelperSha256,
      'OPTIMIZER_LIFECYCLE_INSTALLED_HELPER_DRIFT');
    output = original.slice(0, start) + helper + original.slice(end + 3);
    assert.equal(output.replace(helper, installed), original, 'OPTIMIZER_LIFECYCLE_UNRELATED_UPGRADE_CHANGE');
  }
} else {
  output = original.replace(before, after);
  const at = output.indexOf(importMarker);
  output = at < 0 ? output + helper : output.slice(0, at) + helper + output.slice(at);
  assert.equal(output.replace(helper, '').replace(after, before), original, 'OPTIMIZER_LIFECYCLE_UNRELATED_SOURCE_CHANGE');
}
writeFileSync(afterPath, output);
console.log('OPTIMIZER_LIFECYCLE_PATCH_PASS', JSON.stringify({changed: output !== original, onlyHtmlTransformChanged: true}));
