import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export function patchPreview(html) {
  if (typeof html !== 'string' || !html.includes('id="ppEquipmentSdkToolbarJs"') || html.includes('/* PP_EMPLOYEES_SDK_V1 */')) return html;
  // Both existing enhancers should resolve the same editor even when its table is empty.
  const table = 'table:has(.pp-perf-value-cell)';
  const employee = 'table.pp-edit-table:has([data-f=shift]):has([data-f=role])';
  const selectTable = (section) => 'querySelector(' + section + '.querySelector(".titlebar h1")?.textContent.trim().match(/^(Employees|Staff|Сотрудники)$/i) ? "table.pp-edit-table" : "' + table + ', ' + employee + '")';
  function editBlock(page, tag, id, edit) {
    const start = '<'+tag+' id="'+id+'">';
    const index = page.indexOf(start);
    if (index < 0) throw Error('Missing SDK block '+id);
    const end = page.indexOf('</'+tag+'>',index);
    const block = page.slice(index,end);
    const result = edit(block);
    if(result === block) throw Error('Unexpected SDK source '+id);
    return page.slice(0,index)+result+page.slice(end);
  }
  let out=editBlock(html,'script','ppEquipmentSDKScript',s=>s.replace('querySelector("'+table+'")',()=>selectTable('section')).replace('||"Equipment type"', '||s.closest("table")?.tHead?.rows[0]?.cells[s.closest("td")?.cellIndex]?.textContent.trim()||"Options"'));
  out=editBlock(out,'script','ppEquipmentSdkToolbarJs',s=>s.replace('querySelector("'+table+'")',()=>selectTable('section')));
  return editBlock(out,'style','ppEquipmentSDKStyle',s=>s.replaceAll('#sectionView:has(.pp-perf-value-cell)', '#sectionView:has(.pp-sdk-equipment-table)')+'\n/* PP_EMPLOYEES_SDK_V1 */\n');
}

export function patchSource(source) {
  const anchor='const assistantHtml=ppEquipmentSdkToolbarPage(';
  assert.equal(source.split(anchor).length,2);
  const lines=source.split('\n');
  const i=lines.findIndex(line=>line.includes(anchor));
  assert(lines[i].trimEnd().endsWith(';'));
  lines[i]=lines[i].replace(anchor,'const assistantHtml=ppEmployeesSdkPage(ppEquipmentSdkToolbarPage(').replace(/;\s*$/,');');
  return lines.join('\n')+'\nfunction ppEmployeesSdkPage(html){return ('+patchPreview.toString()+')(html)}'+'\n';
}
if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) writeFileSync(process.argv[3],patchSource(readFileSync(process.argv[2],'utf8')),{mode:0o600});
