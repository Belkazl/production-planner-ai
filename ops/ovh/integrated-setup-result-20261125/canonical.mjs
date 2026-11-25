/** A presentation checksum, never an authorization or worker-validation proof. */
export function ppNativeScheduleFingerprint(plan) {
  try {
    const stable = value => {
      if (value === null || typeof value !== 'object') return value;
      if (Array.isArray(value)) return value.map(stable);
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
    };
    const text = JSON.stringify(stable({
      operations: plan.operations, generic_operations: plan.generic_operations, setup_operations: plan.setup_operations,
      duration_minutes: plan.duration_minutes, batch_count: plan.batch_count,
      operator_wait_minutes: plan.operator_wait_minutes, machine_idle_minutes: plan.machine_idle_minutes,
      order_sequence: plan.order_sequence || [], start: plan.start || null,
      setup_operation_count: plan.setup_operation_count, setup_duration_total_minutes: plan.setup_duration_total_minutes
    }));
    if (text.length > 32 * 1024 * 1024) return null;
    let a = 2166136261, b = 2246822519;
    for (let i = 0; i < text.length; i++) {
      const n = text.charCodeAt(i);
      a = Math.imul(a ^ n, 16777619);
      b = Math.imul(b ^ n, 3266489917);
    }
    return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
  } catch { return null; }
}

/**
 * Called only by the authenticated Python-worker adapter, never for a POST
 * resume_plan. The worker remains responsible for all scheduling constraints.
 * This function joins representations of its SAME schedule; it never retimes,
 * schedules, repairs, chooses resources, or turns an invalid plan into valid.
 */
export function ppCanonicalNativeResult(plan, model, modelKey) {
  try {
    if (!plan || typeof plan !== 'object' || Array.isArray(plan) || plan.valid !== true ||
        plan.ok === false || plan.partial === true || !model || !Array.isArray(model.orders) ||
        typeof modelKey !== 'string' || !modelKey || modelKey.length > 65536) return null;
    if (plan.optimization_termination_reason === 'reconciled_setup_aware_final' ||
        plan.setup_enrichment_stage === 'scheduler_reservation') return null;
    const same = (a, b) => Number.isFinite(a) && Number.isFinite(b) &&
      Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b));
    const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
    for (const key of ['duration_minutes', 'batch_count', 'operator_wait_minutes', 'machine_idle_minutes'])
      if (!numeric(plan[key])) return null;
    for (const key of ['validation_errors', 'errors', 'violations', 'conflicts'])
      if (plan[key] != null && (!Array.isArray(plan[key]) || plan[key].length)) return null;
    const resume = plan.resume_state;
    if (resume?.best_duration_minutes != null && !same(Number(resume.best_duration_minutes), plan.duration_minutes)) return null;
    if (plan.diagnostic_final?.duration_minutes != null &&
        !same(Number(plan.diagnostic_final.duration_minutes), plan.duration_minutes)) return null;
    if (Array.isArray(plan.history_best) && plan.history_best.length &&
        !same(Number(plan.history_best.at(-1)), plan.duration_minutes)) return null;
    const isSetup = row => row?.is_setup === true ||
      String(row?.phase || '').toLowerCase() === 'setup' || String(row?.type || '').toLowerCase() === 'setup';
    const original = Array.isArray(plan.operations) ? plan.operations : [];
    const generic = Array.isArray(plan.generic_operations) ? plan.generic_operations : [];
    const primary = original.length ? original : generic;
    if (!primary.length || primary.length > 100000 || generic.length > 100000) return null;
    const detached = plan.setup_operations;
    if (detached != null && !Array.isArray(detached)) return null;
    if (Array.isArray(detached) && detached.length > 100000) return null;
    const embedded = [...primary, ...generic].filter(isSetup);
    // An explicitly empty array is a complete zero-setup answer. An older
    // worker may instead supply its setup rows inline or an explicit zero.
    // Missing setup evidence on a model with setup rules fails closed.
    if (!Array.isArray(detached) && !embedded.length &&
        plan.setup_count !== 0 && plan.setup_operation_count !== 0 && (model.setup_rules || []).length) return null;
    if (Array.isArray(detached) && !detached.length && embedded.length) return null;
    const stable = value => {
      if (value === null || typeof value !== 'object') return value;
      if (Array.isArray(value)) return value.map(stable);
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
    };
    const encode = value => JSON.stringify(stable(value));
    const normalized = (row, forcedSetup = false) => {
      if (!row || typeof row !== 'object' || Array.isArray(row) ||
          !numeric(row.start_min) || !numeric(row.end_min) || row.end_min < row.start_min ||
          row.end_min > plan.duration_minutes + 1e-7 * Math.max(1, plan.duration_minutes)) throw Error('interval');
      if (forcedSetup && row.is_setup === false) throw Error('setup_kind');
      const out = {...row,
        equipment_ids: Array.isArray(row.equipment_ids) ? row.equipment_ids : row.equipment_id != null ? [row.equipment_id] : [],
        employee_ids: Array.isArray(row.employee_ids) ? row.employee_ids : row.employee_id != null ? [row.employee_id] : [],
        resources: Array.isArray(row.resources) ? row.resources : [],
        material_ids: Array.isArray(row.material_ids) ? row.material_ids : []};
      if (forcedSetup) { out.is_setup = true; if (out.phase == null) out.phase = 'setup'; }
      if (isSetup(out) && (!(out.end_min > out.start_min) || !out.equipment_ids.length)) throw Error('setup_interval');
      if (out.duration_min != null && !same(Number(out.duration_min), out.end_min - out.start_min)) throw Error('duration');
      return out;
    };
    const identity = row => encode([isSetup(row), row.operation_id ?? row.id ?? null,
      row.order ?? row.order_id ?? null, row.batch_id ?? row.batch ?? null, row.sequence ?? null,
      [...row.equipment_ids].map(String).sort(), isSetup(row) || (row.operation_id == null && row.id == null) ? [row.start_min, row.end_min] : null]);
    const rows = new Map(), production = new Set();
    const add = (raw, forcedSetup = false, fromPrimary = false) => {
      const row = normalized(raw, forcedSetup), key = identity(row), prior = rows.get(key);
      if (prior) {
        // Duplicate representations must agree; never silently select one of
        // two different schedules or lose an existing row field.
        for (const name of Object.keys(row)) {
          if (Object.hasOwn(prior, name) && encode(prior[name]) !== encode(row[name])) throw Error('conflicting_row');
          if (!Object.hasOwn(prior, name)) prior[name] = row[name];
        }
      } else rows.set(key, row);
      if (fromPrimary && !isSetup(row)) production.add(key);
      return key;
    };
    const uniqueWithin = (list, forcedSetup = false) => {
      const seen = new Set();
      for (const row of list) {
        const key = identity(normalized(row, forcedSetup));
        if (seen.has(key)) throw Error('duplicate_row');
        seen.add(key);
      }
    };
    uniqueWithin(primary);
    uniqueWithin(generic);
    uniqueWithin(detached || [], true);
    for (const row of primary) add(row, false, true);
    if (!production.size) return null;
    const primaryProduction = production.size;
    for (const row of generic) {
      const normalizedRow = normalized(row);
      if (!isSetup(normalizedRow) && !production.has(identity(normalizedRow))) return null;
      add(row);
    }
    for (const row of detached || []) add(row, true);
    if (rows.size > 100000) return null;
    const combined = [...rows.values()].sort((a, b) => a.start_min - b.start_min ||
      Number(isSetup(b)) - Number(isSetup(a)) || a.end_min - b.end_min);
    const setups = combined.filter(isSetup);
    if (Array.isArray(detached)) {
      const declared = new Set(detached.map(row => identity(normalized(row, true))));
      if (declared.size !== setups.length || setups.some(row => !declared.has(identity(row)))) return null;
    }
    const setupMinutes = setups.reduce((sum, row) => sum + row.end_min - row.start_min, 0);
    for (const key of ['setup_count', 'setup_operation_count'])
      if (plan[key] != null && (!Number.isInteger(plan[key]) || plan[key] !== setups.length)) return null;
    for (const key of ['setup_minutes', 'setup_duration_total_minutes'])
      if (plan[key] != null && !same(Number(plan[key]), setupMinutes)) return null;
    const result = {...plan, operations: combined, generic_operations: combined,
      setup_operations: setups, operation_count: combined.length,
      setup_operation_count: setups.length, setup_duration_total_minutes: setupMinutes};
    const context = {model_key: modelKey, pin_key: typeof resume?.pin_hash === 'string' ? resume.pin_hash : null,
      objective: String(resume?.objective || plan.objective || model.objective || 'duration')};
    const signature = ppNativeScheduleFingerprint(result);
    if (!signature) return null;
    result._pp_native_schedule_v1 = {version: 'integrated-native-setup-v1-20261125',
      context, signature, production_count: primaryProduction, setup_count: setups.length};
    return result;
  } catch { return null; }
}

/** These functions govern browser presentation only, never backend trust. */
export function ppNativePresentationPlan(plan) {
  const stamp = plan?._pp_native_schedule_v1;
  return !!(plan?.valid === true && plan.ok !== false && plan.partial !== true &&
    stamp?.version === 'integrated-native-setup-v1-20261125' &&
    typeof stamp.context?.model_key === 'string' && stamp.context.model_key &&
    Array.isArray(plan.operations) && plan.operations.length &&
    stamp.signature === ppNativeScheduleFingerprint(plan));
}

export function ppNativePresentationSupersedes(plan, previous) {
  return ppNativePresentationPlan(plan) && (!ppNativePresentationPlan(previous) ||
    JSON.stringify(plan._pp_native_schedule_v1.context) !== JSON.stringify(previous._pp_native_schedule_v1.context));
}

export function ppInstallNativePresentation() {
  if (window.__PP_INTEGRATED_NATIVE_RESULT_V1__) return;
  const current = () => {
    try {
      const id = localStorage.getItem('prodplan.project.active.v2');
      return JSON.parse(localStorage.getItem('prodplan.projects.v2') || '[]').find(row => String(row?.id) === String(id)) || null;
    } catch { return null; }
  };
  const choices = () => {
    const project = current();
    if (!project) return [];
    return [project.lastPlan, window.__ppOptimizerCommittedPlan,
      window.__ppFreshRestartProject === project.id ? window.__ppFreshDisplayBaseline : null]
      .filter(plan => plan && (plan._revision == null || Number(plan._revision) === Number(project.revision)));
  };
  const matching = plan => choices().filter(prior => ppNativePresentationPlan(prior) &&
    JSON.stringify(prior._pp_native_schedule_v1.context) === JSON.stringify(plan._pp_native_schedule_v1.context));
  const resetComparison = plan => {
    try {
      const project = current();
      if (!project) return;
      const key = 'pp.kpi.first-best.v1.' + String(project.id).slice(0, 170);
      const previous = JSON.parse(localStorage.getItem(key) || 'null');
      const metrics = {duration: plan.duration_minutes, cycles: plan.batch_count,
        wait: plan.operator_wait_minutes, idle: plan.machine_idle_minutes};
      const record = {projectId: String(project.id), revision: Number(project.revision || 0), metrics,
        compare: false, selectedSource: 'native_constraints_revalidated',
        ...(previous?.metrics ? {obsolete_metrics: previous.metrics, obsolete_comparison: true} : {})};
      localStorage.setItem(key, JSON.stringify(record));
      window.__ppKpiBaselinePlan = null;
      try { if (typeof previousKpiMetrics !== 'undefined') previousKpiMetrics = null; } catch {}
      window.__PP_KPI_FIRST_BEST_V1__?.sync?.();
    } catch {}
  };
  window.__PP_INTEGRATED_NATIVE_RESULT_V1__ = {
    isPlan: ppNativePresentationPlan,
    supersedes: ppNativePresentationSupersedes,
    acceptResponse(plan) {
      if (!ppNativePresentationPlan(plan) || matching(plan).length) return false;
      resetComparison(plan);
      return true;
    },
    matchingFloor(plan, key, prefersNew) {
      if (!ppNativePresentationPlan(plan)) return null;
      return matching(plan).reduce((best, next) => !best || prefersNew(next, best, key) ? next : best, null);
    }
  };
}
