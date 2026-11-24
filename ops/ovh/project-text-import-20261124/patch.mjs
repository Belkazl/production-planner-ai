import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {transformSource} from './text-import.mjs';

const [beforePath, afterPath] = process.argv.slice(2);
assert(beforePath && afterPath, 'PROJECT_TEXT_IMPORT_INPUTS');
const original = readFileSync(beforePath, 'utf8');
const before = 'return new Response(ppResourceUnitsHtml(ppNonBlockingDbSyncHtml(enhanced)),{';
const after = 'return new Response(ppProjectTextImportHtml(ppResourceUnitsHtml(ppNonBlockingDbSyncHtml(enhanced))),{';
assert(original.includes('"x-liftorbit-ui":"etalon-modules-compat"'), 'PROJECT_TEXT_IMPORT_NATIVE_HTML_MISSING');
const helper = '\n' + transformSource();
let output;
if (original.includes('function ppProjectTextImportHtml(')) {
  assert.equal(original.split(after).length, 2, 'PROJECT_TEXT_IMPORT_INSTALLED_WRAPPER_DRIFT');
  assert.equal(original.split('\nfunction ppProjectTextImportHtml(html){\n').length, 2, 'PROJECT_TEXT_IMPORT_HELPER_DRIFT');
  const at = original.lastIndexOf('\nfunction ppProjectTextImportHtml(html){\n');
  const previous = original.slice(at);
  const checksum = createHash('sha256').update(previous).digest('hex');
  assert(previous === helper || checksum === '91beaf38107edda160c07aa2e117da7220e1c67c0a9003abbffda9efcdf3fedc',
    'PROJECT_TEXT_IMPORT_UNRECOGNIZED_DEPLOYED_HELPER');
  output = original.slice(0, at) + helper;
  assert.equal(output.slice(0, -helper.length) + previous, original, 'PROJECT_TEXT_IMPORT_UPGRADE_UNRELATED_CHANGE');
} else {
  assert.equal(original.split(before).length, 2, 'PROJECT_TEXT_IMPORT_AUTH_ANCHOR_DRIFT');
  output = original.replace(before, after) + helper;
  assert.equal(output.slice(0, -helper.length).replace(after, before), original, 'PROJECT_TEXT_IMPORT_UNRELATED_CHANGE');
}
writeFileSync(afterPath, output);
console.log('PROJECT_TEXT_IMPORT_PATCH_PASS', JSON.stringify({onlyHtmlTransformChanged:true}));
