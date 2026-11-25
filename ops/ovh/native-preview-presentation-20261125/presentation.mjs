import {createHash} from 'node:crypto';
import {existsSync, lstatSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

// These are the two retired preview readers, not the native transport,
// reconnect, Stop, forced diagnostics, or job-scoped final-result readers.
export function ppIsRetiredPreviewProgressRead(url, method, origin) {
  if (!url || url.origin !== origin || url.pathname !== '/api/plan-progress' || method !== 'GET') return false;
  const entries = [...url.searchParams];
  return entries.length === 0 || entries.length === 1 && entries[0][0] === '_';
}

export const NATIVE_PREVIEW_MARKER = 'PP_NATIVE_PREVIEW_RETIRED_READERS_20261125';
export const BASELINE_UI_SHA = 'dbd5b4ec0f616be52bfb06e9a288e2937a3ed4ec58eb55aa960e8e6fd542fde4';
const MAX_SOURCE = 4 * 1024 * 1024;
const digest = value => createHash('sha256').update(value).digest('hex');

// This complete wrapper is already public in the frozen SSE frontend source.
// Preserve its original body byte-for-byte after the new, narrower first branch.
export const ORIGINAL_PROGRESS_WRAPPER = String.raw`window.fetch=function ppSseNativeProgressNoPoll(input,init){
 const u=nurl(input);
 if(!disposed&&(completed||(active&&jobId))&&u?.origin===location.origin&&
   u.pathname==="/api/plan-progress"&&method(input,init)==="GET"&&
   !["ppStopConfirm","ppForce"].some(k=>u.searchParams.has(k))){
  if(completed&&fullData)return Promise.resolve(Response.json(fullData,{headers:{"cache-control":"no-store"}}));
  return Promise.resolve(Response.json(virtualStatus(),{headers:{"cache-control":"no-store"}}));
 }
 return originalFetch(input,init);
};`;

export function nativePreviewProgressWrapper() {
  const head = 'window.fetch=function ppSseNativeProgressNoPoll(input,init){\n const u=nurl(input);';
  const branch = '\n // ' + NATIVE_PREVIEW_MARKER + '\n' +
    ' // SSE owns the visible best while active, including the job-binding gap.\n' +
    ' // HTTP remains successful; old readers decline this explicit non-plan status.\n' +
    ' if(!disposed&&active&&ppIsRetiredPreviewProgressRead(u,method(input,init),location.origin)){\n' +
    '  return Promise.resolve(Response.json({...virtualStatus(),ok:false,_pp_sse_owned:true},\n' +
    '   {headers:{"cache-control":"no-store"}}));\n' +
    ' }';
  return ppIsRetiredPreviewProgressRead.toString() + '\n' +
    ORIGINAL_PROGRESS_WRAPPER.replace(head, head + branch);
}

/** One exact controller edit; no appended owner, metrics, plan, or new timer. */
export function patchNativePreviewPresentationUi(source, expectedBefore = BASELINE_UI_SHA) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > MAX_SOURCE ||
      typeof expectedBefore !== 'string' || !/^[0-9a-f]{64}$/.test(expectedBefore))
    throw Error('NATIVE_PREVIEW_PRESENTATION_SOURCE_BOUND');
  const replacement = nativePreviewProgressWrapper();
  const installed = source.includes(NATIVE_PREVIEW_MARKER);
  let original = source;
  if (installed) {
    if (source.split(NATIVE_PREVIEW_MARKER).length !== 2 || source.split(replacement).length !== 2 ||
        source.includes(ORIGINAL_PROGRESS_WRAPPER)) throw Error('NATIVE_PREVIEW_PRESENTATION_INSTALLED_DRIFT');
    original = source.replace(replacement, ORIGINAL_PROGRESS_WRAPPER);
  }
  if (digest(original) !== expectedBefore) throw Error('NATIVE_PREVIEW_PRESENTATION_BASELINE_DRIFT');
  for (const guard of [ORIGINAL_PROGRESS_WRAPPER, 'const virtualStatus=()=>({',
    'window.__PP_SSE_PROGRESS_V1__={', 'window.addEventListener("pp:optimizer-started",startHandler);'])
    if (original.split(guard).length !== 2) throw Error('NATIVE_PREVIEW_PRESENTATION_REQUIRED_GUARD');
  if (original.includes('ppIsRetiredPreviewProgressRead') || original.includes('_pp_sse_owned'))
    throw Error('NATIVE_PREVIEW_PRESENTATION_PARTIAL_INSTALL');
  const output = original.replace(ORIGINAL_PROGRESS_WRAPPER, replacement);
  if (Buffer.byteLength(output) > MAX_SOURCE || output.replace(replacement, ORIGINAL_PROGRESS_WRAPPER) !== original ||
      installed && output !== source) throw Error('NATIVE_PREVIEW_PRESENTATION_REVERSE_GUARD');
  new vm.Script(output);
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw Error('NATIVE_PREVIEW_PRESENTATION_ARGUMENTS');
    const input = resolve(process.argv[2]), output = resolve(process.argv[3]);
    const info = lstatSync(input);
    if (!info.isFile() || info.isSymbolicLink() || !info.size || info.size > MAX_SOURCE ||
        existsSync(output) && (lstatSync(output).isSymbolicLink() || !lstatSync(output).isFile()))
      throw Error('NATIVE_PREVIEW_PRESENTATION_SOURCE_FILE');
    const before = readFileSync(input, 'utf8'), after = patchNativePreviewPresentationUi(before);
    if (input !== output || before !== after) writeFileSync(output, after);
    console.log('NATIVE_PREVIEW_PRESENTATION_PATCH_PASS ' + JSON.stringify({changed: before !== after,
      before: digest(before), after: digest(after)}));
  } catch {
    console.error('NATIVE_PREVIEW_PRESENTATION_PATCH_REJECTED');
    process.exitCode = 6;
  }
}
