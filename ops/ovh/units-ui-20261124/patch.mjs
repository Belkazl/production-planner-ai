import {readFileSync, writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {ppResourceUnitsInlineHtml} from './units-ui.mjs';

const [beforePath, afterPath] = process.argv.slice(2);
assert(beforePath && afterPath, 'RESOURCE_UNITS_INLINE_INPUTS_REQUIRED');
const original = readFileSync(beforePath, 'utf8');
const helper = '\n' + ppResourceUnitsInlineHtml.toString() + '\n';
const importMarker = '\nfunction ppProjectTextImportHtml(';
const check = (condition, message) => {
  if (condition) return;
  const chains = [...original.matchAll(/return new Response\(((?:pp\w+Html\()+)/g)].slice(0, 8)
    .map(match => [...match[1].matchAll(/pp\w+Html(?=\()/g)].slice(0, 12).map(name => name[0].slice(0, 96)));
  console.error('RESOURCE_UNITS_INLINE_WRAPPERS', JSON.stringify(chains));
  throw Error(message);
};
check(original.includes('"x-liftorbit-ui":"etalon-modules-compat"'), 'RESOURCE_UNITS_INLINE_NATIVE_HTML_MISSING');
check(original.split(importMarker).length <= 2, 'RESOURCE_UNITS_INLINE_IMPORT_HELPER_DRIFT');
const namesOf = call => [...call.matchAll(/(pp\w+Html)\(/g)].map(match => match[1]);
const matches = [...original.matchAll(/return new Response\(((?:pp\w+Html\()+enhanced\)+),\{/g)]
  .filter(match => namesOf(match[1]).includes('ppResourceUnitsHtml'));
check(matches.length === 1, 'RESOURCE_UNITS_INLINE_CANONICAL_RESPONSE_DRIFT');
const call = matches[0][1];
check(namesOf(call).filter(name => name === 'ppResourceUnitsHtml').length === 1, 'RESOURCE_UNITS_INLINE_CANONICAL_COUNT_DRIFT');
let depth = 0;
for (const char of call) {
  if (char === '(') depth++;
  if (char === ')') depth--;
  check(depth >= 0, 'RESOURCE_UNITS_INLINE_CALL_BOUNDARY_DRIFT');
}
check(depth === 0, 'RESOURCE_UNITS_INLINE_CALL_BOUNDARY_DRIFT');

let output;
if (original.includes('ppResourceUnitsInlineHtml')) {
  check(call.startsWith('ppResourceUnitsInlineHtml(') && namesOf(call).filter(name => name === 'ppResourceUnitsInlineHtml').length === 1,
    'RESOURCE_UNITS_INLINE_INSTALLED_WRAPPER_DRIFT');
  check(original.split(helper).length === 2, 'RESOURCE_UNITS_INLINE_INSTALLED_HELPER_DRIFT');
  check(original.split('function ppResourceUnitsInlineHtml(').length === 2, 'RESOURCE_UNITS_INLINE_DUPLICATE_HELPER');
  output = original;
} else {
  const before = matches[0][0];
  const after = 'return new Response(ppResourceUnitsInlineHtml(' + call + '),{';
  output = original.replace(before, after);
  const insertAt = output.indexOf(importMarker);
  output = insertAt < 0 ? output + helper : output.slice(0, insertAt) + helper + output.slice(insertAt);
  check(output.replace(helper, '').replace(after, before) === original, 'RESOURCE_UNITS_INLINE_UNRELATED_CHANGE');
}
writeFileSync(afterPath, output);
console.log('RESOURCE_UNITS_INLINE_PATCH_PASS', JSON.stringify({changed: output !== original, onlyHtmlTransformChanged: true}));
