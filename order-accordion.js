(function(){
"use strict";
if(window.__PP_ORDER_PARAMS_ACCORDION_V1__?.installed)return;
const VERSION="2026-10-13.1";
let uid=0;
let queued=false;
function plural(n){
 const a=n%10,b=n%100;
 return n+" "+(b>=11&&b<=14?"параметров":a===1?"параметр":a>=2&&a<=4?"параметра":"параметров");
}
function prepareRow(row){
 const cell=row.querySelector("td.pp-oparam-cell");
 const list=cell?.querySelector("[data-oparam-list]");
 const add=cell?.querySelector("[data-padd]");
 if(!cell||!list||!add)return false;
 if(cell.dataset.ppOrderAccordion==="1")return false;
 const button=document.createElement("button");
 button.type="button";
 button.className="pp-order-param-toggle";
 button.setAttribute("data-pp-order-toggle","");
 button.setAttribute("aria-expanded","false");
 const orderValue=row.querySelector("[data-oid]")?.value||"";
 button.setAttribute("aria-label","Производственные параметры заказа "+orderValue);
 const listId="ppOrderParamsList_"+(++uid);
 list.id=listId;
 button.setAttribute("aria-controls",listId);
 const label=document.createElement("span");
 label.textContent="Производственные параметры";
 const count=document.createElement("span");
 count.className="pp-order-param-count";
 count.setAttribute("data-pp-param-count","");
 const arrow=document.createElement("span");
 arrow.className="pp-order-param-chevron";
 arrow.setAttribute("aria-hidden","true");
 button.append(label,count,arrow);
 cell.insertBefore(button,cell.firstChild);
 cell.dataset.ppOrderAccordion="1";
 cell.dataset.ppExpanded="false";
 button.addEventListener("click",()=>{
  const expanded=cell.dataset.ppExpanded!=="true";
  cell.dataset.ppExpanded=expanded?"true":"false";
  button.setAttribute("aria-expanded",expanded?"true":"false");
  if(expanded){const first=list.querySelector("[data-pkey]");if(first && !list.querySelector("[data-pkey]:focus")){}}
 });
 return true;
}
function updateCounter(cell){
 const count=cell.querySelector("[data-pp-param-count]");
 if(!count)return;
 const n=cell.querySelectorAll("[data-oparam-list] > [data-oparam-pair]").length;
 const result=plural(n);
 if(count.textContent!==result)count.textContent=result;
}
function apply(){
 if(!document.querySelector("#ppOrderParamBody"))return 0;
 const rows=[...document.querySelectorAll("#ppOrderParamBody > tr[data-oparam-order]")];
 for(const row of rows){
  prepareRow(row);
  const cell=row.querySelector("td.pp-oparam-cell");
  if(cell)updateCounter(cell);
 }
 return rows.length;
}
function schedule(){
 if(queued)return;queued=true;
 requestAnimationFrame(()=>{queued=false;apply()});
}
const root=document.querySelector("#sectionView")||document.body;
const observer=new MutationObserver(records=>{
 for(const m of records){
  if(m.type==="childList"){schedule();break;}
 }
});
observer.observe(root,{subtree:true,childList:true});
document.addEventListener("click",event=>{
 if(event.target.closest?.("[data-order-add],[data-padd],[data-pdel]"))schedule();
});
window.__PP_ORDER_PARAMS_ACCORDION_V1__={
 installed:true,version:VERSION,
 get visibleOrders(){return document.querySelectorAll("#ppOrderParamBody>tr[data-oparam-order]").length},
 get collapsed(){return document.querySelectorAll("#ppOrderParamBody .pp-oparam-cell[data-pp-expanded=false]").length},
 apply
};
apply();
console.log("PP_ORDER_ACCORDION_READY",VERSION);
})();