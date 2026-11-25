/* Native editor helper. Uses existing model/save/renderEmployees scope. */
function ppWCMinute(value) {
  if(typeof value!=='string'||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))throw Error('Invalid time');
  return Number(value.slice(0,2))*60+Number(value.slice(3));
}
function ppWCClock(value){value=((value%1440)+1440)%1440;return String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0')}
function ppWCBlocks(cal){
  if(!Array.isArray(cal.days)||!cal.days.length||new Set(cal.days).size!==cal.days.length||cal.days.some(d=>!Number.isInteger(d)||d<1||d>7))throw Error('Select working days');
  let start=ppWCMinute(cal.start),end=ppWCMinute(cal.end);
  if(start===end&&cal.full_day!==true)throw Error('Start and end must differ, or select 24 hours');
  if(end<=start)end+=1440;
  if(!Array.isArray(cal.breaks)||cal.breaks.length>24)throw Error('Invalid breaks');
  const breaks=cal.breaks.map(pair=>{if(!Array.isArray(pair)||pair.length!==2)throw Error('Invalid break');let a=ppWCMinute(pair[0]),b=ppWCMinute(pair[1]);if(a<start)a+=1440;if(b<=a)b+=1440;if(a<start||a>=b||b>end)throw Error('Break outside shift');return[a,b]}).sort((a,b)=>a[0]-b[0]);
  const work=[];let cursor=start;
  for(const [a,b] of breaks){if(a<cursor)throw Error('Overlapping breaks');if(cursor<a)work.push([ppWCClock(cursor),ppWCClock(a)]);cursor=b}
  if(cursor<end)work.push([ppWCClock(cursor),ppWCClock(end)]);
  if(!work.length)throw Error('Shift has no working time');
  return work;
}
function ppWCLegacy(name,blocks){
  if(!Array.isArray(blocks)||!blocks.length)return null;
  try{
    const first=ppWCMinute(blocks[0][0]);let cursor=first;const breaks=[];
    for(const pair of blocks){
      if(!Array.isArray(pair)||pair.length!==2)return null;
      let a=ppWCMinute(pair[0]),b=ppWCMinute(pair[1]);
      if(a<first)a+=1440;
      if(b<=a)b+=1440;
      if(a<cursor||b>first+1440)return null;
      if(a>cursor)breaks.push([ppWCClock(cursor),ppWCClock(a)]);
      cursor=b;
    }
    return {name,days:[1,2,3,4,5,6,7],start:ppWCClock(first),end:ppWCClock(cursor),full_day:cursor===first+1440,breaks};
  }catch{return null}
}
function ppWCMount(){
  if(typeof model!=='object'||!model||typeof save!=='function'||!model.shifts||Array.isArray(model.shifts)||typeof model.shifts!=='object')return;
  const table=Array.from(document.querySelectorAll('table')).find(t=>{
    const labels=Array.from(t.querySelectorAll('th')).map(x=>x.textContent.trim().toLowerCase());
    return labels.some(x=>/^(employee|сотрудник)$/.test(x))&&labels.some(x=>/^(shift|смена)$/.test(x))&&labels.some(x=>/^(schedule|график|расписание)$/.test(x));
  });
  if(!table||!table.parentElement)return;
  const parent=table.parentElement,old=parent.querySelector('[data-pp-weekly-calendar]');
  if(old)old.remove();
  const ru=String(document.documentElement.lang||'').startsWith('ru')||Array.from(table.querySelectorAll('th')).some(x=>x.textContent.trim()==='Сотрудник');
  const t=(en,rs)=>ru?rs:en;
  const draft=JSON.parse(JSON.stringify(model.shift_calendars||{}));
  const sourceShifts=JSON.parse(JSON.stringify(model.shifts));
  const labels=ru?['Пн','Вт','Ср','Чт','Пт','Сб','Вс']:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const el=(tag,txt)=>{const x=document.createElement(tag);if(txt!==undefined)x.textContent=txt;return x};
  const button=(txt,click)=>{const b=el('button',txt);b.type='button';b.className='pp-edit-input';b.addEventListener('click',click);return b};
  const input=(type,value,change)=>{const x=el('input');x.type=type;x.value=value;x.className='pp-edit-input';x.addEventListener('input',()=>change(x.value));return x};
  const panel=el('section');panel.dataset.ppWeeklyCalendar='1';panel.style.cssText='display:grid;gap:12px;margin:0 0 16px;padding:16px;border:1px solid #d7e1ee;border-radius:10px;';
  const head=el('div');head.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap';
  head.append(el('strong',t('Work schedules','Рабочие графики')));
  const controls=el('div');controls.style.cssText='display:flex;gap:8px;flex-wrap:wrap';head.append(controls);
  const content=el('div');content.style.cssText='display:grid;gap:12px';const message=el('div');message.setAttribute('role','status');message.style.color='#a33';
  const nativeNames=Object.keys(sourceShifts);
  const state={};for(const id of nativeNames)state[id]=draft[id]||ppWCLegacy(id,sourceShifts[id])||null;
  const dirty=new Set();
  const render=()=>{
    content.replaceChildren();
    for(const id of Object.keys(state)){
      const cal=state[id],card=el('div');card.style.cssText='display:grid;gap:10px;padding:12px;border:1px solid #d7e1ee;border-radius:8px';
      const row=el('div');row.style.cssText='display:flex;gap:12px;flex-wrap:wrap;align-items:center';
      row.append(el('strong',id));
      if(!cal){
        row.append(el('span',t('Schedule is not configured','График не настроен')),button(t('Configure','Настроить'),()=>{state[id]={name:id,days:[1,2,3,4,5],start:'08:00',end:'17:00',full_day:false,breaks:[]};dirty.add(id);render()}));card.append(row);content.append(card);continue;
      }
      const mark=()=>dirty.add(id);
      const field=(txt,type,value,change)=>{const label=el('label',txt+' ');label.append(input(type,value,v=>{change(v);mark()}));return label};
      row.append(field(t('Name','Название'),'text',cal.name||id,v=>cal.name=v),
        field(t('Start','Начало'),'time',cal.start,v=>cal.start=v),
        field(t('End','Окончание'),'time',cal.end,v=>cal.end=v));
      const full=el('label'),check=el('input');check.type='checkbox';check.checked=cal.full_day===true;check.addEventListener('change',()=>{cal.full_day=check.checked;mark()});full.append(check,document.createTextNode(t(' 24 hours (same start/end)',' 24 часа (одинаковое время)')));row.append(full);
      card.append(row);
      const days=el('div');days.style.cssText='display:flex;gap:12px;flex-wrap:wrap';
      labels.forEach((label,i)=>{const l=el('label'),c=el('input');c.type='checkbox';c.checked=cal.days.includes(i+1);c.addEventListener('change',()=>{cal.days=cal.days.filter(x=>x!==i+1);if(c.checked)cal.days.push(i+1);mark()});l.append(c,document.createTextNode(' '+label));days.append(l)});card.append(days);
      const breaks=el('div');breaks.style.cssText='display:flex;gap:8px;flex-wrap:wrap;align-items:center';breaks.append(el('span',t('Breaks','Перерывы')));
      cal.breaks.forEach((pair,index)=>{const r=el('div');r.style.cssText='display:flex;gap:4px;align-items:center';r.append(input('time',pair[0],v=>{pair[0]=v;mark()}),el('span','–'),input('time',pair[1],v=>{pair[1]=v;mark()}),button('×',()=>{cal.breaks.splice(index,1);mark();render()}));breaks.append(r)});
      breaks.append(button(t('+ Break','+ Перерыв'),()=>{cal.breaks.push(['12:00','13:00']);mark();render()}));card.append(breaks);
      content.append(card);
    }
  };
  const add=button(t('+ Add shift','+ Добавить смену'),()=>{let n=1;while(Object.hasOwn(state,'shift-'+n))n++;const id='shift-'+n;state[id]={name:t('Shift ','Смена ')+n,days:[1,2,3,4,5],start:'08:00',end:'17:00',full_day:false,breaks:[]};dirty.add(id);render()});
  let saving=false;
  const commit=button(t('Save schedules','Сохранить графики'),async()=>{
    if(saving||!dirty.size)return;
    let next;try{
      next=JSON.parse(JSON.stringify(model));next.shift_calendars=next.shift_calendars||{};
      for(const id of dirty){const cal=state[id];if(!cal)throw Error('Invalid shift');next.shifts[id]=ppWCBlocks(cal);next.shift_calendars[id]=JSON.parse(JSON.stringify(cal))}
    }catch(e){message.textContent=String(e.message||e);return}
    saving=true;commit.disabled=true;message.textContent='';
    try{await save(next,'employees');queueMicrotask(()=>ppWCMount())}
    catch(e){message.textContent=t('Unable to save schedules','Не удалось сохранить графики')}
    finally{saving=false;commit.disabled=false}
  });
  controls.append(add,commit);panel.append(head,content,message);render();parent.insertBefore(panel,table);
  const headers=Array.from(table.querySelectorAll('th')).map(x=>x.textContent.trim().toLowerCase());
  const column=headers.findIndex(x=>/^(schedule|график|расписание)$/.test(x));
  for(const row of table.querySelectorAll('tbody tr')){
    const select=row.querySelector('select');const cell=row.cells[column];if(!select||!cell)continue;
    for(const option of select.options){const c=draft[option.value];if(c&&c.name)option.textContent=c.name}
    const update=()=>{const id=select.value,cal=draft[id],windows=sourceShifts[id];
      cell.textContent=Array.isArray(windows)?windows.map(pair=>Array.isArray(pair)?pair.join('–'):'').filter(Boolean).join(', '):t('Not configured','Не настроен');
      if(cal)cell.textContent+=' · '+cal.days.slice().sort((a,b)=>a-b).map(d=>labels[d-1]).join(', ');
    };update();select.addEventListener('change',update);
  }
}
