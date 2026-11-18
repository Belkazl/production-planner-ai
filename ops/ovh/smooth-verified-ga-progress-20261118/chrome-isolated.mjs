import {chromium} from "playwright-core";
import {readFileSync} from "node:fs";
import assert from "node:assert/strict";
const addon=readFileSync(new URL("./runtime.js",import.meta.url),"utf8");
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox"]});
const page=await browser.newPage();
try{
 await page.setContent('<!doctype html><html lang="en"><head></head><body><button id="opt" class="pp-opt-running">Optimization 10%<span class="pp-opt-progress-line" style="width:10%"></span></button></body></html>');
 await page.addScriptTag({content:addon});
 const initial=await page.evaluate(()=>window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__.state);
 assert.equal(initial.active,true);
 assert.equal(initial.displayed,10);
 await page.evaluate(()=>{
  const btn=document.getElementById("opt");
  window.__qaPctLog=[];
  new MutationObserver(()=>{
   const match=/(\d{1,3})%/.exec(btn.textContent);
   if(match&&Number(match[1])!==window.__qaPctLog.at(-1))
    window.__qaPctLog.push(Number(match[1]));
  }).observe(btn,{subtree:true,childList:true,characterData:true});
  btn.textContent="Optimization 20%";
  const bar=document.createElement("span");
  bar.className="pp-opt-progress-line";
  bar.style.width="20%";
  btn.appendChild(bar);
  window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__.refresh();
 });
 const first=await page.evaluate(()=>window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__.state);
 assert.equal(first.confirmed,20);
 assert.equal(first.displayed,10,"must not leap ahead of displayed progress");
 await page.waitForFunction(()=>window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__.state.displayed===20,null,{timeout:4000});
 const result=await page.evaluate(()=>({
  state:window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__.state,
  sequence:window.__qaPctLog,
  label:document.getElementById("opt").textContent,
  bar:document.querySelector("#opt .pp-opt-progress-line").style.width
 }));
 console.log("GA_ISOLATED_CHROME_ONE_PERCENT_SEQUENCE",JSON.stringify(result));
 for(let n=11;n<=20;n++)assert(result.sequence.includes(n),"verified intermediate step "+n);
 assert.equal(result.bar,"20%");
 assert.equal(result.label,"Optimization 20%");
 await page.evaluate(()=>{
  const btn=document.getElementById("opt");
  btn.classList.remove("pp-opt-running");
  btn.textContent="Continue optimization";
  window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__.refresh();
 });
 let state=await page.evaluate(()=>window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__.state);
 assert.equal(state.active,false);
 assert.equal(state.confirmed,0);
 await page.reload({waitUntil:"domcontentloaded"});
 await page.setContent('<!doctype html><html lang="en"><head></head><body><button id="opt" class="pp-opt-running">Optimization 47%</button></body></html>');
 await page.addScriptTag({content:addon});
 state=await page.evaluate(()=>window.__PP_SMOOTH_VERIFIED_PROGRESS_V1__.state);
 assert.equal(state.displayed,47);
 assert.equal(state.confirmed,47);
 console.log("GA_ISOLATED_CHROME_STOP_RECONNECT_PASS");
 console.log("GA_ISOLATED_CHROME_ALL_PASS");
}catch(err){
 console.log("GA_ISOLATED_CHROME_FAIL",String(err.stack||err).slice(0,1700));
 process.exitCode=1;
}finally{await browser.close()}