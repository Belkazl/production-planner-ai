import {chromium} from "playwright-core";
import {randomBytes,randomUUID} from "node:crypto";
const browser=await chromium.launch({headless:true,channel:"chrome",args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1770,height:970}});
try{
 await page.goto("https://app.liftorbit.app",{waitUntil:"domcontentloaded",timeout:50000});
 const reg=await page.evaluate(async ({email,password})=>{
  const r=await fetch("/api/auth/register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password,company:"Disposable ceramic QA"})});
  return r.status;
 },{email:"ceramic-qa-"+randomUUID().replaceAll("-","")+"@liftorbit.invalid",password:randomBytes(26).toString("base64url")});
 if(reg!==200)throw Error("QA_REGISTER_"+reg);
 await page.goto("https://app.liftorbit.app",{waitUntil:"domcontentloaded",timeout:50000});
 await page.waitForFunction(()=>typeof window.__PP_OPTIMIZER_DEPTH__?.installed==="boolean",null,{timeout:35000});
 const info=await page.evaluate(()=>{
   const buttons=[...document.querySelectorAll("button,a,[role=button]")].filter(el=>el.offsetParent!==null).map(el=>({id:el.id||"",text:(el.textContent||el.title||el.getAttribute("aria-label")||"").trim().slice(0,80)})).filter(x=>x.text).slice(0,110);
   const keys=Object.keys(window).filter(k=>/demo|ceram|example|sample|start|setup/i.test(k)).slice(0,90);
   const html=document.documentElement.innerHTML;
   const matches=[...html.matchAll(/.{0,70}(?:Керамика|ceramic|demo|sample project).{0,100}/gi)].slice(0,18).map(m=>m[0].replace(/<[^>]{0,100}>/g,"").slice(0,180));
   return{buttons,keys,matches,localProjects:localStorage.getItem("prodplan.projects.v2")?.length||0};
 });
 console.log("QA_CERAMIC_DEMO_UI_DISCOVERY",JSON.stringify(info));
 const scripts=await page.evaluate(async()=>{
   const items=[];
   for(const tag of document.scripts){
     if(!tag.src){items.push({kind:"inline",length:tag.textContent.length,ceramic:/ceramic|Керамика|demo/i.test(tag.textContent)});continue;}
     const u=new URL(tag.src,document.baseURI);
     if(u.origin!==location.origin){items.push({kind:"external",path:u.pathname});continue;}
     try{
       const resp=await fetch(u.toString(),{credentials:"same-origin",cache:"no-store"});
       const body=await resp.text();
       const matches=[...body.matchAll(/.{0,60}(?:ceramic|Керамика|12.?900|loadDemo|loadSample|sampleModel).{0,90}/gi)].slice(0,12).map(m=>m[0].slice(0,190));
       items.push({path:u.pathname,status:resp.status,length:body.length,matches});
     }catch(e){items.push({path:u.pathname,error:String(e).slice(0,60)})}
   }
   return items.slice(0,25);
 });
 console.log("QA_CERAMIC_JS_ASSETS",JSON.stringify(scripts));

} catch(e){console.log("QA_DEMO_FAILED",String(e?.stack||e).slice(0,700));process.exitCode=1}
finally{await browser.close()}
