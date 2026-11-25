import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';
import {patchCombinedUi} from './patch.mjs';
import {BASELINE_UI_SHA, zoomLabelScript, ZOOM_LABEL_MARKER} from '../zoom-label-sync-20261125/zoom-label.mjs';
import {ORIGINAL_PROGRESS_WRAPPER, nativePreviewProgressWrapper, NATIVE_PREVIEW_MARKER}
  from '../native-preview-presentation-20261125/presentation.mjs';
import {nativePreviewProjectionScript, PREVIEW_PROJECTION_MARKER}
  from '../native-preview-projection-20261125/projection.mjs';
import {ppCanonicalNativeResult, ppNativePresentationPlan, ppNativeScheduleFingerprint,
  ppInstallNativePresentation} from '../integrated-setup-result-20261125/canonical.mjs';
import {resourcePresentationScript, patchResourcePresentationUi}
  from '../resource-presentation-20261125/resource-presentation.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const frontend = readFileSync(new URL('../sse-stream-v1-20261120/frontend.js.txt', import.meta.url), 'utf8');
const original = frontend + '\n' + ppNativeScheduleFingerprint.toString() + '\n' +
  ppNativePresentationPlan.toString() + '\n' + ppInstallNativePresentation.toString() +
  '\nfunction ppUnifiedGanttV2(){}\nfunction ppSecondaryGanttZoom(){}\n' + resourcePresentationScript();

test('combined transformation reverses exactly and preserves the resource suffix with strict idempotence', () => {
  const after = patchCombinedUi(original, sha(original));
  const resource = resourcePresentationScript(), label = zoomLabelScript(), projection = nativePreviewProjectionScript();
  assert(after.endsWith(label + projection + resource));
  assert.equal(after.slice(0, -label.length - projection.length - resource.length).concat(resource)
    .replace(nativePreviewProgressWrapper(), ORIGINAL_PROGRESS_WRAPPER), original);
  assert.equal(patchCombinedUi(after, sha(original)), after);
  assert.equal(patchResourcePresentationUi(after), after);
  for (const marker of [ZOOM_LABEL_MARKER, NATIVE_PREVIEW_MARKER, PREVIEW_PROJECTION_MARKER])
    assert.equal(after.split(marker).length, 2);
  for (const broken of [after + '\n', after.replace('ok:false,_pp_sse_owned:true', 'ok:true,_pp_sse_owned:true'),
    after.replace('repaired === data', 'false'), after.replace(label + projection, projection + label),
    after.replace(nativePreviewProgressWrapper(), ORIGINAL_PROGRESS_WRAPPER)])
    assert.throws(() => patchCombinedUi(broken, sha(original)));
  assert.throws(() => patchCombinedUi(original), /BASELINE_DRIFT/);
});

test('combined browser owners keep 500%, suppress retired reads and repair only an authoritative forced preview', async () => {
  const model = {orders: [{id: 'O'}], equipment: [{id: 'E'}], employees: [], setup_rules: []};
  const full = ppCanonicalNativeResult({ok: true, valid: true, partial: false, duration_minutes: 30,
    batch_count: 1, operator_wait_minutes: 0, machine_idle_minutes: 20, order_sequence: ['O'],
    operations: [{order: 'O', operation_id: 'work', batch: 1, batch_quantity: 10,
      equipment_ids: ['E'], employee_ids: [], start_min: 20, end_min: 30}], setup_operations: []}, model, 'synthetic');
  assert(ppNativePresentationPlan(full));
  const compact = {...full}; delete compact.generic_operations;
  const before = JSON.stringify(full), calls = [], origin = 'https://app.example.test', job = 'a'.repeat(32);
  const group = {classList: {contains: key => key === 'zoom'}};
  const stage = {hidden: false, width: 15000}, label = {textContent: '100%', parentElement: group};
  const nodes = {ppGanttToolV2: stage, zoomLabel: label,
    zoomIn: {parentElement: group}, zoomOut: {parentElement: group}};
  let lastNetwork;
  const context = {URL, Request, Response, Headers, console,
    location: {origin, href: origin + '/project'},
    document: {getElementById: key => nodes[key] || null},
    MutationObserver: class {observe() {} disconnect() {}},
    __PP_GANTT_TOOL_V2_INSTALLED__: true,
    __PP_GANTT_TOOL_V2__: {version: 'equipment-gantt-component-v2-20261009', zoom: 5},
    __PP_INTEGRATED_NATIVE_RESULT_V1__: {isPlan: ppNativePresentationPlan},
    originalFetch: async (input, init) => {
      calls.push({input, init});
      lastNetwork = Response.json(init?.method === 'POST' ? {ok: true, stopped: true, job_id: job, best_preview: full} :
        {ok: true, running: true, job_id: job, best_preview: compact, candidate_preview: null});
      return lastNetwork;
    },
    nurl: input => new URL(typeof input === 'string' ? input : input.url, origin),
    method: (input, init) => String(init?.method || input?.method || 'GET').toUpperCase(),
    virtualStatus: () => ({ok: true, running: true, job_id: job, best_preview: null, candidate_preview: null}),
  };
  context.window = context; vm.createContext(context);
  vm.runInContext('let disposed=false,active=true,completed=false,jobId=' + JSON.stringify(job) + ',fullData=null;\n' +
    nativePreviewProgressWrapper() + '\n' + zoomLabelScript() + nativePreviewProjectionScript(), context);
  assert.equal(label.textContent, '500%'); assert.equal(stage.width, 15000);
  const retired = await context.fetch('/api/plan-progress?_=123');
  assert.equal(retired.status, 200);
  const empty = await retired.json();
  assert.equal(empty.ok, false); assert.equal(empty._pp_sse_owned, true);
  assert.equal(empty.best_preview, null); assert.equal(calls.length, 0);
  const input = new Request(origin + '/api/plan-progress?ppForce=1&ppProgressCache=off&job_id=' + job);
  const init = {credentials: 'same-origin'};
  const forced = await context.fetch(input, init), data = await forced.json();
  assert.equal(calls.length, 1); assert.equal(calls[0].input, input); assert.equal(calls[0].init, init);
  assert.equal(data.job_id, job); assert(ppNativePresentationPlan(data.best_preview));
  assert.deepEqual(data.best_preview, full); assert.equal(label.textContent, '500%');
  context.complete = {ok: true, running: false, success: true, result: full};
  vm.runInContext('active=false;completed=true;fullData=complete;', context);
  const final = await (await context.fetch('/api/plan-progress')).json();
  assert.equal(calls.length, 1); assert.deepEqual(final, context.complete);
  const stopped = await context.fetch('/api/optimizer-stop?job_id=' + job, {method: 'POST'});
  assert.equal(stopped, lastNetwork); assert.equal(calls.length, 2);
  assert.equal(JSON.stringify(full), before);
});

const beforeRoot = process.env.LIFTORBIT_PRESENTATION_COMBINED_BEFORE;
const afterRoot = process.env.LIFTORBIT_PRESENTATION_COMBINED_AFTER;
test('actual captured before and final app bytes match all three reviewed transformations',
  {skip: !beforeRoot && !afterRoot}, () => {
    assert(beforeRoot && afterRoot, 'both actual source roots are required');
    const before = readFileSync(join(beforeRoot, 'restart-optimizer-ui.js'), 'utf8');
    const after = readFileSync(join(afterRoot, 'restart-optimizer-ui.js'), 'utf8');
    assert.equal(sha(before), BASELINE_UI_SHA);
    assert.equal(patchCombinedUi(before), after);
    assert.equal(patchCombinedUi(after), after);
    assert.equal(patchResourcePresentationUi(after), after);
    const suffix = zoomLabelScript() + nativePreviewProjectionScript() + resourcePresentationScript();
    assert(after.endsWith(suffix));
    assert.equal(after.slice(0, -suffix.length).concat(resourcePresentationScript())
      .replace(nativePreviewProgressWrapper(), ORIGINAL_PROGRESS_WRAPPER), before);
  });
