import {readFileSync} from "node:fs";
const read=name=>readFileSync(new URL("../equipment-sdk-style-20261127/vendor/"+name,import.meta.url),"utf8");
const compile=s=>s.replace(/spacing\(([\d.]+)\)/g,"calc(var(--spacing) * $1)").replace(/alpha\((var\(--[\w-]+\)),\s*([\d.]+)%\)/g,"color-mix(in oklab, $1 $2%, transparent)");
const tokens=new Map();
for(const name of ["primitive.css","semantic.css","components.css"]){
 const current=new Map();
 for(const m of read(name).replace(/\/\*[\s\S]*?\*\//g,"").matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g))if(!current.has(m[1]))current.set(m[1],compile(m[2].trim()));
 for(const [k,v] of current)tokens.set(k,v);
}
const upstream=readFileSync(new URL("vendor/Button.css",import.meta.url),"utf8");
// Unmodified upstream component rules, apart from CSS modules namespacing and hover mixin expansion.
const button=compile(upstream.replace(/@mixin hover\s*\{/g,"&:hover {").replace(/\.Button(Inner|Loader)?\b/g,(_,suffix)=>"#sectionView .pp-sdk-equipment-toolbar .pp-sdk-Button"+(suffix||"")).replace(/\[data-loading\] &/g,"[data-loading] &"));
// The inner/loader rules must be separately scoped; no HTML structure is replaced.
const integration=readFileSync(new URL("integration.css",import.meta.url),"utf8");
const needed=new Set();
function requireToken(k){if(needed.has(k)||!tokens.has(k))return;needed.add(k);for(const m of tokens.get(k).matchAll(/var\((--[\w-]+)/g))requireToken(m[1])}
for(const m of (button+integration).matchAll(/var\((--[\w-]+)/g))requireToken(m[1]);
export const css="/* OpenAI Apps SDK UI Button, MIT, upstream 0f00143c7a639906f1621fe58e1b6be7b5bea46d */\n#sectionView .pp-sdk-equipment-toolbar{color-scheme:light;"+[...needed].map(k=>k+":"+tokens.get(k)+";").join("\n")+"}\n"+button+"\n"+integration;
