import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const editor=fs.readFileSync(new URL('./calendar-editor.js',import.meta.url),'utf8');

export function transformEditor(html){
  if(!html.includes('function renderEmployees(){'))return html;
  assert.equal(html.split('function renderEmployees(){').length,2,'employee renderer drift');
  assert.equal(html.split('async function save(next,section){').length,2,'model save drift');
  assert(!html.includes('function ppWCMount(){'),'calendar already present');
  return html.replace('function renderEmployees(){',editor+'\nfunction renderEmployees(){queueMicrotask(()=>ppWCMount());');
}
export function transformHost(source){
  const start=source.indexOf('function ppResourceUnitsHtml(input){');
  assert(start>=0,'native resource editor transformer missing');
  assert.equal(source.split('function ppResourceUnitsHtml(input){').length,2);
  const prefix=source.slice(0,start),body=source.slice(start);
  const end=body.indexOf('\n return html;\n}');
  assert(end>=0,'native transformer return drift');
  assert(!source.includes('function ppWeeklyCalendarHtml('));
  const fn='function ppWeeklyCalendarHtml(html){\n'+
    ' if(!html.includes("function renderEmployees(){"))return html;\n'+
    ' if(html.split("function renderEmployees(){").length!==2||html.split("async function save(next,section){").length!==2)throw Error("WEEKLY_CALENDAR_NATIVE_EDITOR_DRIFT");\n'+
    ' if(html.includes("function ppWCMount(){"))return html;\n'+
    ' return html.replace("function renderEmployees(){",'+JSON.stringify(editor)+'+"\\nfunction renderEmployees(){queueMicrotask(()=>ppWCMount());");\n}\n';
  return prefix+body.slice(0,end)+'\n return ppWeeklyCalendarHtml(html);\n}'+body.slice(end+'\n return html;\n}'.length)+'\n'+fn;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('usage: patch-ui.mjs INPUT OUTPUT');
  fs.writeFileSync(output,transformHost(fs.readFileSync(input,'utf8')));
  console.log('WEEKLY_CALENDAR_EDITOR_STAGED');
}
