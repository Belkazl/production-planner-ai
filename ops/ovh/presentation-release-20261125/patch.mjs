/** Append two reviewed presentation installers; all existing UI bytes survive. */
import {createHash} from 'node:crypto';
import {lstatSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {ppSecondaryGanttZoom} from '../secondary-zoom-20261125/zoom.mjs';
import {patchResourcePresentationUi, resourcePresentationScript} from '../resource-presentation-20261125/resource-presentation.mjs';

export const ZOOM_MARKER = 'PP_SECONDARY_GANTT_ZOOM_PRESENTATION_20261125';
export const BASELINE_UI_SHA = JSON.parse(readFileSync(new URL('./baseline.json', import.meta.url), 'utf8'))
  .app_hashes['restart-optimizer-ui.js'];
const sha = value => createHash('sha256').update(value).digest('hex');
const MAX_FILE = 4 * 1024 * 1024;

export function zoomScript() {
  return '\n;/* ' + ZOOM_MARKER + ' */\n;(' + ppSecondaryGanttZoom.toString() + ')();\n';
}

export function presentationSuffix() {
  // Resource presentation stays last, preserving its own exact suffix guard.
  return zoomScript() + resourcePresentationScript();
}

export function patchPresentationUi(source, expectedBefore = BASELINE_UI_SHA) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > MAX_FILE ||
      typeof expectedBefore !== 'string' || !/^[0-9a-f]{64}$/.test(expectedBefore))
    throw Error('PRESENTATION_SOURCE_BOUND');
  const suffix = presentationSuffix();
  const installed = source.includes(ZOOM_MARKER);
  if (installed) {
    if (source.split(ZOOM_MARKER).length !== 2 || !source.endsWith(suffix))
      throw Error('PRESENTATION_INSTALLED_SOURCE_DRIFT');
    const original = source.slice(0, -suffix.length);
    if (sha(original) !== expectedBefore) throw Error('PRESENTATION_BASELINE_DRIFT');
    if (patchResourcePresentationUi(original + zoomScript()) !== source)
      throw Error('PRESENTATION_REVERSE_GUARD');
    new vm.Script(source);
    return source;
  }
  if (sha(source) !== expectedBefore) throw Error('PRESENTATION_BASELINE_DRIFT');
  if (source.includes('__PP_SECONDARY_GANTT_ZOOM_V1__') || source.includes('function ppSecondaryGanttZoom('))
    throw Error('PRESENTATION_PARTIAL_INSTALL');
  const after = patchResourcePresentationUi(source + zoomScript());
  if (after !== source + suffix || after.slice(0, -suffix.length) !== source)
    throw Error('PRESENTATION_APPEND_GUARD');
  new vm.Script(after);
  return after;
}

export function patchApp(appRoot) {
  const target = join(resolve(appRoot), 'restart-optimizer-ui.js');
  const info = lstatSync(target);
  if (!info.isFile() || info.isSymbolicLink() || !info.size || info.size > MAX_FILE)
    throw Error('PRESENTATION_SOURCE_FILE');
  const before = readFileSync(target, 'utf8');
  const after = patchPresentationUi(before);
  if (after !== before) writeFileSync(target, after);
  return {changed: before !== after, before: sha(before), after: sha(after)};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw Error('PRESENTATION_ARGUMENTS');
    const result = patchApp(process.argv[2]);
    console.log('PRESENTATION_UI_APPEND_VERIFIED ' + JSON.stringify(result));
  } catch {
    // Never put captured UI source or parser excerpts into workflow output.
    console.error('PRESENTATION_UI_APPEND_REJECTED');
    process.exitCode = 6;
  }
}
