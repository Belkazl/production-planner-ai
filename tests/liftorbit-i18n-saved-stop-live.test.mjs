import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {JSDOM} from "jsdom";

const code=readFileSync("language-ui.js","utf8");
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
function mount() {
 const html=String.raw`<!doctype html><html lang="ru"><head></head><body>
 <div id="ppProtectedAccount"><button>Выйти</button></div>
 <button id="saved">Сохранённые планы (6)</button>
 <div id="savedModal" role="dialog">
  <strong id="savedName">План 15.10.2026 07:44</strong>
  <div id="savedSummary">15.10.2026, 07:44 · 4338 min · 118 партий · переналадки 1335 мин</div>
  <div id="savedChanges">Условия изменились: оборудование</div>
  <div id="savedChangesFull">Условия изменились: старт, заказы, техпроцесс, оборудование, сотрудники/смены, материалы, переналадки</div>
  <button id="savedOpen">Открыть</button><button id="savedContinue">Продолжить оптимизацию</button><button id="savedDelete">Удалить</button>
 </div>
 <div id="validator">Остановлено пользователем. Выбранный план показан на Ганте и пока не сохранён.</div>
 <div id="preview">Лучший найденный: 4409 мин · временный просмотр, не сохранён</div>
 <div id="previewUpper">Лучший найденный: 4389 мин · Временный просмотр, не сохранён</div>
 <div id="ganttHead">Занятость автоклавов</div>
 <span id="projectName">Керамика</span>
 <div id="sourceModel" data-order="Заказ тест"></div>
 <textarea id="userInput">Условия для клиента</textarea>
 </body></html>`;
 const dom=new JSDOM(html,{url:"https://app.liftorbit.app/",runScripts:"outside-only",pretendToBeVisual:true});
 dom.window.eval(code);
 dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
 const w=dom.window;
 const el=id=>w.document.getElementById(id);
 return {dom,w,el,close:()=>dom.window.close()};
}
const expected=[
 ["savedName","Plan 15.10.2026 07:44"],
 ["savedSummary","15.10.2026, 07:44 · 4338 min · 118 batches · setups 1335 min"],
 ["savedChanges","Conditions changed: equipment"],
 ["savedChangesFull","Conditions changed: start date, orders, production process, equipment, employees / shifts, materials, setup rules"],
 ["savedOpen","Open"],
 ["savedContinue","Continue optimization"],
 ["savedDelete","Delete"],
 ["validator","Stopped by user. The selected plan is shown on the Gantt chart and has not been saved yet."],
 ["preview","Best found: 4409 min · Temporary preview, not saved"],
 ["previewUpper","Best found: 4389 min · Temporary preview, not saved"],
 ["ganttHead","Equipment utilization"],
 ["projectName","Керамика"]
];
test("English dynamically rendered Saved plans, warnings, stop validator and Best found are translated",()=>{
 const q=mount();
 try{
  q.w.__PP_LANGUAGE__.set("en");
  for(const [id,want] of expected)assert.equal(q.el(id).textContent.trim(),want,id);
  assert.equal(q.el("userInput").value,"Условия для клиента","user-authored text is untouched");
  assert.equal(q.el("sourceModel").dataset.order,"Заказ тест","model data attributes untouched");
  assert.equal(q.w.__PP_LANGUAGE__.current,"en");
  assert.equal(q.w.document.documentElement.lang,"en");
  assert.equal(q.w.__PP_LANGUAGE__.translate("Условия изменились: оборудование"),"Conditions changed: equipment");
  console.log("PP_I18N_SAVED_PLANS_AND_STOP_ENGLISH_PASS");
 }finally{q.close()}
});
test("RU -> EN -> RU preserves every original UI string and all project data",()=>{
 const q=mount();
 try{
  q.w.__PP_LANGUAGE__.set("ru");
  const initial=new Map(expected.map(([id])=>[id,q.el(id).textContent.trim()]));
  q.w.__PP_LANGUAGE__.set("en");
  q.w.__PP_LANGUAGE__.set("ru");
  for(const [id,old] of initial)assert.equal(q.el(id).textContent.trim(),old,id);
  assert.equal(q.el("projectName").textContent,"Керамика");
  assert.equal(q.el("userInput").value,"Условия для клиента");
  console.log("PP_I18N_SAVED_PLANS_ROUNDTRIP_PASS");
 }finally{q.close()}
});
test("new Saved plans and a changed GA preview translate automatically while English is already selected",async()=>{
 const q=mount();
 try{
  q.w.__PP_LANGUAGE__.set("en");
  const newRow=q.w.document.createElement("div");newRow.id="lateSavedRow";
  newRow.innerHTML='<strong>План 13.10.2026 18:58</strong><span>13.10.2026, 18:58 · 4336 min · 118 партий · переналадки 1695 мин</span><em>Условия изменились: техпроцесс, оборудование, материалы</em><button>Открыть</button>';
  q.el("savedModal").appendChild(newRow);
  q.el("validator").textContent="Остановлено пользователем. Выбранный план показан на Ганте и пока не сохранён.";
  q.el("preview").textContent="Лучший найденный: 4422 мин · временный просмотр, не сохранён";
  await sleep(120);
  assert.equal(newRow.querySelector("strong").textContent,"Plan 13.10.2026 18:58");
  assert.equal(newRow.querySelector("span").textContent,"13.10.2026, 18:58 · 4336 min · 118 batches · setups 1695 min");
  assert.equal(newRow.querySelector("em").textContent,"Conditions changed: production process, equipment, materials");
  assert.equal(newRow.querySelector("button").textContent,"Open");
  assert.equal(q.el("preview").textContent,"Best found: 4422 min · Temporary preview, not saved");
  assert.equal(q.el("validator").textContent,expected.find(x=>x[0]==="validator")[1]);
  assert.equal(q.el("projectName").textContent,"Керамика");
  console.log("PP_I18N_DYNAMIC_MUTATION_AUTO_TRANSLATE_PASS");
 }finally{q.close()}
});
