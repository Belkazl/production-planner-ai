import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {join} from "node:path";
import {typeName,typeNames,createType} from "./types.mjs";
import {prepareSource as oldPrepare} from "../groq-universal-parameters-20261126/prepare.mjs";
import {source as oldUI,serverTransform as previousUI} from "../groq-parameter-units-20261126/patch.mjs";
import {transformActionsHtml} from "../groq-universal-parameters-20261126/actions-ui.mjs";
import {newScript as oldSdk} from "../equipment-sdk-xl-regular-20261127/patch.mjs";
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,"TYPE_ANCHOR: "+a.slice(0,90));return s.replace(a,()=>b)};
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const shared=[typeName,typeNames,createType].map(f=>f.toString()).join("\n");
export const prepare=once(once(oldPrepare,'  add_order:["kind","quantity"', '  create_equipment_type:["kind","type_name","equipment_index"],\n  add_order:["kind","quantity"'),' const list=v=>Array.isArray(v)?v:[];', ' if(args.kind==="create_equipment_type")return ('+createType.toString()+')(model,args.type_name,args.equipment_index);\n const list=v=>Array.isArray(v)?v:[];').replace('function ppGroqPrepareEdit(model,args){','function ppGroqPrepareEdit(model,args){\n'+typeName.toString()+'\n'+typeNames.toString()+'\n');
export const prepareEdit=new Function(prepare+"\nreturn ppGroqPrepareEdit;")();
const runtime=read("../groq-universal-parameters-20261126/actions-runtime.js");
let nextRuntime=once(runtime,'set_equipment_parameter_rule edits allowed/min/max equipment capabilities','create_equipment_type creates a new reusable type in the current project (type_name, optional equipment_index only when the user explicitly asks to assign the new type to that machine). Check editingCatalog.equipmentTypes for existing names. set_equipment_parameter_rule edits allowed/min/max equipment capabilities');
nextRuntime=once(nextRuntime,'enum:["add_order","complete_order_parameters"','enum:["create_equipment_type","add_order","complete_order_parameters"');
nextRuntime=once(nextRuntime,'equipment_index:{type:"integer"},','equipment_index:{type:"integer"},type_name:{type:"string",description:"Exact name of the new equipment type, e.g. cutting"},');
nextRuntime=once(nextRuntime,'const catalog={quantityUnit:','const catalog={equipmentTypes:('+typeNames.toString()+')(model).map(x=>ppGroqSafeLabel(x)).filter(Boolean).slice(0,80),quantityUnit:');
nextRuntime=once(nextRuntime,'capacity:ppGroqNumber(e.capacity),','kind:label(e.kind,"other"),capacity:ppGroqNumber(e.capacity),');
nextRuntime=once(nextRuntime,'   choose_process:[','   duplicate_equipment_type:["This equipment type already exists.","Такой тип оборудования уже существует."],\n   invalid_equipment_type:["Enter a valid equipment type name.","Укажите корректное название типа оборудования."],\n   choose_process:[');
export function patchTenant(s){
 s=once(s,oldPrepare,prepare);
 return once(s,runtime,nextRuntime);
}
let ui=once(oldUI,oldPrepare,prepare);
ui=once(ui,'const kinds={set_order_parameters:', 'const kinds={create_equipment_type:t("New equipment type","Новый тип оборудования"),set_order_parameters:');
ui=once(ui,' switch(args.kind){',' switch(args.kind){\n case "create_equipment_type":{\n  const saved=Array.isArray(actual.equipment_types)&&actual.equipment_types.includes(args.type_name.normalize("NFC").trim().replace(/ +/g," "));\n  if(!saved)return false;if(args.equipment_index===undefined)return true;\n  return fields(eq(expected)?.[args.equipment_index-1],eq(actual)?.[args.equipment_index-1],["id","kind"]);\n }');
const newUI="\nfunction ppGroqActionsHtml(html){return ("+transformActionsHtml.toString()+")(html,"+JSON.stringify(ui)+");}\n";
function openTypeDialog(s,t){
 const section=root(),body=section?.querySelector("#ppEditBody");if(!body||!s.isConnected)return;
 const lang=()=>window.__PP_LANGUAGE__?.current==="ru"||document.getElementById("ppLanguageSelect")?.value==="ru";
 const tr=(en,ru)=>lang()?ru:en;
 const d=make("dialog","pp-sdk-type-dialog");d.setAttribute("aria-label",tr("New equipment type","Новый тип оборудования"));
 const form=make("form","pp-sdk-type-form");form.method="dialog";
 const title=make("strong","");title.textContent=tr("New equipment type","Новый тип оборудования");
 const field=make("label","");field.textContent=tr("Type name","Название типа");
 const input=make("input","pp-sdk-type-name");input.placeholder=tr("e.g. cutting","Например, резка");input.maxLength=80;input.required=true;field.append(input);
 const error=make("div","pp-sdk-type-error");error.setAttribute("role","alert");
 const buttons=make("div","pp-sdk-type-buttons"),cancel=make("button","pp-sdk-type-cancel"),add=make("button","pp-sdk-type-add");
 cancel.type="button";cancel.textContent=tr("Cancel","Отмена");add.type="submit";add.textContent=tr("Add","Добавить");buttons.append(cancel,add);form.append(title,field,error,buttons);d.append(form);section.append(d);
 const discard=()=>{d.close();d.remove();if(t.isConnected)t.focus({preventScroll:true})};
 d.addEventListener("cancel",e=>{e.preventDefault();discard()});cancel.onclick=discard;
 form.onsubmit=e=>{
  e.preventDefault();
  if(!body.isConnected||!s.isConnected){discard();return}
  let name;try{name=typeName(input.value)}catch{error.textContent=tr("Enter a valid type name (up to 80 characters).","Введите корректное название типа (до 80 символов).");return}
  const known=[...typeNames(model),...draftTypes(body),...[...body.querySelectorAll('select[data-f="kind"] option')].map(o=>o.value)];
  if(known.some(x=>x.toLowerCase()===name.toLowerCase())){error.textContent=tr("This type already exists.","Такой тип уже существует.");return}
  if(draftTypes(body).length+(model?.equipment_types?.length||0)>=200){error.textContent=tr("Too many equipment types.","Слишком много типов оборудования.");return}
  body.dataset.ppEquipmentTypeDraft=JSON.stringify([...draftTypes(body),name]);
  fillDraft(body);s.value=name;synchronize(s,t);
  s.dispatchEvent(new Event("input",{bubbles:true}));s.dispatchEvent(new Event("change",{bubbles:true}));discard();
 };
 d.showModal();input.focus();
}
function draftTypes(body){
 try{const raw=JSON.parse(body?.dataset.ppEquipmentTypeDraft||"[]");return Array.isArray(raw)?raw.map(typeName):[]}catch{return []}
}
function fillDraft(body){
 if(!body)return;
 for(const s of body.querySelectorAll('select[data-f="kind"]'))for(const k of draftTypes(body))if(![...s.options].some(o=>o.value===k)){const option=document.createElement("option");option.value=k;option.textContent=k;s.append(option)}
}
let sdk=once(oldSdk,' const show=(s,t)=>{',typeName.toString()+"\n"+typeNames.toString()+"\n"+draftTypes.toString()+"\n"+fillDraft.toString()+"\n"+openTypeDialog.toString()+"\n const show=(s,t)=>{");
sdk=once(sdk,'  const opts=[...s.options].filter(o=>!o.hidden&&!o.disabled);','  const opts=[...s.options].filter(o=>!o.hidden&&!o.disabled);\n  if(s.dataset.f==="kind")opts.push({ppNewType:true,selected:false,textContent:(window.__PP_LANGUAGE__?.current==="ru"||document.getElementById("ppLanguageSelect")?.value==="ru")?"+ Добавить тип":"+ Add new type"});');
sdk=once(sdk,'const choose=()=>{s.value=o.value;', 'const choose=()=>{if(o.ppNewType){close(false);openTypeDialog(s,t);return}s.value=o.value;');
sdk=once(sdk,'  table.classList.add("pp-sdk-equipment-table");','  table.classList.add("pp-sdk-equipment-table");\n  fillDraft(section.querySelector("#ppEditBody"));');
const css=`
/* PP_EQUIPMENT_TYPES_V1 */
#sectionView .pp-sdk-type-dialog{box-sizing:border-box;background:var(--color-surface-elevated);color:var(--color-text);border:1px solid var(--color-border);border-radius:var(--radius-2xl);padding:24px;max-width:min(440px,calc(100vw - 32px));width:100%;box-shadow:var(--shadow);font-family:var(--font-sans);font-size:var(--font-text-sm-size)}
#sectionView .pp-sdk-type-dialog::backdrop{background:rgb(0 0 0 / 30%)}
#sectionView .pp-sdk-type-form{display:grid;gap:16px;margin:0}
#sectionView .pp-sdk-type-form label{display:grid;gap:8px}
#sectionView .pp-sdk-type-name{box-sizing:border-box;border:0;border-radius:var(--radius-full);height:40px;padding:0 16px;box-shadow:0 0 0 1px var(--input-outline-border-color) inset;font:inherit;color:inherit;background:transparent}
#sectionView .pp-sdk-type-name:focus{outline:0;box-shadow:0 0 0 1px var(--input-outline-border-color-focus) inset}
#sectionView .pp-sdk-type-error:empty{display:none}
#sectionView .pp-sdk-type-error{color:#b42318}
#sectionView .pp-sdk-type-buttons{display:flex;justify-content:flex-end;gap:8px}
#sectionView .pp-sdk-type-buttons button{border:0;border-radius:var(--radius-full);height:40px;padding:0 18px;font:inherit;cursor:pointer}
#sectionView .pp-sdk-type-cancel{background:transparent;color:inherit;box-shadow:0 0 0 1px var(--input-outline-border-color) inset}
#sectionView .pp-sdk-type-add{background:var(--color-text);color:var(--color-surface-elevated)}
`;
export function transformTypes(html,sdkOld,sdkNew,css,shared){
 if(typeof html!=="string"||html.includes("PP_EQUIPMENT_TYPES_V1")||!html.includes("PP_EQUIPMENT_SDK_XL_REGULAR_V1"))return html;
 const edit='<script id="ppEditableTablesJs">';
 const process='<script id="ppTechProcessJs">';
 const patchScript=(doc,id,fn)=>{
  const re=new RegExp('<script\\b[^>]*\\bid=["\\\']'+id+'["\\\'][^>]*>([\\s\\S]*?)<\\/script\\s*>','gi');
  const matches=[...doc.matchAll(re)];if(matches.length!==1)throw Error("type script anchor "+id);
  const m=matches[0],start=m.index+m[0].indexOf(">")+1;return doc.slice(0,start)+fn(m[1])+doc.slice(start+m[1].length)
 };
 const swap=(s,a,b)=>{if(s.split(a).length!==2)throw Error("type anchor "+a.slice(0,60));return s.replace(a,()=>b)};
 let out=patchScript(html,"ppEditableTablesJs",s=>{
  s=swap(s," for(const e of ppEquipmentEditorRows(m))add(e?.kind);"," for(const e of ppEquipmentEditorRows(m))add(e?.kind);\n for(const k of Array.isArray(m.equipment_types)?m.equipment_types:[])add(k);");
  s=swap(s,"const next=clone(model),rows=[...q('sectionView').querySelectorAll('tr[data-row]')];","const next=clone(model),rows=[...q('sectionView').querySelectorAll('tr[data-row]')];\n if(name==='Оборудование'){const body=q('sectionView').querySelector('#ppEditBody');const draft=JSON.parse(body?.dataset.ppEquipmentTypeDraft||'[]');if(draft.length)next.equipment_types=[...new Set([...(Array.isArray(next.equipment_types)?next.equipment_types:[]),...draft])];}");
  return s
 });
 out=patchScript(out,"ppTechProcessJs",s=>swap(s,"let eq=model.autoclaves||[],k=[...new Set(eq.map(x=>x.kind||'other'))];","let eq=Array.isArray(model.equipment)&&model.equipment.length?model.equipment:model.autoclaves||[],k=("+shared+")(model);"));
 out=swap(out,sdkOld,sdkNew);
 return swap(out,"</head>",'<style id="ppEquipmentTypesStyle">'+css+'</style></head>');
}
export function transformPage(html){
 // The same wrapper applies in the test browser and on the server.
 try{return transformTypes(html,oldSdk,sdk,css,typeNames.toString())}catch(e){throw e}
}
export function patchAuth(auth){
 let s=once(auth,previousUI(),newUI);
 const before="const assistantHtml=ppEquipmentSDKPage(",after="const assistantHtml=ppEquipmentTypesPage(ppEquipmentSDKPage(";
 const lines=s.split("\n"),indices=lines.map((l,i)=>l.includes(before)?i:-1).filter(i=>i>=0);
 assert.equal(indices.length,1);const i=indices[0];assert(lines[i].trim().endsWith(";"));lines[i]=lines[i].replace(before,after).replace(/;\s*$/,");");
 s=lines.join("\n");
 return s+"\nfunction ppEquipmentTypesPage(html){return ("+transformTypes.toString()+")(html,"+JSON.stringify(oldSdk)+","+JSON.stringify(sdk)+","+JSON.stringify(css)+","+JSON.stringify(typeNames.toString())+");}\n";
}
if(process.argv[1]?.endsWith("/equipment-types-create-20261127/patch.mjs")){
 const [before,after]=process.argv.slice(2);mkdirSync(after,{recursive:true,mode:0o700});
 for(const [f,fn] of [["auth-runtime.js",patchAuth],["tenant-model-runtime.js",patchTenant]])writeFileSync(join(after,f),fn(readFileSync(join(before,f),"utf8")),{mode:0o600});
 // The existing deployment script verifies the exact native file hash, and never modifies its contents.
 writeFileSync(join(after,"python-ga-upstream.mjs"),readFileSync(join(before,"python-ga-upstream.mjs")),{mode:0o600});
 console.log("EQUIPMENT_TYPES_EXACT_PATCH_PASS");
}
