const {chromium}=require("playwright");
async function main(){
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 const page=await browser.newPage({viewport:{width:1510,height:965}});
 page.on("pageerror",e=>console.log("PAGEERROR",String(e).slice(0,350)));
 try {
   const url="https://aps-setup-bridge-candidate-v2-production.up.railway.app/";
   const r=await page.goto(url,{waitUntil:"domcontentloaded",timeout:65000});
   console.log("HTML_STATUS",r.status());
   await page.waitForTimeout(1800);
   await describe("initial",page);
   for(const tab of ["Заказы","Производство","Проекты"]){
     const exist=await page.getByText(tab,{exact:true}).count();
     console.log("TAB",tab,"matches",exist);
     if(!exist)continue;
     try{
       const clickable=page.locator("button, a, [role=tab], .nav-item, .sidebar-item, [onclick]").filter({hasText:tab}).first();
       if(await clickable.count()) {await clickable.click({timeout:5000});await page.waitForTimeout(1000);await describe("after-"+tab,page)}
     }catch(err){console.log("TAB_FAIL",tab,String(err).slice(0,500))}
   }
 } finally {await browser.close()}
}
async function describe(name,page){
 const data=await page.evaluate(()=>{
  const trimm=(s,n=800)=>String(s||"").trim().slice(0,n);
  const token=["Производственные параметры","Площадь, м²","Техпроцесс","width_mm","Заказ"];
  const matched={};
  for(const t of token) {
    const list=[...document.querySelectorAll("body *")].filter(e=>e.children.length===0&&e.textContent&&e.textContent.trim()===t);
    matched[t]=list.slice(0,4).map(el=>{
      let p=el;const ancestors=[];
      for(let i=0;p&&i<6;i++,p=p.parentElement){ancestors.push({tag:p.tagName,className:trimm(p.className,190),id:p.id,attrs:[...p.attributes].filter(a=>/class|data|role/.test(a.name)).map(a=>a.name+"="+a.value.slice(0,130)).slice(0,8),html:trimm(p.outerHTML,i===0?360:i===1?1600: i===2?3200: i===3?5200:950)})}
      return ancestors;
    });
  }
  const fields=[...document.querySelectorAll("input,select")].slice(0,55).map(e=>({name:e.name,id:e.id,type:e.type,value:trimm(e.value,80),parent:trimm(e.parentElement?.outerHTML,470)}));
  const nav=[...document.querySelectorAll("button,a,[role=tab]")].map(e=>trimm(e.textContent,80)).filter(Boolean).slice(0,100);
  const top=trimm(document.body?.innerText,3600);
  return {matched,fields,nav,top};
 });
 console.log("SNAPSHOT_BEGIN",name);
 console.log(JSON.stringify(data).slice(0,65000));
 console.log("SNAPSHOT_END",name);
}
main().catch(e=>{console.error(e);process.exit(1)});
