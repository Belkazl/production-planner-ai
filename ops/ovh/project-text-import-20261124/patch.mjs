import {readFileSync, writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {transformSource} from './text-import.mjs';

const [beforePath, afterPath] = process.argv.slice(2);
assert(beforePath && afterPath, 'PROJECT_TEXT_IMPORT_INPUTS');
const original = readFileSync(beforePath, 'utf8');
const before = 'return new Response(ppResourceUnitsHtml(ppNonBlockingDbSyncHtml(enhanced)),{';
const after = 'return new Response(ppProjectTextImportHtml(ppResourceUnitsHtml(ppNonBlockingDbSyncHtml(enhanced))),{';
assert.equal(original.split(before).length, 2, 'PROJECT_TEXT_IMPORT_AUTH_ANCHOR_DRIFT');
assert(!original.includes('function ppProjectTextImportHtml('), 'PROJECT_TEXT_IMPORT_ALREADY_INSTALLED');
assert(original.includes('"x-liftorbit-ui":"etalon-modules-compat"'), 'PROJECT_TEXT_IMPORT_NATIVE_HTML_MISSING');
const helper = '\n' + transformSource();
const output = original.replace(before, after) + helper;
assert.equal(output.slice(0, -helper.length).replace(after, before), original, 'PROJECT_TEXT_IMPORT_UNRELATED_CHANGE');
writeFileSync(afterPath, output);
console.log('PROJECT_TEXT_IMPORT_PATCH_PASS', JSON.stringify({onlyHtmlTransformChanged:true}));
