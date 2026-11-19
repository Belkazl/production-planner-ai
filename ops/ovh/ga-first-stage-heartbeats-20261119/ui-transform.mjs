// Extend only the single installed V5 progress owner; no extra overlay element.
export function patchInitialStageUiV6(source){
 let result=source;
 function once(from,to,id){
  const count=result.split(from).length-1;
  if(count!==1)throw Error("GA_FIRST_STAGE_UI_SOURCE_DRIFT_"+id+"_"+count);
  result=result.replace(from,to);
 }
 once(
  "let updates=0,busyCount=0,finalCount=0,verifiedCount=0,has100=false;",
  "let updates=0,busyCount=0,finalCount=0,verifiedCount=0,has100=false;\n"+
  "let firstStage='',firstStageSince=0,firstStageLastSecond=-1,firstStagePaints=0,serverStageEvents=0;\n"+
  "const firstStageLabels={\n"+
  " queued:['Ожидание запуска','Waiting to start'],\n"+
  " loading_runtime:['Подготовка расчёта','Preparing calculation'],\n"+
  " validating_model:['Проверка модели','Validating model'],\n"+
  " installing_model:['Подготовка ресурсов','Preparing resources'],\n"+
  " building_first_plan:['Формирование первого плана','Building the first plan'],\n"+
  " optimizing:['Поиск лучшего плана','Optimizing candidate plans'],\n"+
  " finalizing:['Проверка результата','Finalizing schedule']\n"+
  "};",
  "STATE_VARS"
 );
 once(
  'const active=()=>!!button?.classList.contains("pp-opt-running");',
  'const active=()=>!!button?.classList.contains("pp-opt-running")&&!isContinue();',
  "NATIVE_CONTINUE_BEFORE_CSS_CLASS_REMOVED"
 );
 once(
  "function begin(){\n reset();wasRunning=true;lastNativeAt=Date.now();",
  "function begin(){\n reset();wasRunning=true;lastNativeAt=Date.now();firstStageSince=Date.now();",
  "BEGIN_CLOCK"
 );
 once(
  ' prefix="";attempts=0;initialChecked=false;has100=false;',
  ' prefix="";attempts=0;initialChecked=false;has100=false;\n firstStage="";firstStageSince=0;firstStageLastSecond=-1;',
  "RESET_STAGE"
 );
 once(
  "function handleNativeNumber(){",
  "function showVerifiedPreparationStage(){\n"+
  " if(!wasRunning||!active()||finishing||finalDone||!button?.isConnected||confirmed>1)return;\n"+
  " const labels=firstStageLabels[firstStage];if(!labels)return;\n"+
  " if(!firstStageSince)firstStageSince=Date.now();\n"+
  " const sec=Math.max(0,Math.floor((Date.now()-firstStageSince)/1000));\n"+
  " if(sec===firstStageLastSecond&&button.classList.contains('pp-ga-v4-busy'))return;\n"+
  " firstStageLastSecond=sec;\n"+
  " const clock=String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');\n"+
  " button.classList.add('pp-ga-v4-busy');\n"+
  " button.setAttribute('data-pp-ga-v4-label',(isRu()?labels[0]:labels[1])+' · '+clock);\n"+
  " firstStagePaints++;\n"+
  "}\n"+
  "function handleNativeNumber(){",
  "STAGE_PAINT"
 );
 once(
  " const pct=clamp(Number.parseInt(match[0],10));",
  " const pct=clamp(Number.parseInt(match[0],10));\n if(pct>1)firstStage='';",
  "FIRST_REAL_GA_PROGRESS"
 );
 once(
  " if(!button||!active()||!wasRunning||shown==null)return;\n const t=Date.now();",
  " if(!button||!active()||!wasRunning||shown==null)return;\n"+
  " // A first candidate is under construction while the native GA is at 1%.\n"+
  " // Do not invent more percentages if stage headers are delayed by the proxy.\n"+
  " if(!firstStage&&confirmed<=1&&Date.now()-lastNativeAt>=1500){\n"+
  "  firstStage='building_first_plan';firstStageSince=Date.now();firstStageLastSecond=-1;\n"+
  " }\n"+
  " if(firstStage&&confirmed<=1){showVerifiedPreparationStage();return}\n"+
  " const t=Date.now();",
  "POLL_EARLY"
 );
 once(
  "window.addEventListener(\"pp:optimizer-started\",()=>{",
  "// Listen only to the response header of the authenticated worker progress GET.\n"+
  "// No large JSON plan parsing and no artificial progress advancement.\n"+
  "const ppFirstStageFetch=window.fetch.bind(window);\n"+
  "window.fetch=async function ppFirstStageFetchV6(input,init){\n"+
  " const r=await ppFirstStageFetch(input,init);\n"+
  " try{\n"+
  "  const url=new URL(typeof input==='string'?input:input?.url,location.href);\n"+
  "  const method=String(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();\n"+
  "  if(r.ok&&method==='GET'&&url.origin===location.origin&&url.pathname==='/api/plan-progress'){\n"+
  "   const incoming=r.headers.get('x-liftorbit-ga-stage');\n"+
  "   if(Object.prototype.hasOwnProperty.call(firstStageLabels,incoming)&&active()&&wasRunning){\n"+
  "    if(firstStage!==incoming){firstStage=incoming;firstStageLastSecond=-1}\n"+
  "    showVerifiedPreparationStage();\n"+
  "   }\n"+
  "  }\n"+
  " }catch(_){}\n"+
  " return r;\n"+
  "};\n"+
  "window.addEventListener('pp:ga-server-stage',event=>{\n"+
  " const incoming=event.detail;\n"+
  " if(Object.prototype.hasOwnProperty.call(firstStageLabels,incoming)&&active()&&wasRunning&&confirmed<=1){\n"+
  "  serverStageEvents++;\n"+
  "  if(firstStage!==incoming){firstStage=incoming;firstStageLastSecond=-1}\n"+
  "  showVerifiedPreparationStage();\n"+
  " }\n"+
  "});\n"+
  "window.addEventListener(\"pp:optimizer-started\",()=>{",
  "FETCH_STAGE_HEADER"
 );
 once(
  "  finishing,finalDone,finalCount,has100,verifiedCount,attempts,\n  visible:",
  "  finishing,finalDone,finalCount,has100,verifiedCount,attempts,\n"+
  "  firstStage,firstStagePaints,serverStageEvents,\n  visible:",
  "STATE_DIAGNOSTICS"
 );
 for(const marker of ["ppNativeOneOwnerProgressV4","showVerifiedPreparationStage()",
  "x-liftorbit-ga-stage","firstStagePaints","pp-ga-v4-final"]){
  if(!result.includes(marker))throw Error("GA_FIRST_STAGE_UI_REQUIRED_"+marker);
 }
 return result;
}
