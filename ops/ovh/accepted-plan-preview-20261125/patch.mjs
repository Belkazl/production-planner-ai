import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {ppAcceptedPlanRunFloor} from './floor.mjs';
export const sha=s=>createHash('sha256').update(s).digest('hex');
export const EXPECTED_UI='2d7de0b8b9a268eaf5f35c4c4acdbeb64b1cb1b6c80a76d698bd014c191d4e33';
function once(s,a,b,label){assert.equal(s.split(a).length,2,'ACCEPTED_PLAN_ANCHOR_'+label);return s.replace(a,b)}
export function patchUi(source,expected=EXPECTED_UI){
 assert.equal(sha(source),expected,'ACCEPTED_PLAN_UI_HASH');
 const from=source.indexOf(';(function ppOneSseProgressAndGantt(){');
 const end=source.indexOf('\n})();',from);
 assert(from>=0&&end>from,'ACCEPTED_PLAN_SSE_SPAN');
 let s=source.slice(from,end+6);
 const helpers=ppAcceptedPlanRunFloor.toString()+'\n'+"\nconst acceptedRunFloor=ppAcceptedPlanRunFloor({window,\n project:()=>{try{const id=localStorage.getItem('prodplan.project.active.v2');return JSON.parse(localStorage.getItem('prodplan.projects.v2')||'[]').find(p=>String(p.id)===String(id))||null}catch{return null}},\n objective:()=>{try{return typeof window.ppOptimizerObjective==='function'?String(window.ppOptimizerObjective()):window.__ppOptimizerObjectiveAtStart||'duration'}catch{return 'duration'}},\n render:p=>{if(typeof window.renderPlan==='function')window.renderPlan(p);else if(typeof renderPlan==='function')renderPlan(p)},\n kpis:p=>{if(typeof window.renderKpisWithDelta==='function')window.renderKpisWithDelta(p);else if(typeof renderKpisWithDelta==='function')renderKpisWithDelta(p)},\n clear:()=>{if(typeof window.clearPlan==='function')window.clearPlan();else if(typeof clearPlan==='function')clearPlan()}\n});\n";
 s=once(s,'const originalFetch=window.fetch.bind(window);','const originalFetch=window.fetch.bind(window);\n'+helpers,'helpers');
 const before='const signature=p.operations.map(x=>[';
 s=once(s,before,'if(!acceptedRunFloor.allowPreview(p))return true;\n '+before,'preview_before_paint');
 s=once(s,' manuallyStopped=false;',' acceptedRunFloor.begin();\n manuallyStopped=false;','start_snapshot');
 s=once(s,'function stop(){\n manuallyStopped=true;','function stop(){\n const restoreAccepted=active&&!completed;\n manuallyStopped=true;','stop_begin');
 s=once(s,' hideFog();detachMeter();',' hideFog();detachMeter();\n if(restoreAccepted)acceptedRunFloor.restore();else acceptedRunFloor.close();','stop_restore');
 s=once(s,'fullData=data;phase="completed";','fullData=acceptedRunFloor.final(data);phase="completed";','final_floor');
 s=once(s,'verifiedTerminal=false;completed=true;active=false;','verifiedTerminal=false;completed=true;active=false;acceptedRunFloor.close();','terminal_close');
 s=once(s,'installed:true,mode:"one-native-ga-sse-no-client-status-poll",','installed:true,mode:"one-native-ga-sse-no-client-status-poll",\n acceptedAtStart:()=>acceptedRunFloor.snapshot(),\n get acceptedFloor(){return acceptedRunFloor.stats()},','diagnostics');
 let output=source.slice(0,from)+s+source.slice(end+6);
 const old='const accepted=window.__ppFreshReferencePlan||window.__ppOptimizerCommittedPlan;';
 output=once(output,old,'const accepted=window.__ppOptimizerCommittedPlan||window.__ppFreshReferencePlan;','tab_accepted_reference');
 new vm.Script(output);
 return output;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const [d]=process.argv.slice(2);
 try{
  const name='restart-optimizer-ui.js',old=fs.readFileSync(d+'/old/'+name,'utf8'),next=patchUi(old);
  fs.mkdirSync(d+'/new',{mode:0o700});
  fs.writeFileSync(d+'/new/'+name,next,{mode:0o600});
  fs.writeFileSync(d+'/manifest.tsv',name+'\t'+sha(old)+'\t'+sha(next)+'\n',{mode:0o600});
  console.log('ACCEPTED_PLAN_EXACT_PATCH_PASS',sha(next));
 }catch(e){console.log('ACCEPTED_PLAN_PATCH_FAILED',e?.code==='ERR_ASSERTION'?String(e.message).split('\n')[0].slice(0,120):e?.name||'Error');process.exitCode=6}
}
