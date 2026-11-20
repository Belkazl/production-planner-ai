const {chromium}=require("playwright-core");
const assert=require("node:assert/strict");
const fs=require("node:fs");
(async()=>{
 const browser=await chromium.launch({headless:true,
  executablePath:process.env.CHROME_PATH||"/usr/bin/google-chrome",
  args:["--no-sandbox","--disable-dev-shm-usage"]});
 try{
  const page=await browser.newPage();
  await page.setContent(`<!doctype html><html lang="en"><body>
  <main id="planView"><div class="toolbar">
    <label id="depth">Optimization depth
      <select><option>Thorough</option></select>
    </label>
    <div id="ppLivePreview"><button data-mode="best">Best found</button>
      <button data-mode="candidate">Candidate plan</button></div>
    <button id="opt">Continue · 100%</button>
  </div>
  <div id="ppOptimizerCandidateStatus" style="display:block;padding:8px 12px">
    GA time limit reached. The best independently validated plan was preserved.
  </div>
  <section id="ppGanttToolV2">Equipment utilization</section>
  </main></body></html>`);
  const before=await page.evaluate(()=>[...document.querySelectorAll("#ppLivePreview,#ppOptimizerCandidateStatus")]
   .map(e=>getComputedStyle(e).display));
  assert.deepEqual(before,["block","block"],"Test must begin with the screenshot's obsolete UI visible");
  await page.addScriptTag({content:fs.readFileSync("ops/ovh/clean-obsolete-ga-controls-20261120/addon.js.txt","utf8")});
  const state=await page.evaluate(()=>({
   injected:window.__PP_HIDE_OBSOLETE_GA_WIDGETS_V1__?.installed,
   switcher:getComputedStyle(document.getElementById("ppLivePreview")).display,
   notice:getComputedStyle(document.getElementById("ppOptimizerCandidateStatus")).display,
   best:getComputedStyle(document.querySelector('[data-mode="best"]')).display,
   candidate:getComputedStyle(document.querySelector('[data-mode="candidate"]')).display,
   depth:getComputedStyle(document.getElementById("depth")).display,
   gantt:getComputedStyle(document.getElementById("ppGanttToolV2")).display,
   optimize:getComputedStyle(document.getElementById("opt")).display
  }));
  assert.equal(state.injected,true);
  for(const key of ["switcher","notice","best","candidate"])assert.equal(state[key],"none",key);
  for(const key of ["depth","gantt","optimize"])assert.notEqual(state[key],"none",key);
  await page.evaluate(()=>{
    // Legacy bridge creates/shows this notification again after a time-limit result.
    const notice=document.getElementById("ppOptimizerCandidateStatus");
    notice.style.display="block";
    const old=document.getElementById("ppLivePreview");old.remove();
    const widget=document.createElement("div");widget.id="ppLivePreview";
    widget.innerHTML='<button data-mode="best">Best found</button><button data-mode="candidate">Candidate plan</button>';
    document.querySelector("#planView .toolbar").appendChild(widget);
  });
  const after=await page.evaluate(()=>({
   notice:getComputedStyle(document.getElementById("ppOptimizerCandidateStatus")).display,
   replacement:getComputedStyle(document.getElementById("ppLivePreview")).display,
   depth:getComputedStyle(document.getElementById("depth")).display
  }));
  assert.equal(after.notice,"none","Inline display:block must never resurrect retired banner");
  assert.equal(after.replacement,"none","CSS must cover dynamic toolbar render");
  assert.notEqual(after.depth,"none","Depth selector must survive");
  console.log("GA_UI_HIDE_BEST_CANDIDATE_AND_RETIRED_TIMEOUT_BANNER_BROWSER_PASS",JSON.stringify({state,after}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
