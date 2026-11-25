import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const BEFORE=String.raw`            const live=data.candidate_preview,stored=data.best_preview;
            const useBest=setupRows(live)===0&&setupRows(stored)>0;
            const source=useBest?"best":live?"candidate":"best";
            const candidate=boundedPreview(useBest?stored:(live||stored),model);`;
const AFTER=String.raw`            // pp_integrated_setup_best_preview_v1: the main Gantt and its KPI
            // cards show one complete incumbent chosen by the native solver.
            // A tentative search candidate may be slower or use a different
            // setup sequence. It must not replace the best plan on screen.
            // Both the clipped rows and the full-plan metrics come from this
            // same account-scoped best; never splice in another plan's setups.
            const source="best";
            const stored=data.best_preview;
            const candidate=stored?.valid===true&&stored.partial!==true?
              boundedPreview(stored,model):null;`;
const MARKER='pp_integrated_setup_best_preview_v1';

export function patchPreview(source){
  for(const guard of ['async function progress(req, expectedJob=null)',
    'await progress(req,job)', 'data.job_id!==job.id',
    'candidate._pp_preview_origin=source;', '_pp_preview_kpis:metrics',
    'firstPreviewPending', 'const boundedPreview = (plan,model)',
    'previewTimer=setInterval(()=>{void sendPreview()},4000);']){
    if(!source.includes(guard))throw Error('INTEGRATED_PREVIEW_REQUIRED_GUARD_'+guard);
  }
  if(source.includes(MARKER)){
    if(source.split(AFTER).length!==2||source.includes(BEFORE))
      throw Error('INTEGRATED_PREVIEW_INSTALLED_DRIFT');
    return source;
  }
  if(source.split(BEFORE).length!==2)throw Error('INTEGRATED_PREVIEW_SELECTION_DRIFT');
  const output=source.replace(BEFORE,AFTER);
  if(output.replace(AFTER,BEFORE)!==source)throw Error('INTEGRATED_PREVIEW_UNRELATED_CHANGE');
  return output;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==4)throw Error('INTEGRATED_PREVIEW_PATHS_REQUIRED');
  const source=readFileSync(process.argv[2],'utf8');
  const output=patchPreview(source);
  writeFileSync(process.argv[3],output);
  console.log('INTEGRATED_PREVIEW_PATCH_PASS',JSON.stringify({changed:source!==output}));
}
