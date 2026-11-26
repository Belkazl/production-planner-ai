import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
export const marker="PP_GROQ_CHAT_CLEANUP_V1";
export const css='<style id="ppGroqChatCleanupV1">#mobileAiToggle{display:none!important}.assist .hrow{justify-content:flex-start;gap:12px}.assist .hrow .online{margin-left:auto}</style>';
export function cleanupChat(){
 const messages=document.getElementById("messages");
 const demoNotice=(node)=>{
  if(node.nodeType!==1||!node.classList.contains("bubble")||node.classList.contains("user")||node.classList.contains("me")||node.dataset.groqMessage)return false;
  const t=(node.textContent||"").replace(/\s+/g," ").trim();
  return /^(?:Demo\s+.{1,150}?\s+loaded\s*:|Демо(?:-проект)?\s+.{1,150}?\s+загружен[оа]?\s*:)/iu.test(t)
   && /(?:[Bb]atches\s+(?:are\s+)?(?:sized|split)|[Oo]ptimization is ready to start|[Пп]арти[ияй]|[Оо]птимизаци[яию])/u.test(t);
 };
 const clean=()=>{
  document.body.classList.remove("ai-collapsed-mobile");
  if(messages)for(const node of [...messages.children])if(demoNotice(node))node.remove();
 };
 clean();
 if(messages)new MutationObserver(clean).observe(messages,{childList:true,subtree:true,characterData:true});
 // Keep a previously collapsed sidebar expanded, including on reload and resize.
 new MutationObserver(()=>{if(document.body.classList.contains("ai-collapsed-mobile"))document.body.classList.remove("ai-collapsed-mobile")}).observe(document.body,{attributes:true,attributeFilter:["class"]});
}
export function transformChatCleanup(html,style,script){
 if(typeof html!=="string"||html.includes('id="ppGroqChatCleanupV1"')||!html.includes("PP_GROQ_ASSISTANT_UI_V1")||!html.includes("ppGroqComposerV2"))return html;
 if(html.split("</head>").length!==2||html.split("</body>").length!==2)return html;
 return html.replace("</head>",style+"</head>").replace("</body>",script+"</body>");
}
export const script='<script id="ppGroqChatCleanupScript">('+cleanupChat.toString()+')();</script>';
export function patchSource(source){
 assert(source.includes("function ppGroqComposerHtml(html)"),"COMPOSER_V2_REQUIRED");
 assert(!source.includes("function ppGroqChatCleanupHtml(html)"),"CHAT_CLEANUP_ALREADY_INSTALLED");
 const before="const assistantHtml=ppGroqComposerHtml(ppGroqUiHtml(branded));";
 const after="const assistantHtml=ppGroqChatCleanupHtml(ppGroqComposerHtml(ppGroqUiHtml(branded)));";
 assert.equal(source.split(before).length,2,"CHAT_CLEANUP_ANCHOR_DRIFT");
 const append="\n// "+marker+"\nfunction ppGroqChatCleanupHtml(html){return ("+transformChatCleanup.toString()+")(html,"+JSON.stringify(css)+","+JSON.stringify(script)+");}\n";
 const result=source.replace(before,after)+append;
 assert.equal(result.slice(0,-append.length).replace(after,before),source);
 return result;
}
if(process.argv[1]?.endsWith("/patch-cleanup.mjs")){
 const [from,to]=process.argv.slice(2);assert(from&&to);
 writeFileSync(to,patchSource(readFileSync(from,"utf8")),{mode:0o600});
 console.log("GROQ_CHAT_CLEANUP_EXACT_PATCH_PASS");
}
