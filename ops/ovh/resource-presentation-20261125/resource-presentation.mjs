import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

/** Presentation only: use the existing generic renderer for the same schedule. */
export function ppNativeResourcePresentation(plan, sourceModel, isNativePlan) {
  try {
    if (typeof isNativePlan !== 'function' || isNativePlan(plan) !== true ||
        !sourceModel || !Array.isArray(sourceModel.technical_processes) ||
        !sourceModel.technical_processes.some(row => Array.isArray(row?.operations) && row.operations.length) ||
        !Array.isArray(sourceModel.orders) || !sourceModel.orders.length ||
        !Array.isArray(plan.generic_operations) || !plan.generic_operations.length) return null;
    const sid = value => String(value ?? '').trim();
    const orders = new Set(sourceModel.orders.map(row => sid(row?.id)).filter(Boolean));
    const equipment = new Set((sourceModel.equipment?.length ? sourceModel.equipment : sourceModel.autoclaves || [])
      .map(row => sid(row?.id || row?.name)).filter(Boolean));
    const employees = new Set((sourceModel.employees || []).map(row => sid(row?.id || row?.name)).filter(Boolean));
    let production = 0;
    for (const row of plan.generic_operations) {
      if (!row || !Array.isArray(row.equipment_ids) || !Array.isArray(row.employee_ids) ||
          row.equipment_ids.some(id => !equipment.has(sid(id))) ||
          row.employee_ids.some(id => !employees.has(sid(id)))) return null;
      const setup = row.is_setup === true || String(row.phase || row.type || '').toLowerCase() === 'setup';
      const order = row.order ?? row.order_id;
      if (order != null && !orders.has(sid(order))) return null;
      if (!setup) {
        if (order == null || !orders.has(sid(order))) return null;
        production++;
      }
    }
    if (!production) return null;
    // No rows, quantities, times, assignments, metrics or saved state change.
    return plan.generic_schedule === true ? plan : {...plan, generic_schedule: true};
  } catch { return null; }
}

export function ppInstallNativeResourcePresentation() {
  if (window.__PP_NATIVE_RESOURCE_PRESENTATION_V1__?.installed || typeof window.renderPlan !== 'function') return;
  let selected = null, ownedCache = null, selectedScope = '', selectionObserved = false, selectedDuringFresh = false;
  let scheduled = false, replaying = false;
  const project = () => {
    try {
      const id = localStorage.getItem('prodplan.project.active.v2');
      const rows = JSON.parse(localStorage.getItem('prodplan.projects.v2') || '[]');
      return id && Array.isArray(rows) ? rows.find(row => row && String(row.id) === String(id)) || null : null;
    } catch { return null; }
  };
  const modelNow = () => {
    try { return typeof model === 'object' && model ? model : project()?.model || null; }
    catch { return project()?.model || null; }
  };
  const scope = p => p ? JSON.stringify([String(p.id), Number(p.revision || 0)]) : '';
  let visibleScope = scope(project()), observedTab = window.__ppTabPlan;
  const fresh = p => !!p && window.__ppFreshRestartMode === true &&
    String(window.__ppFreshRestartProject) === String(p.id);
  const adapt = plan => ppNativeResourcePresentation(plan, modelNow(),
    window.__PP_INTEGRATED_NATIVE_RESULT_V1__?.isPlan);
  const current = () => {
    const p = project(), key = scope(p);
    if (key !== visibleScope) return null;
    if (fresh(p)) {
      // The first fresh result remains the comparison baseline. A later
      // explicit selection is the visible schedule, including Continue/Stop.
      if (selectionObserved && selectedScope === key && selectedDuringFresh) {
        if (window.__ppTabPlan !== observedTab) {
          observedTab = window.__ppTabPlan;
          selected = adapt(observedTab);
        }
        return adapt(selected);
      }
      return window.__ppFreshReferencePlan ? adapt(window.__ppFreshReferencePlan) : null;
    }
    if (selectionObserved && selectedScope === key) {
      // Some existing saved-plan/Stop handlers retain an earlier renderer
      // reference. Their explicit visible selection still wins over our cache.
      if (window.__ppTabPlan !== observedTab) {
        observedTab = window.__ppTabPlan;
        selected = adapt(observedTab);
      }
      return adapt(selected);
    }
    // A visible selection takes precedence over saved plans. Do not replace an
    // explicitly selected legacy/partial plan with a different saved result.
    const value = window.__ppTabPlan || window.__ppOptimizerCommittedPlan || p?.lastPlan || window.__ppGenericPlan;
    if (p && value?._revision != null && Number(value._revision) !== Number(p.revision)) return null;
    return adapt(value);
  };
  const installCurrent = () => {
    if (scope(project()) !== visibleScope && ownedCache && window.__ppGenericPlan === ownedCache) {
      window.__ppGenericPlan = null; ownedCache = null;
    }
    const value = current();
    if (value) { window.__ppGenericPlan = value; ownedCache = value; }
    return value;
  };
  const refresh = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      if (!installCurrent()) return;
      const tabs = [...document.querySelectorAll('.tabs>div')];
      // Existing private generic renderLoad owns the calculation and markup.
      // Replay only the already selected utilization tab; never navigate or
      // request a new plan, and never synthesize utilization from batch spans.
      const active = tabs.findIndex(tab => tab.classList.contains('a'));
      if (active !== 4 || replaying) return;
      replaying = true;
      try { tabs[active].dispatchEvent(new Event('click', {bubbles: true, cancelable: true})); }
      finally { replaying = false; }
    }, 0);
  };
  const originalRender = window.renderPlan;
  window.renderPlan = function ppNativeResourceRender(plan, ...rest) {
    const p = project(), prior = ownedCache;
    const value = adapt(plan);
    selected = value;
    selectedScope = scope(p);
    visibleScope = selectedScope;
    selectedDuringFresh = fresh(p);
    selectionObserved = true;
    const result = originalRender.call(this, value || plan, ...rest);
    observedTab = window.__ppTabPlan;
    if (value) {
      // Unified employee/order Gantt temporarily renders projected rows. Keep
      // the secondary cache tied to the real selected schedule afterwards.
      window.__ppGenericPlan = value;
      ownedCache = value;
      refresh();
    } else if (prior && window.__ppGenericPlan === prior) {
      window.__ppGenericPlan = plan || null;
      ownedCache = null;
    }
    return result;
  };
  const originalClear = window.clearPlan;
  if (typeof originalClear === 'function') window.clearPlan = function ppNativeResourceClear(...args) {
    const prior = ownedCache;
    selected = null; selectedScope = scope(project()); visibleScope = selectedScope; selectionObserved = true;
    selectedDuringFresh = false; ownedCache = null;
    if (prior && window.__ppGenericPlan === prior) window.__ppGenericPlan = null;
    const result = originalClear.apply(this, args);
    observedTab = window.__ppTabPlan;
    return result;
  };
  document.addEventListener('click', event => {
    if (replaying) return;
    const tab = event.target?.closest?.('.tabs>div');
    if (tab && [...document.querySelectorAll('.tabs>div')].includes(tab)) installCurrent();
  }, true);
  window.addEventListener('DOMContentLoaded', refresh);
  window.addEventListener('storage', refresh);
  window.addEventListener('popstate', refresh);
  window.__PP_NATIVE_RESOURCE_PRESENTATION_V1__ = {installed: true, adapt, sync: refresh};
  refresh();
}

export const RESOURCE_PRESENTATION_MARKER = 'PP_NATIVE_RESOURCE_PRESENTATION_20261125';
export function resourcePresentationScript() {
  return '\n;/* ' + RESOURCE_PRESENTATION_MARKER + ' */\n' +
    ppNativeResourcePresentation.toString() + '\n' +
    ppInstallNativeResourcePresentation.toString() + '\nppInstallNativeResourcePresentation();\n';
}

export function patchResourcePresentationUi(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > 4 * 1024 * 1024)
    throw Error('RESOURCE_PRESENTATION_SOURCE_BOUND');
  for (const anchor of ['function ppNativePresentationPlan(', 'function ppInstallNativePresentation(',
    'function ppUnifiedGanttV2()', 'window.__PP_INTEGRATED_NATIVE_RESULT_V1__ = {'])
    if (source.split(anchor).length !== 2) throw Error('RESOURCE_PRESENTATION_REQUIRED_SOURCE_GUARD');
  const addon = resourcePresentationScript();
  if (source.includes(RESOURCE_PRESENTATION_MARKER)) {
    if (source.split(RESOURCE_PRESENTATION_MARKER).length !== 2 || !source.endsWith(addon))
      throw Error('RESOURCE_PRESENTATION_INSTALLED_SOURCE_DRIFT');
    new vm.Script(source);
    return source;
  }
  for (const name of ['ppNativeResourcePresentation', 'ppInstallNativeResourcePresentation', '__PP_NATIVE_RESOURCE_PRESENTATION_V1__'])
    if (source.includes(name)) throw Error('RESOURCE_PRESENTATION_PARTIAL_INSTALL');
  const result = source + addon;
  if (result.slice(0, -addon.length) !== source) throw Error('RESOURCE_PRESENTATION_REVERSE_GUARD');
  new vm.Script(result);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw Error('RESOURCE_PRESENTATION_CLI_ARGUMENTS');
  const before = readFileSync(process.argv[2], 'utf8');
  const after = patchResourcePresentationUi(before);
  writeFileSync(process.argv[3], after);
  console.log('RESOURCE_PRESENTATION_UI_PATCH_PASS ' + JSON.stringify({changed: before !== after}));
}
