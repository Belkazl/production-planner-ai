import { readFileSync, writeFileSync } from "node:fs";

const sourcePath = "baselines/2026-10-10/aps-setup-bridge/index.ts";
let source = readFileSync(sourcePath, "utf8");

function exactly(from: string, to: string, name: string) {
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error("PP_BUILD_ANCHOR_" + name + "_" + count);
  source = source.replace(from, to);
}

// Keep the saved, verified gateway. Change only the progress indicator.
// The backend may retain success=true/percent=100 from a previous optimizer
// run, or report 100 while the POST /api/plan is still being finalized.
// Only a live running job is allowed to drive the in-flight percentage.
function ppGaStableProgressHtml(html: string) {
  const start = html.indexOf('<script id="ppRealOptProgressV1">');
  const end = html.indexOf("</script>", start);
  if (start < 0 || end <= start) throw Error("PP_GA_PROGRESS_WIDGET_MISSING");
  let part = html.slice(start, end);
  function swap(from: string, to: string, name: string) {
    const count = part.split(from).length - 1;
    if (count !== 1) throw Error("PP_PROGRESS_ANCHOR_" + name + "_" + count);
    part = part.replace(from, to);
  }
  swap("let timer=null,token=0,last=null;",
    "let timer=null,token=0,last=null,polling=false;", "poll_guard");
  swap("if(!d||!d.running)return;\n   const pct=Math.max(0,Math.min(99,Number(d.percent)||0));",
    "if(!d||!d.running)return;\n   const total=Math.max(1,Math.trunc(Number(d.total)||240));\n   const done=Math.max(0,Math.min(total,Math.trunc(Number(d.done)||0)));\n   const pct=Math.floor(done*100/total);", "iteration_accurate_percent");
  swap("last=d;", "last={...d,percent:pct};", "monotone");
  swap("btn.title=(d.phase||'Оптимизация')+' · '+Number(d.done||0)+' / '+Number(d.total||0);",
    "btn.title=(d.phase||'Оптимизация')+' · итерация '+done+' / '+total;", "iteration_tooltip");
  swap("const v=document.getElementById('valid');if(v)v.textContent='GA: '+(d.phase||'оптимизация')+' · '+pct+'%';",
    "const v=document.getElementById('valid');if(v)v.textContent='GA: '+(d.phase||'оптимизация')+' · '+done+'/'+total+' · '+pct+'%';", "iteration_badge");

  swap("async function poll(my){\n   try{",
    "async function poll(my){\n   if(polling)return;polling=true;\n   try{", "one_poll");
  swap("   }catch(e){}\n }\n function stop(){if(timer){clearInterval(timer);timer=null}}",
    "   }catch(e){}finally{polling=false}\n }\n function stop(){if(timer){clearTimeout(timer);timer=null}}", "poll_finish");
  swap("const my=++token;last=null;stop();\n   timer=setInterval(()=>poll(my),220);\n   setTimeout(()=>poll(my),20);",
    "if(btn.disabled||window.__ppOptimizationInFlight)return;\n   const my=++token;last=null;stop();let finished=false;\n   const next=async()=>{if(my!==token||finished)return;await poll(my);if(my===token&&!finished)timer=setTimeout(next,1700)};\n   timer=setTimeout(next,75);", "sequential");
  const finallyAt=part.indexOf("   try{return await original.call(this,e)}\n   finally{");
  const afterFinally=part.indexOf("\n } ;",finallyAt);
  const wrapperEnd=part.indexOf("\n };\n})();",finallyAt);
  if(finallyAt<0||wrapperEnd<0||part.indexOf("   try{return await original.call(this,e)}\n   finally{",finallyAt+1)>=0)
    throw Error("PP_PROGRESS_FINALIZER_ANCHOR");
  part=part.slice(0,finallyAt)+[
    "   try{return await original.call(this,e)}",
    "   finally{",
    "     finished=true;stop();",
    "     if(my===token){",
    "       token++;",
    "       btn.classList.remove('pp-opt-running');",
    "       btn.title='';",
    "       btn.textContent=(typeof hasResult!=='undefined'&&hasResult)?'Продолжить оптимизацию':'Запустить оптимизацию';",
    "       const v=document.getElementById('valid');",
    "       if(v&&/[0-9]+%/.test(v.textContent||''))v.textContent=(typeof hasResult!=='undefined'&&hasResult)?'GA: расчёт завершён':'GA: расчёт остановлен';",
    "     }",
    "   }"
  ].join("\n")+part.slice(wrapperEnd);
  if (part.includes("success===true?100") || part.includes("Оптимизация 100% · завершаю"))
    throw Error("PP_PREMATURE_100_NOT_ELIMINATED");
  return html.slice(0, start) + part + html.slice(end);
}

exactly('const REV="setups-bridge-20261010-objective-v1";',
        'const REV="setups-bridge-20261010-progress-safe-v2";', "revision");
exactly("async function serveGanttUi(req){",
  ppGaStableProgressHtml.toString() + "\nasync function serveGanttUi(req){", "add_widget_patch");
exactly("const ppKpiHtml=ppKpiPreview?ppKpiBaselineHtml(ppPollHtml):ppPollHtml;if(!pp3Html.includes(",
  "const ppKpiHtml=ppKpiPreview?ppKpiBaselineHtml(ppPollHtml):ppPollHtml;const ppGaPollPreview=new URL(req.url).searchParams.get('ppGaPoll')!=='off';const ppGaPollHtml=ppGaPollPreview?ppGaStableProgressHtml(ppKpiHtml):ppKpiHtml;if(!pp3Html.includes(", "enable_widget");
exactly("return new Response(ppKpiHtml.replace('</body>'",
        "return new Response(ppGaPollHtml.replace('</body>'", "final_html");
if (!source.includes("ppProgressThrottle") || !source.includes("guardRepairedProjectStorage") ||
    !source.includes("searchWithSetup")) throw new Error("PP_CORE_INVARIANT");
writeFileSync("index.ts", source);
console.log("PP_PROGRESS_FIX_BUILD_OK", JSON.stringify({
  sourceBytes: source.length, revision: "setups-bridge-20261010-progress-safe-v2",
  setupPreserved: true, storageGuardPreserved: true,
  status: "progress=done/total, 240-iteration accurate, race-free button reset"
}));
