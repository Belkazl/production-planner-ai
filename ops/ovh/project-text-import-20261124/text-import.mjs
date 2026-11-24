// Runs inside the native project manager closure, using its existing persistence.
export function openProjectTextImport() {
  const originalId = active();
  const isEmpty = p => !!p && p.model == null && !p.lastPlan &&
    !(p.savedPlans || []).length && !(p.history || []).length;
  const original = find(originalId);
  const fillable = isEmpty(original);
  const canonical = value => Array.isArray(value) ? value.map(canonical) :
    (value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).filter(k => k !== '__ppid').sort().map(k => [k, canonical(value[k])])) : value);
  const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  const fingerprint = p => JSON.stringify(canonical(p && {model:p.model, revision:p.revision, lastPlan:p.lastPlan}));
  const originalFingerprint = fingerprint(original);
  const canLoadPlan = !!(original && original.model && original.lastPlan);
  const unchanged = current => !!current && active() === originalId && fingerprint(current) === originalFingerprint;
  // Match the native Saved Plans snapshot and FNV signature, including UI metadata.
  const snapshot = m => {
    const clean = x => {const y = clone(x); if (y && typeof y === 'object') for (const k of ['_assistant_reply','_ai_error','_meta','createdAt','updatedAt']) delete y[k]; return y;};
    return {start:m.start||null,quantity_unit:m.quantity_unit||null,orders:(m.orders||[]).map(clean),technical_processes:(m.technical_processes||[]).map(clean),equipment:(m.equipment||m.autoclaves||[]).map(clean),employees:(m.employees||[]).map(clean),shifts:clean(m.shifts||{}),materials:(m.materials||[]).map(clean),material:clean(m.material||null),setup_rules:(m.setup_rules||[]).map(clean)};
  };
  const signature = value => {
    const stable = v => Array.isArray(v) ? '['+v.map(stable).join(',')+']' : v && typeof v === 'object' ? '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}' : JSON.stringify(v);
    const text = stable(value); let h = 2166136261;
    for (let i=0;i<text.length;i++) {h ^= text.charCodeAt(i); h = Math.imul(h,16777619);}
    return ('00000000'+(h>>>0).toString(16)).slice(-8);
  };
  const validatePlan = (plan, current) => {
    const fail = message => {throw new Error(message);};
    if (!plan || plan.valid !== true || plan.ok === false || plan.partial === true ||
        ['validation_errors','errors','conflicts','violations'].some(k => plan[k] && (!Array.isArray(plan[k]) || plan[k].length))) fail('Import a complete valid plan.');
    const m = current.model, previous = current.lastPlan;
    if (!previous || previous.valid !== true || previous.partial === true) fail('The selected project needs a complete valid plan first.');
    if ((m.setup_rules||[]).length || (m.materials||[]).length || m.material || Object.keys(m.shifts||{}).length) fail('Loading a timing-only plan currently requires no setup, material or shift constraints.');
    const operations = p => Array.isArray(p.generic_operations) ? p.generic_operations : p.operations;
    const ops = operations(plan), oldOps = operations(previous);
    if (!Array.isArray(ops) || !ops.length || !Array.isArray(oldOps) || ops.length !== oldOps.length || plan.operation_count !== ops.length) fail('The plan must contain every operation.');
    if (plan.operations && plan.generic_operations && !equal(plan.operations,plan.generic_operations)) fail('The operation lists disagree.');
    const key = op => JSON.stringify([op.order,op.batch_id||op.batch||1,op.operation_id,op.sequence]);
    const timeKeys = new Set(['start_min','end_min','start','end','finish','process_start_min','process_end_min','_auto_start_min','_auto_end_min','manual_locked','manual_updated_at']);
    const immutable = op => Object.fromEntries(Object.entries(op).filter(([k])=>!timeKeys.has(k)));
    const old = new Map(oldOps.map(op=>[key(op),op])), seen = new Set(), chains = new Map(), resources = new Map();
    if (old.size !== oldOps.length) fail('The current plan has duplicate operations.');
    const finite = n => typeof n === 'number' && Number.isFinite(n);
    const closeNumber = (a,b) => Math.abs(a-b)<1e-7;
    const origin = Date.parse(m.start);
    if (!Number.isFinite(origin) || plan.start !== m.start) fail('The plan start does not match the model.');
    const equipment = new Set((m.equipment||m.autoclaves||[]).map(x=>x.id)), employees = new Set((m.employees||[]).map(x=>x.id));
    let finish = 0;
    for (const op of ops) {
      const id = key(op), before = old.get(id);
      if (!before || seen.has(id) || !equal(immutable(op),immutable(before))) fail('Only operation times may change; all operations, quantities and resource assignments must match.');
      seen.add(id);
      if (![op.start_min,op.end_min,op.duration_min,op.sequence].every(finite) || op.start_min < 0 || op.duration_min <= 0 || !closeNumber(op.end_min-op.start_min,op.duration_min)) fail('Operation times must be finite, nonnegative and consistent.');
      if (op.start && !closeNumber(Date.parse(op.start),origin+op.start_min*60000) || op.end && !closeNumber(Date.parse(op.end),origin+op.end_min*60000)) fail('Operation timestamps disagree with their minute offsets.');
      finish = Math.max(finish,op.end_min);
      const chainId = JSON.stringify([op.order,op.batch_id||op.batch||1]);
      if (!chains.has(chainId)) chains.set(chainId,[]); chains.get(chainId).push(op);
      for (const [field,known] of [['equipment_ids',equipment],['employee_ids',employees]]) {
        const ids = op[field] || []; if (!Array.isArray(ids) || new Set(ids).size !== ids.length) fail('Invalid operation resources.');
        for (const id of ids) {if (!known.has(id)) fail('The plan references an unknown resource.'); const resource = field+':'+id; if (!resources.has(resource)) resources.set(resource,[]); resources.get(resource).push(op);}
      }
    }
    for (const chain of chains.values()) {
      chain.sort((a,b)=>a.sequence-b.sequence);
      for (let i=1;i<chain.length;i++) if (chain[i].sequence <= chain[i-1].sequence || chain[i].start_min < chain[i-1].end_min-1e-7) fail('Operation precedence is violated.');
      const order = (m.orders||[]).find(o=>o.id===chain[0].order);
      const process = order && (m.technical_processes||[]).find(p=>p.id===order.technical_process_id);
      if (!process || !Array.isArray(process.operations) || !equal(chain.map(o=>o.operation_id).sort(),process.operations.map(o=>o.id).sort())) fail('The plan is missing model operations.');
    }
    if ((m.orders||[]).some(order=>!ops.some(op=>op.order===order.id))) fail('The plan is missing an order.');
    for (const list of resources.values()) {list.sort((a,b)=>a.start_min-b.start_min); for (let i=1;i<list.length;i++) if (list[i].start_min < list[i-1].end_min-1e-7) fail('Resource operations overlap.');}
    if (!finite(plan.duration_minutes) || !closeNumber(plan.duration_minutes,finish) || !closeNumber(Date.parse(plan.finish),origin+finish*60000)) fail('Plan duration and finish do not match its operations.');
    if (!Array.isArray(plan.batches) || !Array.isArray(previous.batches) || plan.batch_count !== plan.batches.length || plan.batches.length !== chains.size) fail('The plan must contain every batch.');
    const batchKeys = new Set(), oldBatches = new Map(previous.batches.map(b=>[JSON.stringify([b.order,b.batch_id||b.batch||1]),b]));
    for (const batch of plan.batches) {
      const id = JSON.stringify([batch.order,batch.batch_id||batch.batch||1]), chain = chains.get(id);
      if (!chain || !oldBatches.has(id) || !equal(immutable(batch),immutable(oldBatches.get(id))) || batchKeys.has(id) || !finite(batch.start_min) || !finite(batch.end_min) || !closeNumber(batch.start_min,Math.min(...chain.map(o=>o.start_min))) || !closeNumber(batch.end_min,Math.max(...chain.map(o=>o.end_min)))) fail('Batch metadata and times must match their operations.');
      batchKeys.add(id);
    }
  };
  const back = document.createElement('div');
  back.className = 'pm-modal-backdrop';
  const box = document.createElement('div');
  box.className = 'pm-modal';
  box.style.width = 'min(680px,calc(100vw - 32px))';
  box.innerHTML = '<h3>Import project</h3>' +
    '<p>Paste the JSON from an exported project, or choose a JSON file.</p>' +
    '<label for="pmJsonText">Project JSON</label>' +
    '<textarea id="pmJsonText" placeholder="Paste project JSON here" spellcheck="false" ' +
    'style="box-sizing:border-box;width:100%;min-height:220px;padding:12px;border:1px solid #d6dce5;border-radius:8px;font:12px monospace;resize:vertical"></textarea>' +
    '<p id="pmJsonError" role="alert" style="color:#b42318;white-space:pre-wrap"></p>' +
    '<div class="pm-modal-actions" style="flex-wrap:wrap">' +
    '<button class="pm-btn" data-cancel>Cancel</button>' +
    '<button class="pm-btn" data-file>Choose file</button>' +
    '<button class="pm-btn" data-new>Import as new project</button>' +
    (fillable ? '<button class="pm-btn primary" data-fill></button>' : '') +
    (canLoadPlan ? '<button class="pm-btn primary" data-plan>Load plan into selected project</button>' : '') + '</div>';
  back.appendChild(box);
  document.body.appendChild(back);
  const input = box.querySelector('#pmJsonText');
  const error = box.querySelector('#pmJsonError');
  let cancelled = false;
  const close = () => { cancelled = true; back.remove(); };
  const parse = () => {
    if (input.value.length > 10 * 1024 * 1024) throw new Error('Project JSON is too large.');
    let data;
    try { data = JSON.parse(input.value); } catch { throw new Error('Paste valid project JSON.'); }
    const projects = data?.project ? [data.project] : data?.projects;
    if (!Array.isArray(projects) || !projects.length) throw new Error('The JSON contains no projects.');
    for (const p of projects) {
      if (!p || typeof p !== 'object' || !p.model || typeof p.model !== 'object' ||
          Array.isArray(p.model) || !Array.isArray(p.model.orders)) {
        throw new Error('Each imported project must contain a model with an orders array.');
      }
    }
    return projects;
  };
  box.querySelector('[data-cancel]').onclick = close;
  back.addEventListener('click', e => { if (e.target === back) close(); });
  input.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  box.querySelector('[data-file]').onclick = () => { close(); q('pmFile').click(); };
  box.querySelector('[data-new]').onclick = () => {
    try {
      parse();
      importFile(new Blob([input.value], {type:'application/json'}));
      close();
    } catch (e) { error.textContent = String(e.message || e); }
  };
  const fill = box.querySelector('[data-fill]');
  if (fill) {
    fill.textContent = 'Fill “' + original.name + '”';
    fill.onclick = async () => {
      fill.disabled = true;
      error.textContent = '';
      try {
        const incoming = parse();
        if (incoming.length !== 1) throw new Error('Paste one project to fill the selected empty project.');
        if (active() !== originalId || !isEmpty(find(originalId))) {
          throw new Error('The selected project changed or is no longer empty. Reopen Import.');
        }
        // Validate through the normal authenticated model interface first.
        const loaded = await apiModel(incoming[0].model);
        if (cancelled) return;
        if (!loaded.model || !Array.isArray(loaded.model.orders)) throw new Error('The server did not return a valid model.');
        if (active() !== originalId || !isEmpty(find(originalId))) {
          throw new Error('The selected project changed. No project was overwritten.');
        }
        const saved = mutate(originalId, current => {
          if (!isEmpty(current)) throw new Error('The selected project is no longer empty.');
          current.model = clone(loaded.model);
          current.revision = Number(current.revision || 0) + 1;
        });
        if (!saved) throw new Error('The selected project no longer exists.');
        close();
        showProjects();
        await openProject(originalId);
      } catch (e) { error.textContent = String(e.message || e); fill.disabled = false; }
    };
  }
  const planButton = box.querySelector('[data-plan]');
  if (planButton) planButton.onclick = async () => {
    planButton.disabled = true; error.textContent = '';
    try {
      const incoming = parse(), data = JSON.parse(input.value), current = find(originalId);
      if (incoming.length !== 1 || !unchanged(current)) throw new Error('The selected project or current plan changed. Reopen Import.');
      if (!equal(incoming[0].model,current.model)) throw new Error('The imported plan model must match the selected project.');
      const plan = clone(incoming[0].lastPlan);
      validatePlan(plan,current);
      const loaded = await apiModel(current.model);
      if (cancelled) return;
      if (!loaded.model || !equal(loaded.model,current.model) || loaded.model_ready !== true) throw new Error('The server did not confirm the same ready model.');
      if (!unchanged(find(originalId))) throw new Error('The selected project or current plan changed. No plan was overwritten.');
      const name = String(data.plan_name || plan.reference_schedule?.name || 'Импортированный план').trim().slice(0,140) || 'Импортированный план';
      const saved = mutate(originalId,p => {
        if (!unchanged(p)) throw new Error('The selected project or current plan changed.');
        if (p.savedPlans != null && !Array.isArray(p.savedPlans)) throw new Error('The saved plan list is invalid.');
        const existing = p.savedPlans || [], now = new Date().toISOString(), modelSnapshot = snapshot(p.model);
        const record = (value,label) => ({id:'SP_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7),name:label,saved_at:now,model_signature:signature(modelSnapshot),model_snapshot:clone(modelSnapshot),plan:clone(value),duration_minutes:Number(value.duration_minutes||0),batch_count:Number(value.batch_count||0),setup_minutes:Number(value.setup_minutes||0),optimization_run:Number(value.optimization_run||0),total_generations:Number(value.total_generations||0)});
        const previous = existing.some(s=>equal(s.plan,p.lastPlan)) ? [] : [record(p.lastPlan,'План до импорта — '+p.lastPlan.duration_minutes+' мин')];
        plan._revision = p.revision; plan._savedAt = now;
        p.savedPlans = [record(plan,name),...previous,...existing];
        p.lastPlan = clone(plan);
      });
      if (!saved) throw new Error('The selected project no longer exists.');
      close(); showProjects(); await openProject(originalId);
    } catch (e) {error.textContent = String(e.message||e); planButton.disabled = false;}
  };
  input.focus();
}

export const IMPORT_ANCHOR = "q('pmImport').onclick=()=>q('pmFile').click();";
export const API_ANCHOR = "const d=await r.json();if(!d.ok)throw new Error(d.error||'Не удалось переключить модель');return d";
export const API_REPLACEMENT = "const d=await r.json();if(!d.ok)throw new Error(d.error||'Не удалось переключить модель');" +
  "if(m&&typeof d.model_ready!=='boolean'){const check=await fetch('/api/model',{cache:'no-store'});const current=await check.json();" +
  "if(!check.ok||!current.ok||typeof current.model_ready!=='boolean')throw new Error(current.error||'Model readiness check failed');" +
  "const canonical=v=>Array.isArray(v)?v.map(canonical):(v&&typeof v==='object'?Object.fromEntries(Object.keys(v).filter(k=>k!=='__ppid').sort().map(k=>[k,canonical(v[k])])):v);" +
  "if(JSON.stringify(canonical(d.model))!==JSON.stringify(canonical(current.model)))throw new Error('The active model changed during import. Retry the import.');" +
  "d.model_ready=current.model_ready;}return d";
export const STATS_ANCHOR = 'a:(m.autoclaves||[]).length';
export const STATS_REPLACEMENT = 'a:(Array.isArray(m.equipment)&&m.equipment.length?m.equipment:(m.autoclaves||[])).length';
export const READY_ANCHOR = "function modelLooksReady(m){return !!(m&&Array.isArray(m.autoclaves)&&m.autoclaves.length&&Array.isArray(m.orders)&&m.orders.length&&m.start)}";
export const READY_REPLACEMENT = "function modelLooksReady(m){const equipment=m&&(Array.isArray(m.equipment)&&m.equipment.length?m.equipment:m.autoclaves);return !!(m&&Array.isArray(equipment)&&equipment.length&&Array.isArray(m.orders)&&m.orders.length&&m.start)}";

export function transformSource() {
  const replacements = [
    [IMPORT_ANCHOR, '/* PP_PROJECT_TEXT_IMPORT_V1 */\nq(\'pmImport\').onclick=' + openProjectTextImport.toString() + ';'],
    [API_ANCHOR, API_REPLACEMENT],
    [STATS_ANCHOR, STATS_REPLACEMENT],
    [READY_ANCHOR, READY_REPLACEMENT]
  ];
  return 'function ppProjectTextImportHtml(html){\n' +
    'const pairs=' + JSON.stringify(replacements) + ';\n' +
    'if(!html.includes(pairs[0][0]))return html;\n' +
    'if(pairs.some(([before])=>html.split(before).length!==2))return html;\n' +
    'for(const [before,after] of pairs)html=html.replace(before,after);\nreturn html;\n}\n';
}
