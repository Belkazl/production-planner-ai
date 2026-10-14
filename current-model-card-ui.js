(function(){
 "use strict";
 if(window.__PP_CURRENT_MODEL_CARD_UI__)return;
 // Presentation-only: keep source data and DOM nodes for legacy readers.
 const TITLE="Текущая модель";
 let hiddenCard=null;
 let scheduled=false;
 function findCard(){
  if(!document.body)return null;
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  let textNode;
  while((textNode=walker.nextNode())){
   if(String(textNode.nodeValue||"").replace(/\s+/g," ").trim()!==TITLE)continue;
   if(textNode.parentElement?.closest('[data-pp-current-model-hidden="1"]'))continue;
   let el=textNode.parentElement;
   for(let depth=0;depth<8&&el&&el!==document.body;depth++,el=el.parentElement){
    const text=String(el.textContent||"");
    // Match the entire compact model summary, not a chat message or the assistant panel.
    if(text.length>900)break;
    if(!/сотрудник/i.test(text)||!/заказ/i.test(text)||!/старт/i.test(text)||
       !/(автоклав|оборудован|станк|машин)/i.test(text))continue;
    if(el.querySelector("#planView,#sectionView,#ppDocumentsView,#ppProtectedAccount"))break;
    return el;
   }
  }
  return null;
 }
 function scan(){
  let changed=false;
  for(let i=0;i<8;i++){
   const el=findCard();
   if(!el)break;
   el.dataset.ppCurrentModelHidden="1";
   el.style.setProperty("display","none","important");
   hiddenCard=el;
   changed=true;
  }
  return changed||!!(hiddenCard&&hiddenCard.isConnected);
 }
 function queueScan(changes){
  if(hiddenCard&&hiddenCard.isConnected){
   // Re-scan only if a newly inserted DOM subtree contains another model card.
   const hasNewTitle=changes.some(change=>[...change.addedNodes].some(n=>
    n.nodeType===3?String(n.nodeValue||"").includes(TITLE):
    n.nodeType===1?String(n.textContent||"").includes(TITLE):false));
   if(!hasNewTitle)return;
  }
  if(scheduled)return;
  scheduled=true;
  requestAnimationFrame(()=>{scheduled=false;scan()});
 }
 function start(){
  scan();
  const observer=new MutationObserver(queueScan);
  observer.observe(document.body,{childList:true,subtree:true});
 }
 window.__PP_CURRENT_MODEL_CARD_UI__={
  scan,
  get hidden(){return !!(hiddenCard&&hiddenCard.isConnected&&getComputedStyle(hiddenCard).display==="none")}
 };
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});
 else start();
})();
