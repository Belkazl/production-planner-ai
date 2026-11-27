// Original MIT-licensed OpenAI Apps SDK UI CSS. Adapt only namespace and compile-time helpers.
import {readFileSync} from "node:fs";
const read=name=>readFileSync(new URL("vendor/"+name,import.meta.url),"utf8");
const compile=s=>s.replace(/spacing\(([\d.]+)\)/g,"calc(var(--spacing) * $1)").replace(/alpha\((var\(--[\w-]+\)),\s*([\d.]+)%\)/g,"color-mix(in oklab, $1 $2%, transparent)");
const tokens=new Map();
for(const name of ["primitive.css","semantic.css","components.css"]){
 const s=read(name).replace(/\/\*[\s\S]*?\*\//g,"");
 const current=new Map();
 for(const m of s.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)){
  if(!current.has(m[1]))current.set(m[1],compile(m[2].trim()));
 }
 for(const [k,v] of current)tokens.set(k,v);
}
const componentCSS=["Input.css","SelectControl.css","Select.css"].map(name=>{
 let s=read(name);
 // Use native CSS nesting, with upstream hover/autofill mixins expanded.
 s=s.replace(/@mixin hover\s*\{/g,"&:hover {").replace(/@mixin autofill\s*\{/g,"&:-webkit-autofill, &:-webkit-autofill:focus, &:-webkit-autofill:hover {");
 s=s.replace(/\.([A-Z][A-Za-z0-9_]*)\b/g,(_,name)=>".pp-sdk-"+(name==="Container"?"InputContainer":name));
 s=s.replace(/native-autofill-in/g,"pp-sdk-native-autofill-in");
 return compile(s);
}).join("\n");
const scope="#sectionView:has(.pp-perf-value-cell), .pp-sdk-MenuList";
const integration=readFileSync(new URL("integration.css",import.meta.url),"utf8");
const needed=new Set();
function requireToken(key){if(needed.has(key)||!tokens.has(key))return;needed.add(key);for(const m of tokens.get(key).matchAll(/var\((--[\w-]+)/g))requireToken(m[1]);}
for(const m of (componentCSS+integration).matchAll(/var\((--[\w-]+)/g))requireToken(m[1]);
export const css="/* OpenAI Apps SDK UI, MIT, upstream 0f00143c7a639906f1621fe58e1b6be7b5bea46d; scoped vanilla integration. */\n"+scope+"{color-scheme:light;"+[...needed].map(k=>k+":"+tokens.get(k)+";").join("\n")+"}\n"+componentCSS+"\n"+integration;
export const sourceTokens=Object.fromEntries([...needed].map(k=>[k,tokens.get(k)]));
