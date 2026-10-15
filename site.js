"use strict";
(function(){
const APP_URL="https://production-planner-gateway-v2-production.up.railway.app/";
const menuButton=document.querySelector(".menu-toggle");
const navigation=document.querySelector(".main-nav");
if(menuButton&&navigation){
 const closeMenu=function(){navigation.classList.remove("open");menuButton.setAttribute("aria-expanded","false");menuButton.setAttribute("aria-label","Open navigation");};
 menuButton.addEventListener("click",function(){
  const open=menuButton.getAttribute("aria-expanded")!=="true";
  navigation.classList.toggle("open",open);
  menuButton.setAttribute("aria-expanded",String(open));
  menuButton.setAttribute("aria-label",open?"Close navigation":"Open navigation");
 });
 navigation.querySelectorAll("a").forEach(function(a){a.addEventListener("click",closeMenu);});
 document.addEventListener("keydown",function(e){if(e.key==="Escape")closeMenu();});
}
const dialog=document.getElementById("trial-dialog");
document.querySelectorAll("[data-trial-trigger]").forEach(function(button){
 button.addEventListener("click",function(){if(!dialog)return;if(typeof dialog.showModal==="function")dialog.showModal();else dialog.setAttribute("open","");});
});
if(dialog){
 dialog.addEventListener("click",function(e){if(e.target===dialog)dialog.close();});
 dialog.querySelectorAll('a[href="'+APP_URL+'"]').forEach(function(a){a.addEventListener("click",function(){dialog.close();});});
}
const year=document.getElementById("year");if(year)year.textContent=String(new Date().getFullYear());
const data={
 equipment:{
  title:"Equipment utilization",desc:"The entire manufacturing process, line by line.",
  rows:[
   ["SACMI PH3800","Pressing",[[4,19,"cyan"],[26,7,"dark"],[36,20,"rose"],[65,16,"gold"]]],
   ["SACMI PH5000","Pressing",[[10,22,"gold"],[40,18,"cyan"],[67,21,"rose"]]],
   ["E7P","Drying",[[12,27,"rose"],[46,26,"cyan"],[76,16,"gold"]]],
   ["VELA FC","Glazing",[[7,20,"cyan"],[34,5,"dark"],[45,22,"rose"],[76,13,"gold"]]],
   ["MAESTRO EMA","Firing",[[17,27,"gold"],[49,27,"cyan"],[81,14,"rose"]]],
   ["FASTWRAP","Packaging",[[9,16,"rose"],[35,23,"gold"],[68,20,"cyan"]]]
  ],
  legend:[["Production","cyan-bg"],["Processing","rose-bg"],["Next operation","gold-bg"],["Setup","dark-bg"]]
 },
 materials:{
  title:"Material availability",desc:"Stock, deliveries and consumption alongside the schedule.",
  rows:[
   ["Body powder","185,000 kg in stock",[[5,16,"gold"],[30,4,"cyan"],[40,18,"rose"],[66,18,"gold"]]],
   ["Engobe","8,000 kg in stock",[[14,22,"rose"],[48,5,"cyan"],[58,21,"gold"]]],
   ["Base glaze","9,000 kg in stock",[[3,19,"gold"],[32,18,"rose"],[62,5,"cyan"],[77,13,"rose"]]],
   ["Digital ink","400 kg in stock",[[10,22,"rose"],[43,5,"cyan"],[55,23,"gold"]]],
   ["Tile cartons","10,000 pcs in stock",[[17,19,"gold"],[47,5,"cyan"],[62,20,"rose"]]],
   ["Pallets","250 pcs in stock",[[13,23,"rose"],[52,4,"cyan"],[62,20,"gold"]]]
  ],
  legend:[["Planned usage","rose-bg"],["More usage","gold-bg"],["Delivery","cyan-bg"]]
 },
 orders:{
  title:"Order progress",desc:"Follow how each order moves through the production process.",
  rows:[
   ["Order #2607","Ceramic tiles",[[5,13,"cyan"],[24,16,"gold"],[50,19,"rose"],[77,13,"cyan"]]],
   ["Order #2608","Ceramic tiles",[[13,15,"rose"],[34,21,"gold"],[63,19,"cyan"]]],
   ["Order #2609","Ceramic tiles",[[5,24,"gold"],[36,22,"cyan"],[69,17,"rose"]]],
   ["Order #2610","Ceramic tiles",[[8,20,"cyan"],[35,6,"dark"],[50,18,"rose"],[76,14,"gold"]]],
   ["Order #2611","Ceramic tiles",[[3,17,"gold"],[28,24,"rose"],[62,19,"cyan"]]],
   ["Order #2612","Ceramic tiles",[[19,17,"rose"],[44,26,"cyan"],[75,15,"gold"]]]
  ],
  legend:[["Operation","cyan-bg"],["Processing","rose-bg"],["Next operation","gold-bg"],["Changeover","dark-bg"]]
 }
};
const fullRows=document.getElementById("full-rows");
const showcaseTitle=document.getElementById("showcase-title");
const showcaseDesc=document.getElementById("showcase-desc");
const legend=document.querySelector(".showcase-legend");
const tabs=document.querySelectorAll("[data-schedule-tab]");
const switches=document.querySelectorAll("[data-mode-choice]");
let currentTab="equipment",currentMode="optimized";
function shapeBars(row,i,mode){
 const bars=row[2],track=document.createElement("div");track.className="full-track";
 bars.forEach(function(x,j){
  const b=document.createElement("span");b.className="full-bar "+x[2];
  const left=mode==="initial"?Math.min(90,x[0]+(j===0?2:6+j*2)):x[0];
  const width=mode==="initial"?Math.max(8,x[1]-(j%2===0?0:1)):x[1];
  b.style.left=left+"%";b.style.width=Math.min(width,100-left)+"%";
  b.title=(x[2]==="dark"?"Setup":x[2]==="cyan"?"Operation":x[2]==="rose"?"Processing":"Scheduled work")+" — "+row[0];
  track.appendChild(b);
 });
 return track;
}
function renderChart(){
 if(!fullRows)return;
 const content=data[currentTab];if(!content)return;
 showcaseTitle.textContent=content.title;showcaseDesc.textContent=content.desc;
 fullRows.replaceChildren();
 content.rows.forEach(function(row,i){
  const line=document.createElement("div");line.className="full-row";
  const label=document.createElement("div");label.className="full-row-label";
  const number=document.createElement("b");number.textContent=String(i+1).padStart(2,"0");
  const text=document.createElement("span");text.textContent=row[0];
  const sub=document.createElement("small");sub.textContent=row[1];text.appendChild(sub);
  label.appendChild(number);label.appendChild(text);
  line.appendChild(label);line.appendChild(shapeBars(row,i,currentMode));
  fullRows.appendChild(line);
 });
 if(legend){
  legend.replaceChildren();
  content.legend.forEach(function(item){const span=document.createElement("span");const mark=document.createElement("i");mark.className="legend-dot "+item[1];span.appendChild(mark);span.appendChild(document.createTextNode(item[0]));legend.appendChild(span);});
  const note=document.createElement("span");note.className="legend-note";note.textContent="Illustrative schedule — not a measured performance claim";legend.appendChild(note);
 }
 document.querySelectorAll(".schedule-block").forEach(function(b){
  const raw=b.getAttribute(currentMode==="optimized"?"data-optimized":"data-original");
  const pair=raw.split(",").map(Number);b.style.left=pair[0]+"%";b.style.width=pair[1]+"%";
 });
}
tabs.forEach(function(tab){tab.addEventListener("click",function(){
 currentTab=tab.getAttribute("data-schedule-tab")||"equipment";
 tabs.forEach(function(t){const active=t===tab;t.classList.toggle("selected",active);t.setAttribute("aria-selected",String(active));});
 renderChart();
});});
switches.forEach(function(btn){btn.addEventListener("click",function(){
 currentMode=btn.getAttribute("data-mode-choice")==="original"?"initial":"optimized";
 switches.forEach(function(b){const active=b===btn;b.classList.toggle("active",active);b.setAttribute("aria-pressed",String(active));});
 renderChart();
});});
const modeNote=document.querySelector(".mock-footer-end");
if(modeNote)modeNote.title="This is an illustration, not a measured optimization benchmark.";
renderChart();
})();
