import {readFileSync, writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {ppGanttZoom500Html} from './zoom.mjs';

const [beforePath, afterPath] = process.argv.slice(2);
assert(beforePath && afterPath, 'GANTT_ZOOM_500_INPUTS_REQUIRED');
const original = readFileSync(beforePath, 'utf8');
const before = 'ppNonBlockingDbSyncHtml(enhanced)';
const after = 'ppGanttZoom500Html(ppNonBlockingDbSyncHtml(enhanced))';
const helper = '\n' + ppGanttZoom500Html.toString() + '\n';
const importMarker = '\nfunction ppProjectTextImportHtml(';
assert(original.includes('"x-liftorbit-ui":"etalon-modules-compat"'), 'GANTT_ZOOM_500_NATIVE_HTML_MISSING');
assert.equal(original.split(before).length, 2, 'GANTT_ZOOM_500_HTML_ANCHOR_DRIFT');
assert(original.split(importMarker).length <= 2, 'GANTT_ZOOM_500_IMPORT_HELPER_DRIFT');

let output;
if (original.includes('ppGanttZoom500Html')) {
  assert.equal(original.split(after).length, 2, 'GANTT_ZOOM_500_INSTALLED_WRAPPER_DRIFT');
  assert.equal(original.split(helper).length, 2, 'GANTT_ZOOM_500_INSTALLED_HELPER_DRIFT');
  assert.equal(original.split('function ppGanttZoom500Html(').length, 2, 'GANTT_ZOOM_500_DUPLICATE_HELPER');
  output = original;
} else {
  output = original.replace(before, after);
  const insertAt = output.indexOf(importMarker);
  output = insertAt < 0 ? output + helper : output.slice(0, insertAt) + helper + output.slice(insertAt);
  assert.equal(output.replace(helper, '').replace(after, before), original, 'GANTT_ZOOM_500_UNRELATED_CHANGE');
}
writeFileSync(afterPath, output);
console.log('GANTT_ZOOM_500_PATCH_PASS', JSON.stringify({changed: output !== original, onlyHtmlTransformChanged: true}));
