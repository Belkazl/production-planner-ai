import {createHash} from 'node:crypto';
import {existsSync, lstatSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {resourcePresentationScript} from '../resource-presentation-20261125/resource-presentation.mjs';

/**
 * Restore the one alias removed by the public lossless progress compactor.
 * The existing presentation checksum must match without changing its stamp.
 * This is not an authorization check; the original authenticated request and
 * server account/model/job boundaries remain responsible for access control.
 */
export function ppRestoreNativePreviewAlias(plan, isPlan) {
  try {
    if (!plan || typeof plan !== 'object' || Array.isArray(plan) ||
        Object.hasOwn(plan, 'generic_operations') || typeof isPlan !== 'function' ||
        plan.valid !== true || plan.ok === false || plan.partial === true ||
        !Array.isArray(plan.operations) || !plan.operations.length || plan.operations.length > 100000 ||
        plan._pp_native_schedule_v1?.version !== 'integrated-native-setup-v1-20261125' ||
        typeof plan._pp_native_schedule_v1.signature !== 'string' ||
        !/^[0-9a-f]{16}$/.test(plan._pp_native_schedule_v1.signature)) return plan;
    const restored = {...plan, generic_operations: plan.operations};
    return isPlan(restored) === true ? restored : plan;
  } catch { return plan; }
}

/** Only the two running-preview fields are eligible for presentation repair. */
export function ppRestoreNativePreviewEnvelope(data, isPlan) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.ok !== true || data.running !== true)
    return data;
  let result = data;
  for (const key of ['best_preview', 'candidate_preview']) {
    if (!Object.hasOwn(data, key)) continue;
    const value = ppRestoreNativePreviewAlias(data[key], isPlan);
    if (value !== data[key]) {
      if (result === data) result = {...data};
      result[key] = value;
    }
  }
  return result;
}

export function ppInstallNativePreviewProjection() {
  'use strict';
  if (window.__PP_NATIVE_PREVIEW_PROJECTION_V1__?.installed)
    return window.__PP_NATIVE_PREVIEW_PROJECTION_V1__;
  const previous = window.fetch;
  const isPlan = window.__PP_INTEGRATED_NATIVE_RESULT_V1__?.isPlan;
  if (typeof previous !== 'function' || typeof isPlan !== 'function') return null;
  const origin = window.location.origin;
  function eligible(input, init) {
    try {
      const method = String(init?.method || input?.method || 'GET').toUpperCase();
      const url = new URL(typeof input === 'string' ? input : input?.url || String(input), window.location.href);
      return method === 'GET' && url.origin === origin && url.pathname === '/api/plan-progress';
    } catch { return false; }
  }
  window.fetch = async function ppNativePreviewProjectionFetch(input, init) {
    // Forward the original request, its options, query and receiver exactly.
    // No polling, retries, account switching or plan cache is introduced.
    const response = await previous.apply(this, arguments);
    if (!eligible(input, init) || !(response instanceof Response) || response.status !== 200) return response;
    try {
      if (response.type === 'opaque' || response.type === 'opaqueredirect' ||
          response.url && new URL(response.url).origin !== origin) return response;
      const text = await response.clone().text();
      if (text.length > 32 * 1024 * 1024) return response;
      const data = JSON.parse(text), repaired = ppRestoreNativePreviewEnvelope(data, isPlan);
      if (repaired === data) return response;
      const headers = new Headers(response.headers);
      // These transport lengths/encodings describe the old serialized body.
      // All application/security/cache headers and the HTTP status survive.
      for (const name of ['content-length', 'content-encoding', 'transfer-encoding']) headers.delete(name);
      if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify(repaired), {status: response.status, statusText: response.statusText, headers});
    } catch { return response; }
  };
  const api = Object.freeze({installed: true, version: 'native-preview-projection-v1-20261125'});
  window.__PP_NATIVE_PREVIEW_PROJECTION_V1__ = api;
  return api;
}

export const PREVIEW_PROJECTION_MARKER = 'PP_NATIVE_PREVIEW_PROJECTION_20261125';
export const BASELINE_UI_SHA = 'dbd5b4ec0f616be52bfb06e9a288e2937a3ed4ec58eb55aa960e8e6fd542fde4';
const digest = value => createHash('sha256').update(value).digest('hex');
const MAX_SOURCE = 4 * 1024 * 1024;

export function nativePreviewProjectionScript() {
  return '\n;/* ' + PREVIEW_PROJECTION_MARKER + ' */\n' +
    ppRestoreNativePreviewAlias.toString() + '\n' + ppRestoreNativePreviewEnvelope.toString() + '\n' +
    ';(' + ppInstallNativePreviewProjection.toString() + ')();\n';
}

/** Install after the existing fetch controller, before the unchanged resource suffix. */
export function patchNativePreviewProjectionUi(source, expectedBefore = BASELINE_UI_SHA) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > MAX_SOURCE ||
      typeof expectedBefore !== 'string' || !/^[0-9a-f]{64}$/.test(expectedBefore))
    throw Error('NATIVE_PREVIEW_PROJECTION_SOURCE_BOUND');
  const resource = resourcePresentationScript(), addon = nativePreviewProjectionScript();
  if (!source.endsWith(resource)) throw Error('NATIVE_PREVIEW_PROJECTION_RESOURCE_SUFFIX_DRIFT');
  let original = source;
  const installed = source.includes(PREVIEW_PROJECTION_MARKER);
  if (installed) {
    if (source.split(PREVIEW_PROJECTION_MARKER).length !== 2 || !source.endsWith(addon + resource))
      throw Error('NATIVE_PREVIEW_PROJECTION_INSTALLED_SOURCE_DRIFT');
    original = source.slice(0, -addon.length - resource.length) + resource;
  }
  if (digest(original) !== expectedBefore) throw Error('NATIVE_PREVIEW_PROJECTION_BASELINE_DRIFT');
  for (const anchor of ['function ppSseNativeProgressNoPoll(input,init){',
    'function ppNativePresentationPlan(', 'window.__PP_INTEGRATED_NATIVE_RESULT_V1__ = {'])
    if (original.split(anchor).length !== 2) throw Error('NATIVE_PREVIEW_PROJECTION_REQUIRED_SOURCE_GUARD');
  for (const name of ['ppRestoreNativePreviewAlias', 'ppRestoreNativePreviewEnvelope',
    'ppInstallNativePreviewProjection', '__PP_NATIVE_PREVIEW_PROJECTION_V1__'])
    if (original.includes(name)) throw Error('NATIVE_PREVIEW_PROJECTION_PARTIAL_INSTALL');
  const after = original.slice(0, -resource.length) + addon + resource;
  if (Buffer.byteLength(after) > MAX_SOURCE ||
      after.slice(0, -addon.length - resource.length) + resource !== original ||
      installed && after !== source) throw Error('NATIVE_PREVIEW_PROJECTION_REVERSE_GUARD');
  new vm.Script(after);
  return after;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw Error('NATIVE_PREVIEW_PROJECTION_ARGUMENTS');
    const input = resolve(process.argv[2]), output = resolve(process.argv[3]);
    const info = lstatSync(input);
    if (!info.isFile() || info.isSymbolicLink() || !info.size || info.size > MAX_SOURCE ||
        existsSync(output) && (lstatSync(output).isSymbolicLink() || !lstatSync(output).isFile()))
      throw Error('NATIVE_PREVIEW_PROJECTION_SOURCE_FILE');
    const before = readFileSync(input, 'utf8'), after = patchNativePreviewProjectionUi(before);
    if (input !== output || after !== before) writeFileSync(output, after);
    console.log('NATIVE_PREVIEW_PROJECTION_PATCH_PASS ' + JSON.stringify({changed: before !== after,
      before: digest(before), after: digest(after)}));
  } catch {
    console.error('NATIVE_PREVIEW_PROJECTION_PATCH_REJECTED');
    process.exitCode = 6;
  }
}
