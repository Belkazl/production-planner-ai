export function ppResourceUnitsInlineHtml(html) {
  const marker = 'PP_RESOURCE_UNITS_INLINE_20261124';
  const fail = () => {
    console.warn('PP_RESOURCE_UNITS_INLINE_SOURCE_DRIFT');
    return html;
  };
  if (typeof html !== 'string') return fail();
  const scripts = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi));
  const matches = scripts.filter(script => {
    const id = script[1].match(/\bid\s*=\s*(["'])(.*?)\1/i);
    return id?.[2] === 'ppTechProcessJs';
  });
  if (matches.length !== 1) return fail();
  const match = matches[0], source = match[2];
  const count = (text, token) => text.split(token).length - 1;
  const required = [
    'function rr(r){',
    'function op(o){',
    'function refresh(row){',
    'function ppCanonicalRequirementUnit(req,sourceModel){',
    "u.value=ppCanonicalRequirementUnit({resource_type:t,resource_ref:ref.value,match_mode:m});u.readOnly=true",
    "if(u)u.value=ppCanonicalRequirementUnit({resource_type:t,resource_ref:x.value})",
    "unit:ppCanonicalRequirementUnit({resource_type:t,resource_ref:r.querySelector('[data-rf=resource_ref]').value},model)",
  ];
  if (required.some(anchor => count(source, anchor) !== 1)) return fail();
  const changes = [
    {
      before: `<td><input class="pp-edit-input" data-rf="quantity" value="'+esc(r.quantity??1)+'"></td><td><input class="pp-edit-input" data-rf="unit" value="'+esc(ppCanonicalRequirementUnit(r))+'" readonly aria-readonly="true" title="Единица задана типом ресурса или справочником материалов"></td>`,
      // Output.value updates its text, so native resource-change handlers stay intact.
      after: `<td><div class="pp-quantity-with-unit" style="display:flex;align-items:center;gap:6px"><input class="pp-edit-input" data-rf="quantity" value="'+esc(r.quantity??1)+'"><output class="pp-requirement-unit" data-rf="unit" aria-readonly="true" title="Единица задана типом ресурса или справочником материалов" style="white-space:nowrap">'+esc(ppCanonicalRequirementUnit(r))+'</output></div></td>`,
    },
    {
      before: '<table class="pp-rr-table"><thead><tr><th>Тип</th><th>Выбор</th><th>Ресурс / группа</th><th>Количество</th><th>Ед.</th><th>Расход</th><th></th></tr></thead>',
      after: '<table class="pp-rr-table"><thead><tr><th>Тип</th><th>Выбор</th><th>Ресурс / группа</th><th>Количество</th><th>Расход</th><th></th></tr></thead>',
    },
  ];
  if (count(source, marker) === 1 && changes.every(change =>
      count(source, change.before) === 0 && count(source, change.after) === 1)) return html;
  if (count(source, marker) !== 0 || changes.some(change =>
      count(source, change.before) !== 1 || count(source, change.after) !== 0)) return fail();
  let updated = source;
  for (const change of changes) updated = updated.replace(change.before, change.after);
  updated = '// ' + marker + '\n' + updated;
  const offset = match.index + match[0].indexOf('>') + 1;
  return html.slice(0, offset) + updated + html.slice(offset + source.length);
}
