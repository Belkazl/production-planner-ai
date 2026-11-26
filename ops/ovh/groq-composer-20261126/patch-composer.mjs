import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";

export const marker="PP_GROQ_COMPOSER_V2";
export const css='<style id="ppGroqComposerV2">.assist .compose{flex:0 0 auto;min-width:0;margin-top:0!important}.assist .compose textarea{min-width:0;cursor:text}.assist .compose button:disabled{opacity:.6;cursor:wait}.assist .hrow,.assist .pp-groq-controls{flex-shrink:0}@media(min-width:961px){body:not(.projects-mode) .shell>.assist{position:sticky;top:58px;align-self:start;box-sizing:border-box;height:calc(100dvh - 58px);min-height:0!important;max-height:calc(100dvh - 58px);overflow:hidden}.assist #messages{flex:1 1 0;min-height:0;max-height:none!important;overflow:auto;overscroll-behavior:contain}.assist #summary{flex:0 1 auto;min-height:0;max-height:23%;overflow:auto}.assist .pp-groq-controls{font-size:11px;line-height:1.35}.assist .compose textarea{height:46px;box-sizing:border-box}.assist .compose button{flex:0 0 42px}}@media(max-height:580px) and (min-width:961px){.assist #summary{display:none}.assist .pp-groq-controls{font-size:10px;padding-top:2px}.assist{gap:6px!important}}</style>';
export function transformComposer(html,style){
 if(typeof html!=="string"||html.includes('id="ppGroqComposerV2"')||!html.includes("PP_GROQ_ASSISTANT_UI_V1"))return html;
 const edits=[
 ["assistantState.busy=true;inp.disabled=true;button.disabled=true;","assistantState.busy=true;button.disabled=true;"],
 ["assistantBubble(assistantText(...entry));inp.value=message;return;","assistantBubble(assistantText(...entry));if(!inp.value)inp.value=message;return;"],
 ["Попробуйте ещё раз."+'"));inp.value=message;', "Попробуйте ещё раз."+'"));if(!inp.value)inp.value=message;'],
 ["if(assistantSyncProject()===project)inp.focus();","if(assistantSyncProject()===project&&document.activeElement===button)inp.focus();"],
 ["</head>",style+"</head>"]
 ];
 for(const [before,after] of edits)if(html.split(before).length!==2)return html;
 for(const [before,after] of edits)html=html.replace(before,after);
 return html;
}
export function patchSource(source){
 assert(source.includes("function ppGroqUiHtml(html)"),"GROQ_V1_REQUIRED");
 assert(!source.includes("function ppGroqComposerHtml(html)"),"GROQ_COMPOSER_ALREADY_INSTALLED");
 const before="const assistantHtml=ppGroqUiHtml(branded);";
 const after="const assistantHtml=ppGroqComposerHtml(ppGroqUiHtml(branded));";
 assert.equal(source.split(before).length,2,"GROQ_COMPOSER_ANCHOR_DRIFT");
 const append="\n// "+marker+"\nfunction ppGroqComposerHtml(html){return ("+transformComposer.toString()+")(html,"+JSON.stringify(css)+");}\n";
 const result=source.replace(before,after)+append;
 assert.equal(result.slice(0,-append.length).replace(after,before),source);
 return result;
}
if(process.argv[1]?.endsWith("/patch-composer.mjs")){
 const [from,to]=process.argv.slice(2);assert(from&&to);
 writeFileSync(to,patchSource(readFileSync(from,"utf8")),{mode:0o600});
 console.log("GROQ_COMPOSER_EXACT_PATCH_PASS");
}
