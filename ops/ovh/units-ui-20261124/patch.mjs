import {readFileSync, writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {ppResourceUnitsInlineHtml} from './units-ui.mjs';

const [beforePath, afterPath] = process.argv.slice(2);
assert(beforePath && afterPath, 'RESOURCE_UNITS_INLINE_INPUTS_REQUIRED');
const original = readFileSync(beforePath, 'utf8');
const helper = '\n' + ppResourceUnitsInlineHtml.toString() + '\n';
const importMarker = '\nfunction ppProjectTextImportHtml(';
assert(original.includes('"x-liftorbit-ui":"etalon-modules-compat"'), 'RESOURCE_UNITS_INLINE_NATIVE_HTML_MISSING');
assert(original.split(importMarker).length <= 2, 'RESOURCE_UNITS_INLINE_IMPORT_HELPER_DRIFT');

let output;
if (original.includes('ppResourceUnitsInlineHtml')) {
  assert.equal(original.split('return new Response(ppResourceUnitsInlineHtml(ppResourceUnitsHtml(').length, 2,
    'RESOURCE_UNITS_INLINE_INSTALLED_WRAPPER_DRIFT');
  assert.equal(original.split(helper).length, 2, 'RESOURCE_UNITS_INLINE_INSTALLED_HELPER_DRIFT');
  assert.equal(original.split('function ppResourceUnitsInlineHtml(').length, 2, 'RESOURCE_UNITS_INLINE_DUPLICATE_HELPER');
  output = original;
} else {
  const matches = [...original.matchAll(/return new Response\((ppResourceUnitsHtml\((?:pp\w+Html\()*enhanced\)+),\{/g)];
  assert.equal(matches.length, 1, 'RESOURCE_UNITS_INLINE_CANONICAL_RESPONSE_DRIFT');
  const call = matches[0][1];
  let depth = 0;
  for (const char of call) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    assert(depth >= 0, 'RESOURCE_UNITS_INLINE_CALL_BOUNDARY_DRIFT');
  }
  assert.equal(depth, 0, 'RESOURCE_UNITS_INLINE_CALL_BOUNDARY_DRIFT');
  const before = matches[0][0];
  const after = 'return new Response(ppResourceUnitsInlineHtml(' + call + '),{';
  output = original.replace(before, after);
  const insertAt = output.indexOf(importMarker);
  output = insertAt < 0 ? output + helper : output.slice(0, insertAt) + helper + output.slice(insertAt);
  assert.equal(output.replace(helper, '').replace(after, before), original, 'RESOURCE_UNITS_INLINE_UNRELATED_CHANGE');
}
writeFileSync(afterPath, output);
console.log('RESOURCE_UNITS_INLINE_PATCH_PASS', JSON.stringify({changed: output !== original, onlyHtmlTransformChanged: true}));
