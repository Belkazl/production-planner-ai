import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {patchPresentationUi, presentationSuffix, zoomScript, ZOOM_MARKER, BASELINE_UI_SHA} from './patch.mjs';
import {patchResourcePresentationUi, resourcePresentationScript} from '../resource-presentation-20261125/resource-presentation.mjs';

const sha = source => createHash('sha256').update(source).digest('hex');
// Public synthetic shape only; no captured page, DOM, model or schedule.
const fixture = `// Synthetic pre-existing UI
function ppNativePresentationPlan(plan) { return plan; }
function ppInstallNativePresentation() {}
function ppUnifiedGanttV2() {}
window.__PP_INTEGRATED_NATIVE_RESULT_V1__ = {};
const existingUiSentinel = "retained byte for byte";
`;

test('combined append is exact, preserves old bytes and leaves resource helper last', () => {
  const after = patchPresentationUi(fixture, sha(fixture));
  assert.equal(after, fixture + zoomScript() + resourcePresentationScript());
  assert.equal(after.slice(0, -presentationSuffix().length), fixture);
  assert.equal(patchPresentationUi(after, sha(fixture)), after);
  assert.equal(patchResourcePresentationUi(after), after, 'resource helper remains independently idempotent');
  assert.equal(after.split(ZOOM_MARKER).length, 2);
  assert(!presentationSuffix().includes('/api/plan'), 'no optimizer transport added');
  assert(!presentationSuffix().includes('localStorage.setItem'), 'no persisted model or plan mutation');
});

test('baseline, malformed suffix, duplicate and partial installs fail closed', () => {
  assert.throws(() => patchPresentationUi(fixture), /BASELINE_DRIFT/);
  assert.throws(() => patchPresentationUi(fixture + '\n', sha(fixture)), /BASELINE_DRIFT/);
  const after = patchPresentationUi(fixture, sha(fixture));
  for (const broken of [after + '\n', after.replace('retained byte for byte', 'modified existing bytes'),
    after + '\n/* ' + ZOOM_MARKER + ' */', fixture + zoomScript()]) {
    assert.throws(() => patchPresentationUi(broken, sha(fixture)));
  }
  const partial = fixture + '\nwindow.__PP_SECONDARY_GANTT_ZOOM_V1__ = {};';
  assert.throws(() => patchPresentationUi(partial, sha(partial)), /PARTIAL_INSTALL/);
});

const beforeRoot = process.env.LIFTORBIT_PRESENTATION_FIXTURE_ROOT;
const afterRoot = process.env.LIFTORBIT_PRESENTATION_PATCHED_ROOT;
test('actual captured UI matches pinned baseline and exact accepted append', {skip: !beforeRoot && !afterRoot}, () => {
  assert(beforeRoot && afterRoot, 'both captured and patched roots are mandatory');
  const before = readFileSync(join(beforeRoot, 'restart-optimizer-ui.js'), 'utf8');
  const after = readFileSync(join(afterRoot, 'restart-optimizer-ui.js'), 'utf8');
  assert.equal(sha(before), BASELINE_UI_SHA);
  assert.equal(patchPresentationUi(before), after);
  assert.equal(after.slice(0, -presentationSuffix().length), before);
  assert.equal(patchPresentationUi(after), after);
  assert.equal(patchResourcePresentationUi(after), after);
  const baseline = JSON.parse(readFileSync(new URL('./baseline.json', import.meta.url), 'utf8'));
  for (const [name, expected] of Object.entries(baseline.app_hashes)) {
    assert.equal(sha(readFileSync(join(beforeRoot, name))), expected);
    if (name !== 'restart-optimizer-ui.js')
      assert.deepEqual(readFileSync(join(afterRoot, name)), readFileSync(join(beforeRoot, name)));
  }
});
