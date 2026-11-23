function ppResourceUnitsHtml(input){
 let html=input;
 // Compatibility with login or debug HTML that does not include native editors.
 if(!html.includes("function rr(r){")&&!html.includes("function renderMaterials(){"))return html;
 if(!html.includes("function rr(r){")||!html.includes("function renderMaterials(){"))
   throw Error("PP_RESOURCE_UNITS_PARTIAL_EDITOR_SOURCE");
 const swap=(a,b,label)=>{
  const count=html.split(a).length-1;
  if(count!==1)throw Error("PP_RESOURCE_UNITS_SOURCE_DRIFT_"+label+"_"+count);
  html=html.replace(a,b);
 };
 const helpers=`
function ppCanonicalRequirementUnit(req,sourceModel){
 const type=String(req?.resource_type||'employee');
 if(type==='equipment')return 'шт.';
 if(type==='employee')return 'чел.';
 if(type!=='material')return '';
 const owned=sourceModel||model;
 let materials=Array.isArray(owned?.materials)&&owned.materials.length?owned.materials:null;
 if(!materials&&owned?.material){
  const m=owned.material;
  materials=[{id:m.id||'M1',name:m.name||'Материал',unit:m.unit||'кг'}];
 }
 if(!materials)materials=typeof mats==='function'?mats():[];
 const ref=String(req?.resource_ref??req?.resource_refs?.[0]??'').trim();
 const selected=materials.find(x=>String(x?.id||'')===ref||String(x?.name||'')===ref)
  ||(!ref&&materials.length?materials[0]:null);
 return selected?String(selected.unit||'кг').trim()||'кг':'';
}
function ppNormalizeRequirementUnits(draft){
 let fixes=0;
 for(const proc of (Array.isArray(draft?.technical_processes)?draft.technical_processes:[])){
  for(const op of (Array.isArray(proc?.operations)?proc.operations:[])){
   for(const req of (Array.isArray(op?.resource_requirements)?op.resource_requirements:[])){
    if(!req||!['employee','equipment','material'].includes(req.resource_type))continue;
    const unit=ppCanonicalRequirementUnit(req,draft);
    if(unit&&req.unit!==unit){req.unit=unit;fixes++;}
   }
  }
 }
 return fixes;
}
`;
 swap("function rr(r){",helpers+"\nfunction rr(r){","insert_canonical_helpers");
 const oldUnit=`'<td><input class="pp-edit-input" data-rf="unit" value="'+esc(r.unit||(t==='employee'?'чел.':t==='equipment'?'шт.':'кг'))+'"></td>'`;
 const newUnit=`'<td><input class="pp-edit-input" data-rf="unit" value="'+esc(ppCanonicalRequirementUnit(r))+'" readonly aria-readonly="true" title="Единица задана типом ресурса или справочником материалов"></td>'`;
 swap(oldUnit,newUnit,"read_only_derived_unit");
 const oldRefresh=`if(t==='material'){u.value=u.value||'кг';c.disabled=false;if(c.value==='during_operation')c.value='per_operation'}else{u.value=t==='employee'?'чел.':'шт.';c.value='during_operation';c.disabled=true}`;
 const newRefresh=`if(t==='material'){c.disabled=false;if(c.value==='during_operation')c.value='per_operation'}else{c.value='during_operation';c.disabled=true}u.value=ppCanonicalRequirementUnit({resource_type:t,resource_ref:ref.value,match_mode:m});u.readOnly=true`;
 swap(oldRefresh,newRefresh,"refresh_type_and_unit");
 const oldBind=`root.querySelectorAll('[data-rf=resource_type],[data-rf=match_mode]').forEach(x=>x.onchange=()=>refresh(x.closest('[data-r]')))}`;
 const newBind=`root.querySelectorAll('[data-rf=resource_type],[data-rf=match_mode]').forEach(x=>x.onchange=()=>refresh(x.closest('[data-r]')));root.querySelectorAll('[data-rf=resource_ref]').forEach(x=>x.onchange=()=>{const row=x.closest('[data-r]'),u=row?.querySelector('[data-rf=unit]'),t=row?.querySelector('[data-rf=resource_type]')?.value;if(u)u.value=ppCanonicalRequirementUnit({resource_type:t,resource_ref:x.value})})}`;
 swap(oldBind,newBind,"update_when_material_selected");
 swap(`unit:r.querySelector('[data-rf=unit]').value.trim()`,
      `unit:ppCanonicalRequirementUnit({resource_type:t,resource_ref:r.querySelector('[data-rf=resource_ref]').value},model)`,
      "save_from_authoritative_source");
 swap(`async function save(next,section){stat('Сохраняю...');try{`,
      `async function save(next,section){const ppFixedUnits=ppNormalizeRequirementUnits(next);if(ppFixedUnits)console.info('PP_RESOURCE_UNITS_SYNCHRONIZED',ppFixedUnits);stat('Сохраняю...');try{`,
      "reconcile_legacy_units_for_every_save");
 swap(`name:m.name||'Материал',unit:'кг',initial_stock:`,
      `name:m.name||'Материал',unit:m.unit||'кг',initial_stock:`,
      "legacy_material_unit_from_its_own_definition");
 swap(`l.name=g.name;l.initial_stock_kg=`,
      `l.name=g.name;l.unit=g.unit;l.initial_stock_kg=`,
      "legacy_material_unit_follow_primary_material");
 if(!html.includes('readonly aria-readonly="true"')||
    !html.includes("ppNormalizeRequirementUnits(next)")||
    !html.includes("root.querySelectorAll('[data-rf=resource_ref]').forEach")||
    !html.includes("unit:ppCanonicalRequirementUnit({resource_type:t,resource_ref:"))
   throw Error("PP_RESOURCE_UNITS_TRANSFORM_POSTCONDITION");
 return html;
}
