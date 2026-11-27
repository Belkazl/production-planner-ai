import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {join} from "node:path";
import {patchAuthAI,patchTenant,previousUI,nextUI} from "./patch_ai.mjs";
import {browserFunctions,css,script} from "./browser-ui.mjs";
export const once=(s,a,b)=>{assert.equal(s.split(a).length,2,"SHIP_BY_ANCHOR: "+a.slice(0,90));return s.replace(a,()=>b)};
export function patchOrderScript(s){
 const changes=[
 ['    \'<td><button class="pp-edit-del" type="button" data-order-del>×</button></td></tr>\';','    ppShipByCells(o)+\n    \'<td><button class="pp-edit-del" type="button" data-order-del>×</button></td></tr>\';'],
 ['<th>Техпроцесс</th><th></th></tr></thead><tbody id="ppOrderBody">','<th>Техпроцесс</th><th>Отгрузить до</th><th>Статус срока</th><th></th></tr></thead><tbody id="ppOrderBody">'],
 ['async function saveOrders(){','async function saveOrders(){\n  if(!ppShipByValidate(q("sectionView")))return;'],
 ["base.technical_process_id=r.querySelector('[data-f=\"technical_process_id\"]').value||'';","base.technical_process_id=r.querySelector('[data-f=\"technical_process_id\"]').value||'';\n    ppShipBySave(base,r);"]
 ];
 for(const [a,b] of changes)s=once(s,a,b);
 return s;
}
export function patchRestart(s){
 s=once(s,' if(!candidate||candidate.valid===false||candidate.partial===true)return false;\n const a=Number(candidate[key]),b=Number(existing[key]);',' if(!candidate||candidate.valid===false||candidate.partial===true)return false;\n const deadline=window.__PP_ORDER_SHIP_BY_V1__?.compare?.(candidate,existing);if(deadline!=null)return deadline<0;\n const a=Number(candidate[key]),b=Number(existing[key]);');
 s=once(s,'if(complete(prior)&&(!complete(candidate)||Number(candidate[metric])>Number(prior[metric])+0.01)){','if(complete(prior)&&(!complete(candidate)||((window.__PP_ORDER_SHIP_BY_V1__?.compare?.(candidate,prior)??(Number(candidate[metric])>Number(prior[metric])+0.01?1:0))>0))){');
 return s;
}
export function patchStop(s){
 s=once(s,'if(fresh||!valid(fallback)||Number(accepted[key()])<=Number(fallback[key()]))return accepted;','if(fresh||!valid(fallback)||((window.__PP_ORDER_SHIP_BY_V1__?.compare?.(accepted,fallback)??(Number(accepted[key()])<=Number(fallback[key()])?0:1))<=0))return accepted;');
 s=once(s,'if(valid(prevPlan)&&(!valid(plan)||Number(plan[key()])>Number(prevPlan[key()])))plan=prevPlan;','if(valid(prevPlan)&&(!valid(plan)||((window.__PP_ORDER_SHIP_BY_V1__?.compare?.(plan,prevPlan)??(Number(plan[key()])>Number(prevPlan[key()])?1:0))>0)))plan=prevPlan;');
 return s;
}
export function transformPage(html,helpers,style,oldAi,newAi){
 if(typeof html!=="string"||html.includes('id="ppShipByJs"')||!html.includes('id="ppOrderProcessLinkJs"'))return html;
 const replace=(s,a,b)=>{if(s.split(a).length!==2)throw Error("SHIP_BY_PAGE_ANCHOR: "+a.slice(0,70));return s.replace(a,()=>b)};
 const editScript=(s,id,fn)=>{
  const re=new RegExp('<script\\b[^>]*\\bid=["\\\']'+id+'["\\\'][^>]*>([\\s\\S]*?)<\\/script\\s*>','gi'),all=[...s.matchAll(re)];
  if(all.length!==1)throw Error("SHIP_BY_SCRIPT_ANCHOR "+id);
  const m=all[0],at=m.index+m[0].indexOf(">")+1;return s.slice(0,at)+fn(m[1])+s.slice(at+m[1].length);
 };
 html=editScript(html,"ppOrderProcessLinkJs",function(s){
  s=replace(s,'    \'<td><button class="pp-edit-del" type="button" data-order-del>×</button></td></tr>\';','    ppShipByCells(o)+\n    \'<td><button class="pp-edit-del" type="button" data-order-del>×</button></td></tr>\';');
  s=replace(s,'<th>Техпроцесс</th><th></th></tr></thead><tbody id="ppOrderBody">','<th>Техпроцесс</th><th>Отгрузить до</th><th>Статус срока</th><th></th></tr></thead><tbody id="ppOrderBody">');
  s=replace(s,'async function saveOrders(){','async function saveOrders(){\n  if(!ppShipByValidate(q("sectionView")))return;');
  return replace(s,"base.technical_process_id=r.querySelector('[data-f=\"technical_process_id\"]').value||'';","base.technical_process_id=r.querySelector('[data-f=\"technical_process_id\"]').value||'';\n    ppShipBySave(base,r);");
 });
 // The candidate browser uses the same transformation as the server.
 if(oldAi&&html.includes(oldAi))html=replace(html,oldAi,newAi);
 const anchor="const trMap=new Map(Object.entries(texts));";
 html=replace(html,anchor,anchor+'\ntrMap.set("Отгрузить до","Ship by");trMap.set("Статус срока","Status");');
 const langSkip='[contenteditable],.pp-i18n-route-label,[data-pp-analytics-dashboard]';
 if(html.includes(langSkip))html=replace(html,langSkip,langSkip+', [data-pp-ship-status]');
 // If the APS no-regression guard is present in this HTML, update it too.
 const decision=" if(a.partial&&!b.partial)return{accept:false,reason:'partial'};";
 if(html.includes(decision))html=replace(html,decision,decision+"\n const shipCompare=window.__PP_ORDER_SHIP_BY_V1__?.compare?.(a,b);if(shipCompare!=null)return{accept:shipCompare<=0,reason:shipCompare>0?'deadline_regression':undefined};");
 // Helper definitions must exist before the native order script can render.
 html=replace(html,'<script id="ppOrderProcessLinkJs">','<script id="ppShipByJs">/* PP_ORDER_SHIP_BY_V1 */\n'+helpers+'</script><script id="ppOrderProcessLinkJs">');
 html=replace(html,"</head>",style+"</head>");
 html=replace(html,"</body>","<script>ppInstallShipBy();</script></body>");
 return html;
}
export function patchAuth(source){
 let s=patchAuthAI(source);
 const lines=s.split("\n"),i=lines.findIndex(l=>l.includes("const assistantHtml=ppEquipmentTypesPage("));
 assert(i>=0&&lines.filter(l=>l.includes("const assistantHtml=ppEquipmentTypesPage(")).length===1&&lines[i].trim().endsWith(";"),"SHIP_BY_AUTH_CHAIN");
 lines[i]=lines[i].replace("const assistantHtml=","const assistantHtml=ppShipByPage(").replace(/;\s*$/,");");
 return lines.join("\n")+"\nfunction ppShipByPage(html){return ("+transformPage.toString()+")(html,"+JSON.stringify(browserFunctions)+","+JSON.stringify(css)+",null,null);}\n";
}
export function patchPreview(html){return transformPage(html,browserFunctions,css,previousUI,nextUI)}
if(process.argv[1]?.endsWith("/order-ship-by-20261127/patch_app.mjs")){
 const [before,after]=process.argv.slice(2);mkdirSync(after,{recursive:true,mode:0o700});
 for(const [file,fn] of [["auth-runtime.js",patchAuth],["tenant-model-runtime.js",patchTenant],["restart-optimizer-ui.js",patchRestart],["stop-ui.js",patchStop]])writeFileSync(join(after,file),fn(readFileSync(join(before,file),"utf8")),{mode:0o600});
 console.log("SHIP_BY_APP_PATCH_PASS");
}
