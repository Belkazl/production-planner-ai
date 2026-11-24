// Runs inside the native project manager closure, using its existing persistence.
export function openProjectTextImport() {
  const originalId = active();
  const isEmpty = p => !!p && p.model == null && !p.lastPlan &&
    !(p.savedPlans || []).length && !(p.history || []).length;
  const original = find(originalId);
  const fillable = isEmpty(original);
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
    (fillable ? '<button class="pm-btn primary" data-fill></button>' : '') + '</div>';
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
