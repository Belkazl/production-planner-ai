/** One exact UI target: retired-reader branch, label sync, and alias repair. */
import {createHash} from 'node:crypto';
import {lstatSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {BASELINE_UI_SHA, patchZoomLabelUi, zoomLabelScript, ZOOM_LABEL_MARKER} from '../zoom-label-sync-20261125/zoom-label.mjs';
import {BASELINE_UI_SHA as PREVIEW_BASELINE, patchNativePreviewPresentationUi,
  ORIGINAL_PROGRESS_WRAPPER, nativePreviewProgressWrapper, NATIVE_PREVIEW_MARKER}
  from '../native-preview-presentation-20261125/presentation.mjs';
import {BASELINE_UI_SHA as PROJECTION_BASELINE, patchNativePreviewProjectionUi,
  nativePreviewProjectionScript, PREVIEW_PROJECTION_MARKER}
  from '../native-preview-projection-20261125/projection.mjs';
import {resourcePresentationScript} from '../resource-presentation-20261125/resource-presentation.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const baseline = JSON.parse(readFileSync(new URL('./baseline.json', import.meta.url), 'utf8'));

export function patchCombinedUi(source, expectedBefore = BASELINE_UI_SHA) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > 4 * 1024 * 1024 ||
      typeof expectedBefore !== 'string' || !/^[0-9a-f]{64}$/.test(expectedBefore))
    throw Error('ZOOM_LABEL_RELEASE_COMBINED_SOURCE_BOUND');
  const resource = resourcePresentationScript(), label = zoomLabelScript(), projection = nativePreviewProjectionScript();
  const replacement = nativePreviewProgressWrapper();
  const markers = [ZOOM_LABEL_MARKER, NATIVE_PREVIEW_MARKER, PREVIEW_PROJECTION_MARKER];
  const installed = markers.some(marker => source.includes(marker));
  let original = source;
  if (installed) {
    if (markers.some(marker => source.split(marker).length !== 2) ||
        !source.endsWith(label + projection + resource) || source.split(replacement).length !== 2 ||
        source.includes(ORIGINAL_PROGRESS_WRAPPER)) throw Error('ZOOM_LABEL_RELEASE_COMBINED_INSTALLED_DRIFT');
    original = (source.slice(0, -label.length - projection.length - resource.length) + resource)
      .replace(replacement, ORIGINAL_PROGRESS_WRAPPER);
  }
  if (sha(original) !== expectedBefore) throw Error('ZOOM_LABEL_RELEASE_COMBINED_BASELINE_DRIFT');
  const reader = patchNativePreviewPresentationUi(original, expectedBefore);
  const labeled = patchZoomLabelUi(reader, sha(reader));
  const after = patchNativePreviewProjectionUi(labeled, sha(labeled));
  const reversed = (after.slice(0, -label.length - projection.length - resource.length) + resource)
    .replace(replacement, ORIGINAL_PROGRESS_WRAPPER);
  if (reversed !== original || installed && after !== source)
    throw Error('ZOOM_LABEL_RELEASE_COMBINED_REVERSE_GUARD');
  return after;
}

export function patchApp(appRoot) {
  if (baseline.app_hashes['restart-optimizer-ui.js'] !== BASELINE_UI_SHA ||
      PREVIEW_BASELINE !== BASELINE_UI_SHA || PROJECTION_BASELINE !== BASELINE_UI_SHA)
    throw Error('ZOOM_LABEL_RELEASE_BASELINE_MISMATCH');
  const target = join(resolve(appRoot), 'restart-optimizer-ui.js');
  const info = lstatSync(target);
  if (!info.isFile() || info.isSymbolicLink() || !info.size || info.size > 4 * 1024 * 1024)
    throw Error('ZOOM_LABEL_RELEASE_SOURCE_FILE');
  const before = readFileSync(target, 'utf8');
  const after = patchCombinedUi(before, BASELINE_UI_SHA);
  if (after !== before) writeFileSync(target, after);
  return {changed: before !== after, before: sha(before), after: sha(after)};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw Error('ZOOM_LABEL_RELEASE_ARGUMENTS');
    console.log('ZOOM_LABEL_RELEASE_INSERTION_VERIFIED ' + JSON.stringify(patchApp(process.argv[2])));
  } catch {
    console.error('ZOOM_LABEL_RELEASE_INSERTION_REJECTED');
    process.exitCode = 6;
  }
}
