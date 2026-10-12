import {readFileSync,writeFileSync} from "node:fs";
let source=readFileSync("index.ts","utf8");
function replaceOne(input:string,oldText:string,newText:string,name:string){
 const count=input.split(oldText).length-1;
 if(count!==1)throw new Error("PP_GANTT_DETAILS_"+name+"_ANCHOR_"+count);
 return input.replace(oldText,newText);
}
function patchInline(name:string,transform:(html:string)=>string){
 const anchor="const "+name+"=";
 const start=source.indexOf(anchor),valueStart=start+anchor.length;
 if(start<0)throw new Error("PP_GANTT_DETAILS_MISSING_"+name);
 const end=source.indexOf(";\n",valueStart);
 if(end<0)throw new Error("PP_GANTT_DETAILS_NO_END_"+name);
 const html=JSON.parse(source.slice(valueStart,end));
 const revised=transform(html);
 if(revised===html)throw new Error("PP_GANTT_DETAILS_NO_CHANGES_"+name);
 source=source.slice(0,valueStart)+JSON.stringify(revised)+source.slice(end);
}
patchInline("PP_GANTT_INLINE",html=>{
 html=replaceOne(html,
   'bar.title=desc;bar.setAttribute("aria-label",desc);bar.tabIndex=0;',
   'bar.title=desc;bar.setAttribute("aria-label",desc);bar.tabIndex=0;bar.__ppOperation=o;bar.__ppPlan=p;bar.__ppResource=eq;bar.__ppResourceKind="equipment";bar.__ppKind=isSetup?"setup":"operation";',
   "equipment_bar");
 html=replaceOne(html,
   'b.title=JSON.stringify((o.materials||[]).map(function(m){return m.name||m.id}));lane.appendChild(b);',
   'b.title=JSON.stringify((o.materials||[]).map(function(m){return m.name||m.id}));b.__ppBlockedOrder=o;b.__ppPlan=p;b.__ppKind="blocked";lane.appendChild(b);',
   "blocked_bar");
 return html;
});
patchInline("PP_SECONDARY_GANTTS_INLINE",html=>{
 return replaceOne(html,
  'bar.setAttribute("aria-label",bar.title);bar.tabIndex=0;lane.appendChild(bar)',
  'bar.setAttribute("aria-label",bar.title);bar.tabIndex=0;bar.__ppOperation=e.op||null;bar.__ppPlan=p;bar.__ppResource={name:r.label,id:r.label};bar.__ppResourceKind=mode===1?"employee":mode===3?"order":"material";bar.__ppKind=material?e.kind:(setup?"setup":"operation");bar.__ppMaterialEvent=material?e:null;lane.appendChild(bar)',
  "secondary_bar");
});
const css=readFileSync("gantt-details.css","utf8");
const js=readFileSync("gantt-details.js","utf8");
const injection="<style id=\"pp-gantt-operation-details-style\">"+css+"</style><script id=\"pp-gantt-operation-details-script\">"+js+"</script>";
source=replaceOne(source,"async function serveGanttUi(req){",
 "const PP_GANTT_DETAILS_INLINE="+JSON.stringify(injection)+";\nasync function serveGanttUi(req){","html_constant");
source=replaceOne(source,"+PP_STOP_INLINE+'</body>'",
 "+PP_STOP_INLINE+PP_GANTT_DETAILS_INLINE+'</body>'","append_details");
if(!source.includes("PP_GANTT_DETAILS_INLINE")||!source.includes("__ppOperation=o")||!source.includes("__ppMaterialEvent"))
 throw new Error("PP_GANTT_DETAILS_INTEGRITY_FAILURE");
writeFileSync("index.ts",source);
console.log("PP_GANTT_DETAILS_BUILD_OK",JSON.stringify({bytes:source.length,modalBytes:injection.length,appended:true,operationData:true}));
