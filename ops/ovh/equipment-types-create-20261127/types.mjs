export function typeName(raw){
 if(typeof raw!=="string"||/[\x00-\x1f\x7f]/.test(raw))throw Error("invalid_equipment_type");
 const name=raw.normalize("NFC").trim().replace(/ +/g," ");
 if(!/^[\p{L}\p{N}][\p{L}\p{N} _/.-]{0,79}$/u.test(name)||["__proto__","prototype","constructor"].includes(name.toLowerCase()))throw Error("invalid_equipment_type");
 return name;
}
export function typeNames(model){
 const kinds=new Map(),add=k=>{if(typeof k==="string"&&k.trim()&&!kinds.has(k.trim().toLowerCase()))kinds.set(k.trim().toLowerCase(),k.trim())};
 for(const e of (Array.isArray(model?.equipment)&&model.equipment.length?model.equipment:model?.autoclaves)||[])add(e?.kind||"other");
 for(const k of Array.isArray(model?.equipment_types)?model.equipment_types:[])add(k);
 for(const p of model?.technical_processes||[])for(const o of p?.operations||[])for(const req of o?.resource_requirements||[])if(req.resource_type==="equipment")for(const ref of [req.resource_ref,...(Array.isArray(req.resource_refs)?req.resource_refs:[])])if(typeof ref==="string"&&ref.startsWith("kind:"))add(ref.slice(5));
 return [...kinds.values()];
}
export function createType(model,name,index){
 const normalized=typeName(name);
 if(typeNames(model).some(x=>x.toLowerCase()===normalized.toLowerCase()))throw Error("duplicate_equipment_type");
 const next=structuredClone(model),registry=Array.isArray(next.equipment_types)?next.equipment_types:[];
 if(registry.length>=200)throw Error("too_many_changes");
 next.equipment_types=[...registry,normalized];
 const change={kind:"create_equipment_type",record:normalized};
 if(index!==undefined){
  const equipment=Array.isArray(next.equipment)&&next.equipment.length?next.equipment:next.autoclaves||[];
  if(!Number.isSafeInteger(index)||index<1||index>equipment.length)throw Error("unknown_record");
  const e=equipment[index-1],old=e.kind;
  const mirrors=(equipment===next.equipment?next.autoclaves:next.equipment)||[];
  const matched=mirrors.filter(x=>e.id!=null&&String(x.id)===String(e.id));
  if(matched.length>1||matched.length===1&&matched[0].kind!==old)throw Error("ambiguous_resource");
  e.kind=normalized;if(matched.length===1)matched[0].kind=normalized;
  change.record=String(e.name||e.id||"Equipment");change.before=old||"other";change.after=normalized;
 }
 return {model:next,change};
}
