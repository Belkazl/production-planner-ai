import {createHash} from 'node:crypto';
import {existsSync, lstatSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {resourcePresentationScript} from '../resource-presentation-20261125/resource-presentation.mjs';

/** Present the scale published by native draw(); never own or change zoom. */
export function ppInstallNativeGanttZoomLabelSync() {
  'use strict';
  if (window.__PP_NATIVE_GANTT_ZOOM_LABEL_SYNC_V1__?.installed)
    return window.__PP_NATIVE_GANTT_ZOOM_LABEL_SYNC_V1__;

  const stage = document.getElementById('ppGanttToolV2');
  const label = document.getElementById('zoomLabel');
  const group = label?.parentElement;
  if (!window.__PP_GANTT_TOOL_V2_INSTALLED__ || !stage || !label ||
      !group?.classList.contains('zoom') ||
      document.getElementById('zoomIn')?.parentElement !== group ||
      document.getElementById('zoomOut')?.parentElement !== group) {
    console.warn('PP_NATIVE_GANTT_ZOOM_LABEL_PREREQUISITES_MISSING');
    return null;
  }

  const actualZoom = () => {
    // clearPlan hides the native stage but leaves its last diagnostic object.
    // That old object must not repaint a cleared or fresh-search empty view.
    if (stage.hidden || document.getElementById('ppGanttToolV2') !== stage ||
        document.getElementById('zoomLabel') !== label) return null;
    const native = window.__PP_GANTT_TOOL_V2__;
    if (native?.version !== 'equipment-gantt-component-v2-20261009' ||
        typeof native.zoom !== 'number' || !Number.isFinite(native.zoom) ||
        native.zoom < .5 || native.zoom > 5) return null;
    return native.zoom;
  };

  let observer;
  const observe = () => {
    // Native draw replaces the stage's direct children. The separate label
    // observation also catches a later legacy applyZoom() reset to 100%.
    observer.observe(stage, {childList: true, attributes: true, attributeFilter: ['hidden']});
    observer.observe(label, {childList: true, characterData: true, subtree: true});
  };
  const sync = () => {
    const zoom = actualZoom();
    if (zoom === null) return false;
    const text = Math.round(zoom * 100) + '%';
    if (label.textContent === text) return false;
    // Do not enqueue an observer callback for our own text-only correction.
    observer.disconnect();
    try { label.textContent = text; }
    finally { observe(); }
    return true;
  };
  observer = new MutationObserver(sync);
  observe();
  const api = Object.freeze({installed: true, engine: 'PP_GANTT_TOOL_V2', sync,
    get actualZoom() { return actualZoom(); }});
  window.__PP_NATIVE_GANTT_ZOOM_LABEL_SYNC_V1__ = api;
  sync();
  return api;
}

export const BASELINE_UI_SHA = 'dbd5b4ec0f616be52bfb06e9a288e2937a3ed4ec58eb55aa960e8e6fd542fde4';
export const ZOOM_LABEL_MARKER = 'PP_NATIVE_GANTT_ZOOM_LABEL_SYNC_20261125';
const digest = value => createHash('sha256').update(value).digest('hex');
const MAX_SOURCE = 4 * 1024 * 1024;

export function zoomLabelScript() {
  return '\n;/* ' + ZOOM_LABEL_MARKER + ' */\n;(' + ppInstallNativeGanttZoomLabelSync.toString() + ')();\n';
}

/** Insert before the frozen resource suffix, retaining every original byte. */
export function patchZoomLabelUi(source, expectedBefore = BASELINE_UI_SHA) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > MAX_SOURCE ||
      typeof expectedBefore !== 'string' || !/^[0-9a-f]{64}$/.test(expectedBefore))
    throw Error('ZOOM_LABEL_SYNC_SOURCE_BOUND');
  const resource = resourcePresentationScript(), addon = zoomLabelScript();
  if (!source.endsWith(resource)) throw Error('ZOOM_LABEL_SYNC_RESOURCE_SUFFIX_DRIFT');
  let original = source;
  const installed = source.includes(ZOOM_LABEL_MARKER);
  if (installed) {
    if (source.split(ZOOM_LABEL_MARKER).length !== 2 || !source.endsWith(addon + resource))
      throw Error('ZOOM_LABEL_SYNC_INSTALLED_SOURCE_DRIFT');
    original = source.slice(0, -addon.length - resource.length) + resource;
  }
  if (digest(original) !== expectedBefore) throw Error('ZOOM_LABEL_SYNC_BASELINE_DRIFT');
  for (const anchor of ['function ppUnifiedGanttV2()', 'function ppSecondaryGanttZoom()',
    'function ppInstallNativeResourcePresentation()'])
    if (original.split(anchor).length !== 2) throw Error('ZOOM_LABEL_SYNC_REQUIRED_SOURCE_GUARD');
  if (original.includes('ppInstallNativeGanttZoomLabelSync') || original.includes('__PP_NATIVE_GANTT_ZOOM_LABEL_SYNC_V1__'))
    throw Error('ZOOM_LABEL_SYNC_PARTIAL_INSTALL');
  const after = original.slice(0, -resource.length) + addon + resource;
  if (Buffer.byteLength(after) > MAX_SOURCE ||
      after.slice(0, -addon.length - resource.length) + resource !== original ||
      installed && after !== source) throw Error('ZOOM_LABEL_SYNC_REVERSE_GUARD');
  new vm.Script(after);
  return after;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw Error('ZOOM_LABEL_SYNC_ARGUMENTS');
    const input = resolve(process.argv[2]), output = resolve(process.argv[3]);
    const info = lstatSync(input);
    if (!info.isFile() || info.isSymbolicLink() || !info.size || info.size > MAX_SOURCE ||
        existsSync(output) && (lstatSync(output).isSymbolicLink() || !lstatSync(output).isFile()))
      throw Error('ZOOM_LABEL_SYNC_SOURCE_FILE');
    const before = readFileSync(input, 'utf8'), after = patchZoomLabelUi(before);
    if (input !== output || after !== before) writeFileSync(output, after);
    console.log('ZOOM_LABEL_SYNC_PATCH_PASS ' + JSON.stringify({changed: before !== after,
      before: digest(before), after: digest(after)}));
  } catch {
    console.error('ZOOM_LABEL_SYNC_PATCH_REJECTED');
    process.exitCode = 6;
  }
}
