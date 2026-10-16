(function(){
 "use strict";
 if(window.__PP_DOCUMENTS_TAB__)return;
 const LABEL="Документы";
 const state={open:false,ready:false,actionsMoved:false};
 const get=id=>document.getElementById(id);
 function setActiveTab(target){
  const tabs=document.querySelectorAll(".top .nav span");
  tabs.forEach(x=>x.classList.toggle("a",x===target));
 }
 function revealMainIfNeeded(){
  const plan=get("planView"),section=get("sectionView");
  if(plan&&section&&plan.style.display==="none"&&section.style.display==="none"){
   plan.style.display="block";
   document.body.classList.remove("projects-mode");
  }
 }
 function hideDocuments(){
  if(!state.open)return;
  state.open=false;
  const view=get("ppDocumentsView");
  if(view)view.hidden=true;
  revealMainIfNeeded();
 }
 function moveOriginalActions(){
  const slot=get("ppDocumentsActionSlot"),importBtn=get("ppImportBtn"),templateBtn=get("ppTemplateBtn");
  if(!slot||!importBtn||!templateBtn)return false;
  const wrap=importBtn.closest(".ppi-top-actions");
  if(!wrap||!wrap.contains(templateBtn))return false;
  if(wrap.parentElement!==slot)slot.appendChild(wrap);
  // appendChild keeps original import, preview and XLSX download listeners.
  state.actionsMoved=slot.contains(importBtn)&&slot.contains(templateBtn);
  return state.actionsMoved;
 }
 function openDocuments(){
  moveOriginalActions();
  const panel=get("ppDocumentsView"),plan=get("planView"),section=get("sectionView");
  const nav=[...document.querySelectorAll(".top .nav span")].find(el=>el.textContent.trim()===LABEL);
  if(!panel||!nav)return;
  if(plan)plan.style.display="none";
  if(section)section.style.display="none";
  document.body.classList.remove("projects-mode");
  state.open=true;
  panel.hidden=false;
  setActiveTab(nav);
 }
 function openPlanning(){
  hideDocuments();
  const plan=get("planView"),section=get("sectionView");
  if(plan)plan.style.display="block";
  if(section)section.style.display="none";
  document.body.classList.remove("projects-mode");
  const nav=[...document.querySelectorAll(".top .nav span")].find(el=>el.textContent.trim()==="Планирование");
  if(nav)setActiveTab(nav);
 }
 function mount(){
  if(state.ready)return;
  const nav=[...document.querySelectorAll(".top .nav span")].find(el=>el.textContent.trim()===LABEL);
  const planner=[...document.querySelectorAll(".top .nav span")].find(el=>el.textContent.trim()==="Планирование");
  const main=document.querySelector(".shell .main");
  if(!nav||!planner||!main)return;
  const section=document.createElement("section");
  section.id="ppDocumentsView";
  section.setAttribute("aria-label",LABEL);
  section.hidden=true;
  section.innerHTML='<div class="pp-doc-head"><h1>Документы</h1><p>Шаблоны и загрузка производственных данных</p></div>'+
   '<div class="pp-doc-card"><h2>Импорт данных</h2><p>Скачайте шаблон Excel, заполните необходимые листы и загрузите файл для проверки данных перед импортом.</p><div id="ppDocumentsActionSlot"></div></div>';
  main.appendChild(section);
  nav.setAttribute("role","button");nav.tabIndex=0;nav.setAttribute("aria-controls","ppDocumentsView");
  nav.addEventListener("click",openDocuments);
  nav.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();openDocuments()}});
  planner.addEventListener("click",openPlanning);
  planner.setAttribute("role","button");planner.tabIndex=0;
  // Other existing navigation continues to own project/section routing.
  document.addEventListener("click",e=>{
   if(!state.open)return;
   const side=e.target.closest(".side .item");
   const differentNav=e.target.closest(".top .nav span");
   if(side||(differentNav&&differentNav!==nav&&differentNav!==planner))hideDocuments();
  },true);
  // For environments that install the original import controls asynchronously.
  const obs=new MutationObserver(()=>{if(!state.actionsMoved)moveOriginalActions()});
  const titlebar=document.querySelector(".titlebar");
  if(titlebar)obs.observe(titlebar,{childList:true,subtree:false});
  moveOriginalActions();
  state.ready=true;
  window.__PP_DOCUMENTS_TAB__={
   get opened(){return state.open},
   get actionsMoved(){return state.actionsMoved},
   open:openDocuments,
   planning:openPlanning
  };
 }
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount);
 else mount();
})();
