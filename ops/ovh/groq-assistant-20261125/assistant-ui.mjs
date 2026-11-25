// The existing chat sends questions through a read-only route; it never clears the plan.
function activeAssistantProject(){
 try{return localStorage.getItem("prodplan.project.active.v2")||""}catch{return ""}
}
function assistantRussian(){return document.documentElement.lang.toLowerCase().startsWith("ru")}
function assistantText(en,ru){return assistantRussian()?ru:en}
const assistantState={project:activeAssistantProject(),history:[],busy:false,sequence:0,includeProject:false};
function assistantSyncProject(){
 const key=activeAssistantProject();
 if(key!==assistantState.project){
  assistantState.project=key;assistantState.history=[];assistantState.sequence++;
  assistantState.includeProject=false;
  const check=document.getElementById("ppGroqConsent");if(check)check.checked=false;
 }
 return key;
}
function assistantBubble(text,user=false){
 const messages=document.getElementById("messages");
 if(!messages)return;
 const node=document.createElement("div");
 node.className="bubble"+(user?" me":"");
 node.dataset.groqMessage=user?"user":"assistant";
 node.style.whiteSpace="pre-wrap";
 node.style.overflowWrap="anywhere";
 if(user){node.style.marginLeft="12px";node.style.background="#e9f1ff"}
 node.textContent=text;
 messages.appendChild(node);
 messages.scrollTop=messages.scrollHeight;
}
async function sendChat(){
 const inp=document.getElementById("chatInput"),button=document.getElementById("chatSend"),consent=document.getElementById("ppGroqConsent");
 if(!inp||!button||assistantState.busy)return;
 const message=inp.value.trim();if(!message)return;
 if(message.length>1800){assistantBubble(assistantText("Maximum 1,800 characters per message.","Максимум 1 800 символов в сообщении."));return}
 const project=assistantSyncProject(),includeProject=!!consent?.checked;
 if(includeProject!==assistantState.includeProject){assistantState.history=[];assistantState.includeProject=includeProject;assistantState.sequence++}
 const seq=assistantState.sequence;
 let history=assistantState.history.slice(-6);
 while(history.reduce((n,x)=>n+x.content.length,0)>3600)history=history.slice(2);
 assistantState.busy=true;inp.disabled=true;button.disabled=true;
 if(consent)consent.disabled=true;
 inp.value="";assistantBubble(message,true);
 const status=document.getElementById("ppGroqStatus");
 if(status)status.textContent=assistantText("Thinking…","Думаю…");
 const labels={
  assistant_rate_limit:["AI usage limit reached. Please try again later.","Достигнут лимит AI. Попробуйте позже."],
  assistant_not_configured:["AI is not configured yet.","AI ещё не настроен."],
  assistant_provider_unavailable:["AI provider is temporarily unavailable.","AI-сервис временно недоступен."],
  assistant_context_unavailable:["Project summary is unavailable. Try without sharing it.","Сводка проекта недоступна. Попробуйте без неё."],
  authentication_required:["Your session expired. Sign in again.","Сессия истекла. Войдите заново."],
  assistant_invalid_request:["Please shorten the message and try again.","Сократите сообщение и повторите попытку."],
  assistant_request_too_large:["The message is too long.","Сообщение слишком длинное."]
 };
 try{
  const response=await fetch("/api/assistant",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({message,history,includeProject}),signal:AbortSignal.timeout(45000)});
  const data=await response.json();
  // A late reply must never appear in another project's chat.
  if(assistantSyncProject()!==project||assistantState.sequence!==seq)return;
  if(!response.ok||data?.ok!==true||typeof data.reply!=="string"){
   const entry=labels[data?.error]||["Could not get an AI response. Try again.","Не удалось получить ответ AI. Попробуйте ещё раз."];
   assistantBubble(assistantText(...entry));inp.value=message;return;
  }
  assistantBubble(data.reply);
  // A long answer is shown in full, but only bounded recent turns are sent back.
  assistantState.history=[...history,{role:"user",content:message},{role:"assistant",content:data.reply.slice(0,1800)}].slice(-6);
 }catch{
  if(assistantSyncProject()===project&&assistantState.sequence===seq){
   assistantBubble(assistantText("Could not connect to the assistant. Try again.","Не удалось подключиться к помощнику. Попробуйте ещё раз."));inp.value=message;
  }
 }finally{
  assistantState.busy=false;inp.disabled=false;button.disabled=false;
  if(consent)consent.disabled=false;
  if(status)status.textContent="";
  if(assistantSyncProject()===project)inp.focus();
 }
}
function installAssistantControls(){
 const consent=document.getElementById("ppGroqConsent");
 const label=document.getElementById("ppGroqConsentLabel");
 const notice=document.getElementById("ppGroqNotice");
 const inp=document.getElementById("chatInput");
 if(!consent||!label||!notice||!inp)return;
 const localize=()=>{
  label.textContent=assistantText("Include anonymized project summary","Добавить обезличенную сводку проекта");
  notice.textContent=assistantText("Messages and recent chat context are sent to Groq. Do not include confidential or personal data. Read-only.","Сообщения и недавний контекст чата передаются Groq. Не указывайте конфиденциальные или личные данные. Только чтение.");
  inp.placeholder=assistantText("Ask a production question…","Задайте вопрос о производстве…");
  inp.maxLength=1800;
 };
 localize();
 consent.addEventListener("change",()=>{assistantSyncProject();assistantState.history=[];assistantState.includeProject=consent.checked;assistantState.sequence++});
 const chip=document.getElementById("activeProjectChip");
 if(chip)new MutationObserver(assistantSyncProject).observe(chip,{childList:true,subtree:true,characterData:true,attributes:true});
 new MutationObserver(localize).observe(document.documentElement,{attributes:true,attributeFilter:["lang"]});
}
export const UI_MARKER="PP_GROQ_ASSISTANT_UI_V1";
const client=[activeAssistantProject,assistantRussian,assistantText].map(f=>f.toString()).join("\n")+
 "\nconst assistantState={project:activeAssistantProject(),history:[],busy:false,sequence:0,includeProject:false};\n"+
 [assistantSyncProject,assistantBubble,sendChat,installAssistantControls].map(f=>f.toString()).join("\n")+
 "\ninstallAssistantControls();\n";
const controls='<div class="pp-groq-controls" id="ppGroqControls"><label><input type="checkbox" id="ppGroqConsent"><span id="ppGroqConsentLabel">Include anonymized project summary</span></label><div id="ppGroqNotice">Messages are sent to Groq. Do not include confidential or personal data. Read-only.</div><div id="ppGroqStatus" role="status" aria-live="polite"></div></div>';
const styles='<style id="ppGroqAssistantStyle">.pp-groq-controls{font:11px/1.4 Arial,sans-serif;color:#607289;padding:8px 0 2px;flex-shrink:0}.pp-groq-controls label{display:flex;align-items:flex-start;gap:6px;cursor:pointer;color:#344c6b}.pp-groq-controls input{margin:1px 0 0;flex:none;accent-color:#2464d3}#ppGroqNotice{margin-top:4px}#ppGroqStatus:not(:empty){margin-top:4px;color:#2464d3}body.ai-collapsed-mobile .assist .pp-groq-controls{display:none!important}.assist .bubble[data-groq-message]{white-space:pre-wrap;overflow-wrap:anywhere}</style>';
// This function is inserted into auth-runtime.js as a pure HTML transform.
// Only the exact existing chat function and composer markup are changed.
export function transformAssistantHtml(html,source,markup,css){
 const start="async function sendChat(){";
 const end="\nq('chatSend').onclick=sendChat;";
 const composer='<div class="compose"><textarea id="chatInput"';
 if(typeof html!=="string"||html.includes("PP_GROQ_ASSISTANT_UI_V1")||[start,end,composer,"</head>"].some(x=>html.split(x).length!==2))return html;
 const a=html.indexOf(start),b=html.indexOf(end,a);
 if(b<=a||b-a>6000||!html.slice(a,b).includes("fetch('/api/chat'")||!html.slice(a,b).includes("clearPlan()"))return html;
 let output=html.slice(0,a)+"/* PP_GROQ_ASSISTANT_UI_V1 */\n"+source+html.slice(b);
 output=output.replace(composer,markup+composer).replace("</head>",css+"</head>");
 const oldWelcome="Опишите производство обычным текстом: оборудование, смены, длительность операций, заказы, материалы и ограничения. Я соберу из этого модель.";
 output=output.replace(oldWelcome,"Ask about production planning, batch sizes, constraints or your current schedule. The assistant is read-only.");
 return output;
}
export function serverTransformSource(){
 return "\nfunction ppGroqUiHtml(html){return ("+transformAssistantHtml.toString()+")(html,"+JSON.stringify(client)+","+JSON.stringify(controls)+","+JSON.stringify(styles)+");}\n";
}
export {client,controls,styles};
