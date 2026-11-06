import {readFileSync,writeFileSync} from "node:fs";
let source=readFileSync("index.ts","utf8");
function once(a:string,b:string,label:string){
 const hits=source.split(a).length-1;
 if(hits!==1)throw Error("PP_GA_BUDGET_"+label+"_ANCHOR_"+hits);
 source=source.replace(a,b);
}
// The upstream optimizer accepts both fields; 120x80 has repeatedly exceeded
// the live HTTP lifetime on the 12-order ceramic model (>4 minutes, 502).
// Execute an honestly bounded, complete pass; users may continue iterating.
// Do not fabricate progress and do not change the optimizer's constraints.
const gaBudgetHtml=String.raw`
function ppGaBudgetHtml(html){
 const before="generations:120,population:80,continue:cont";
 const hits=html.split(before).length-1;
 if(hits!==1)throw Error("PP_GA_BUDGET_HTML_CHANGED_"+hits);
 return html.replace(before,"generations:60,population:32,continue:cont");
}
`;
once("async function serveGanttUi(req){",gaBudgetHtml+"\nasync function serveGanttUi(req){","define");
once("new Response(ppStartOverHtml(ppGaPollHtml).replace('</body>',",
     "new Response(ppGaBudgetHtml(ppStartOverHtml(ppGaPollHtml)).replace('</body>',","activate");
if(!source.includes("ppGaBudgetHtml(ppStartOverHtml(ppGaPollHtml))")||!source.includes("PP_DOCUMENTS_INLINE"))
 throw Error("PP_GA_BUDGET_INTEGRITY");
writeFileSync("index.ts",source);
console.log("PP_GA_EXECUTION_BUDGET_BUILD_OK",JSON.stringify({
 version:1,generationsRequested:60,populationRequested:32,
 originalGenerations:120,originalPopulation:80,
 existingConstraintsPreserved:true,savedPlansUntouched:true
}));
