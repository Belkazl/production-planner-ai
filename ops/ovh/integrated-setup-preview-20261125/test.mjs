import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {patchPreview} from './patch.mjs';
import {patchUpstream} from '../first-candidate-preview-20261124/patch.mjs';

const repo=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const base=readFileSync(resolve(repo,'ops/ovh/ga-complete-setup-final-20261117/python-ga-upstream.mjs'),'utf8');
const stream=readFileSync(resolve(repo,'ops/ovh/sse-stream-v1-20261120/backend-stream.js.txt'),'utf8');
const assembled=base.replace('  async function fetchUpstream(req,opts){',stream+'  async function fetchUpstream(req,opts){')
  .replace("    if(path==='/api/plan-progress'&&req.method==='GET')return progress(req);",
    "    if(path==='/api/plan-progress'&&req.method==='GET')return progress(req);\n"+
    "    if(path==='/api/plan-events'&&req.method==='GET')return stream(req);");
const fixture=process.env.LIFTORBIT_INTEGRATED_PREVIEW_FIXTURE;
const source=fixture?readFileSync(fixture,'utf8'):patchUpstream(assembled);
const patched=patchPreview(source);
const jobId='a'.repeat(32);
const model={start:'2026-11-25T08:00:00',equipment:[{id:'M'}],employees:[],materials:[],
  orders:[{id:'O'}],setup_rules:[]};
const sleep=()=>new Promise(resolve=>setTimeout(resolve,5));
async function until(check){
  const end=Date.now()+1500;
  while(Date.now()<end){if(check())return;await sleep();}
  assert.fail('preview event timed out');
}
function plan(duration=100,withSetup=true){
  const operations=Array.from({length:16},(_,i)=>({operation_id:'P'+i,order:'O',batch:i+1,
    batch_quantity:1,equipment_ids:['M'],employee_ids:[],start_min:duration-32+i*2,
    end_min:duration-31+i*2}));
  const setup_operations=withSetup?[{operation_id:'S',order:'O',is_setup:true,phase:'setup',
    equipment_ids:['M'],employee_ids:[],start_min:duration-34,end_min:duration-32}]:[];
  return {ok:true,valid:true,partial:false,operations,generic_operations:operations,setup_operations,
    batches:[],start:model.start,duration_minutes:duration-1,batch_count:16,
    operator_wait_minutes:25,machine_idle_minutes:15,order_sequence:['O']};
}
function makeHarness({best=plan(),candidate=plan(200),objective='duration'}={}){
  const value={best,candidate};
  const currentModel={...model,objective};
  let timer,controller,sequence=0,reads=0;
  const timers={setInterval(fn,ms){assert.equal(ms,4000);timer=fn;return 1;},clearInterval(){timer=null;}};
  const factory=new Function('timers','const {setInterval,clearInterval}=timers;\n'+
    patched.replace('export function createPythonGAUpstream','function createPythonGAUpstream')+
    '\nreturn createPythonGAUpstream;')(timers);
  const bridge=factory({enabled:true,origin:'http://ga-worker.railway.internal:8080',
    token:'synthetic-token-'.repeat(3),upstreamUrl:req=>req.url,
    sessionKey:async()=> 'synthetic-account',verifyLogin:async()=>true,
    readAccountModel:async()=>currentModel,hashModel:m=>JSON.stringify(m),
    checkPlan:p=>p.operations.every(op=>op.order==='O'),
    stateStore:{load:async()=>({job_id:jobId,model_hash:JSON.stringify(currentModel),status:'running',progress:2}),save:async()=>{}},
    fetchImpl:async(url)=>{
      if(url.endsWith('/events'))return new Response(new ReadableStream({start(c){controller=c;}}));
      reads++;
      return Response.json({job_id:jobId,status:'running',progress:5,
        best_preview:value.best,candidate_preview:value.candidate});
    }});
  return {value,reads:()=>reads,
    async subscribe(){
      const res=await bridge.fetch(new Request('https://app.liftorbit.app/api/plan-events?job_id='+jobId));
      const reader=res.body.getReader(),decoder=new TextDecoder(),events=[];
      let buffer='';
      const done=(async()=>{for(;;){const chunk=await reader.read();if(chunk.done)return;
        buffer+=decoder.decode(chunk.value,{stream:true});let at;
        while((at=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,at);buffer=buffer.slice(at+2);
          const lines=frame.split('\n'),kind=lines.find(x=>x.startsWith('event: '))?.slice(7);
          const data=lines.find(x=>x.startsWith('data: '))?.slice(6);
          if(kind&&data)events.push({kind,data:JSON.parse(data)});
        }
      }})();
      return {events,close:async()=>{await reader.cancel();await done;}};
    },
    tick(){assert.equal(typeof timer,'function');timer();},
    signal(){controller.enqueue(new TextEncoder().encode('event: progress\ndata: '+JSON.stringify({
      job_id:jobId,seq:sequence++,status:'running',progress:6,stage:'optimizing'})+'\n\n'));}
  };
}

test('patch preserves job identity, cadence and unrelated source and is idempotent',()=>{
  assert.equal(patchPreview(patched),patched);
  execFileSync(process.execPath,['--check','--input-type=module'],{input:patched,stdio:['pipe','pipe','pipe']});
  assert.throws(()=>patchPreview(source.replaceAll('data.job_id!==job.id','false')),/REQUIRED_GUARD/);
  assert.throws(()=>patchPreview(patched.replace('boundedPreview(stored,model):null','boundedPreview(data.candidate_preview,model):null')),/INSTALLED_DRIFT/);
});
test('slower search candidate cannot replace the full incumbent metrics or its setup schedule',async()=>{
  const h=makeHarness(),s=await h.subscribe();
  try{
    await until(()=>s.events.some(e=>e.kind==='preview'));
    const preview=s.events.find(e=>e.kind==='preview').data.plan;
    assert.equal(preview._pp_preview_origin,'best');
    assert.equal(preview._pp_preview_kpis.duration_minutes,99);
    assert.equal(preview.operations.length,10);
    assert.equal(preview.operations[0].operation_id,'S');
    assert.equal(preview.operations[0].start_min,66);
    assert.equal(preview._pp_preview_kpis.operator_wait_minutes,25);
    h.value.candidate=plan(300);h.tick();await sleep();await sleep();
    assert.equal(s.events.filter(e=>e.kind==='preview').length,1,'candidate-only changes do not repaint best');
    h.value.best=plan(80);h.tick();
    await until(()=>s.events.filter(e=>e.kind==='preview').length===2);
    const improved=s.events.filter(e=>e.kind==='preview').at(-1).data.plan;
    assert.equal(improved._pp_preview_kpis.duration_minutes,79);
    assert.equal(improved.operations[0].start_min,46);
  }finally{await s.close();}
});
test('a legitimate best with zero setups is retained while candidate has changeovers',async()=>{
  const h=makeHarness({best:plan(90,false),candidate:plan(120,true)}),s=await h.subscribe();
  try{
    await until(()=>s.events.some(e=>e.kind==='preview'));
    const preview=s.events.find(e=>e.kind==='preview').data.plan;
    assert.equal(preview._pp_preview_kpis.duration_minutes,89);
    assert.equal(preview._pp_preview_setup_count,0);
    assert(preview.operations.every(op=>!op.is_setup));
  }finally{await s.close();}
});
test('the native chosen objective is respected instead of selecting by duration in the display',async()=>{
  const best={...plan(200),operator_wait_minutes:0},candidate={...plan(100),operator_wait_minutes:20};
  const h=makeHarness({best,candidate,objective:'wait'}),s=await h.subscribe();
  try{
    await until(()=>s.events.some(e=>e.kind==='preview'));
    const preview=s.events.find(e=>e.kind==='preview').data.plan;
    assert.equal(preview._pp_preview_kpis.duration_minutes,199);
    assert.equal(preview._pp_preview_kpis.operator_wait_minutes,0);
    assert.equal(preview.operations[0].start_min,166);
  }finally{await s.close();}
});
test('candidate alone is withheld until the native solver publishes a complete best',async()=>{
  const h=makeHarness({best:null}),s=await h.subscribe();
  try{
    await until(()=>h.reads()>0);await sleep();await sleep();
    assert.equal(s.events.filter(e=>e.kind==='preview').length,0);
    h.value.best=plan();h.signal();
    await until(()=>s.events.some(e=>e.kind==='preview'));
    assert.equal(s.events.find(e=>e.kind==='preview').data.plan._pp_preview_origin,'best');
  }finally{await s.close();}
});
test('clipped best retains only native presentation context and full KPIs for baseline migration',async()=>{
  const context={model_key:JSON.stringify({...model,objective:'duration'}),pin_key:null,objective:'duration'};
  const best={...plan(),_pp_native_schedule_v1:{version:'integrated-native-setup-v1-20261125',
    context:{...context,unrelated:'not part of the preview contract'},signature:'full-plan-only'}};
  const h=makeHarness({best}),s=await h.subscribe();
  try{
    await until(()=>s.events.some(e=>e.kind==='preview'));
    const preview=s.events.find(e=>e.kind==='preview').data.plan;
    assert.equal(preview.partial,true);
    assert.equal(preview._pp_preview_origin,'best');
    assert.equal(preview.operations.length,10);
    assert.equal(preview._pp_preview_kpis.duration_minutes,99);
    assert.deepEqual(preview._pp_preview_native_context,{version:'integrated-native-setup-v1-20261125',context});
    assert.equal(preview._pp_native_schedule_v1,undefined,'a clipped preview is never a complete canonical plan');
  }finally{await s.close();}
});
