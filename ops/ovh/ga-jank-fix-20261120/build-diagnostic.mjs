import {readFileSync,writeFileSync} from "node:fs";
const p="ops/ovh/ga-start-recover-20261119/live-regression.mjs";
const orig=readFileSync(p,"utf8");
let src=orig;
function once(a,b,label){if(src.split(a).length!==2)throw Error("QA_ANCHOR_"+label);src=src.replace(a,b)}
const instrumentation=String.raw`
  await page.evaluate(()=>{
    window.__ppJankQA={renders:[],timer:[],start:performance.now()};
    const original=window.renderPlan;
    if(typeof original==="function")window.renderPlan=function(){
      const stamp=performance.now();
      try{return original.apply(this,arguments)}
      finally{window.__ppJankQA.renders.push({at:Math.round(stamp),ms:Math.round(performance.now()-stamp),
        operations:arguments[0]?.operations?.length||0})}
    };
    let previous=performance.now();
    setInterval(()=>{
      const t=performance.now();
      window.__ppJankQA.timer.push(Math.round(t-previous-250));
      previous=t;
    },250);
  });
`;
const first='  const beforeModel=await page.evaluate(async()=>{';
once(first,instrumentation+first,"before_model");
const replacement=String.raw`
  await page.waitForTimeout(31000);
  const d=await page.evaluate(()=>{
    const qa=window.__ppJankQA;
    const stage=document.getElementById("ppGanttToolV2");
    const scroll=document.getElementById("ganttScroll");
    const rr=[...document.querySelectorAll(".pg2-row")].slice(0,3).map(x=>({
      tag:x.tagName,klass:x.className,text:x.textContent?.slice(0,65),
      outer:x.outerHTML.slice(0,750),height:Math.round(x.getBoundingClientRect().height)
    }));
    const bars=[...document.querySelectorAll(".pg2-bar")].slice(0,2).map(x=>({
      outer:x.outerHTML.slice(0,850),x:Math.round(x.getBoundingClientRect().x)
    }));
    const rs=performance.getEntriesByType("resource").filter(x=>x.name.includes("ga-candidate-snapshot")).map(x=>({
      at:Math.round(x.startTime),duration:Math.round(x.duration),size:x.transferSize||0
    }));
    const probe=window.__PP_FOUR_SECOND_PREVIEW__?.state||null;
    const task=window.__freezeProbe||null;
    return{preview:probe,task,renders:qa?.renders||null,
      timerGapMax:Math.max(0,...(qa?.timer||[])),
      largeGapCount:(qa?.timer||[]).filter(x=>x>1500).length,
      network:rs,stage:stage&&{tag:stage.tagName,klass:stage.className,
      parent:stage.parentElement?.id,html:stage.outerHTML.slice(0,550)},
      scroll:scroll&&{tag:scroll.tagName,klass:scroll.className,
      rect:{w:scroll.clientWidth,h:scroll.clientHeight},children:scroll.children.length},
      rows:rr,bars,overallBarCount:document.querySelectorAll(".pg2-bar").length};
  });
  console.log("JANK_DIAG_CAPTURE",JSON.stringify(d));
  await browser.close();process.exit(0);
`;
once('  const epochs=Date.now();',replacement+'  const epochs=Date.now();',"start_poll");
writeFileSync("ops/ovh/ga-jank-fix-20261120/_diagnostic.mjs",src);
console.log("JANK_DIAG_GENERATED");
