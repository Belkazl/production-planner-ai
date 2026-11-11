// Acceptance: the actual restored native browser sends the existing saved
// plan as an owned, compact continuation seed on a fresh synthetic account.
const assert=require("node:assert/strict");
const {randomUUID,randomBytes}=require("node:crypto");
const {chromium}=require("playwright");
const base="http://127.0.0.1:18082";
const browserBase="http://localhost:18082";
const headers={origin:"https://app.liftorbit.app","sec-fetch-site":"same-origin","content-type":"application/json","accept":"application/json"};
const request=async(path,method="GET",body,cookie="")=>{
 const res=await fetch(base+path,{method,headers:{...headers,...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 let data={};try{data=await res.json()}catch{}
 return {status:res.status,data,cookie:(res.headers.get("set-cookie")||"").split(";")[0]};
};
(async()=>{
 const email="browser-legacy-"+randomUUID()+"@liftorbit.invalid";
 const reg=await request("/api/auth/register","POST",{email,password:randomBytes(32).toString("hex"),company:"Disposable legacy UI QA"});
 assert.equal(reg.status,200);
 const cookie=reg.cookie;assert(cookie);
 const model={
  scheduler_mode:"resource",start:"2026-11-11T08:00:00",
  equipment:[{id:"Q_EQ",name:"QA Press",kind:"workstation",capacity:10,capacity_unit:"pcs"}],
  employees:[{id:"Q_EMP",name:"QA Operator",shift:"day"}],
  shifts:{day:[["08:00","12:00"],["13:00","17:00"]]},
  orders:[{id:"Q_A",quantity:5,unit:"pcs",technical_process_id:"Q_TP",parameters:{color:"A"}},
          {id:"Q_B",quantity:5,unit:"pcs",technical_process_id:"Q_TP",parameters:{color:"B"}}],
  technical_processes:[{id:"Q_TP",name:"QA Press",operations:[{
   id:"Q_OP",name:"Press",sequence:1,duration_min:30,
   resource_requirements:[
    {resource_type:"equipment",match_mode:"specific",resource_ref:"Q_EQ",resource_refs:["Q_EQ"],quantity:1},
    {resource_type:"employee",match_mode:"specific",resource_ref:"Q_EMP",resource_refs:["Q_EMP"],quantity:1}
   ]}]}],
  setup_rules:[],materials:[]
 };
 const lastPlan={
  valid:true,ok:true,duration_minutes:150,_revision:1,
  optimization_run:5,total_generations:240,
  operations:[{order:"Q_A",operation_name:"Press",start_min:0,end_min:30,equipment_ids:["Q_EQ"]},
              {order:"Q_B",operation_name:"Press",start_min:30,end_min:60,equipment_ids:["Q_EQ"]}]
 };
 const project="qa-legacy-"+randomUUID();
 const stored=JSON.stringify([{id:project,name:"QA legacy saved plan",revision:1,model,lastPlan}]);
 const saved=await request("/api/db-storage","POST",{storage:{"prodplan.projects.v2":stored,"prodplan.project.active.v2":project}},cookie);
 assert.equal(saved.status,200);
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const context=await browser.newContext({viewport:{width:1500,height:900},
    extraHTTPHeaders:{cookie,origin:"https://app.liftorbit.app","sec-fetch-site":"same-origin"}});
  const page=await context.newPage(),requests=[],errors=[];
  page.on("pageerror",e=>errors.push(String(e.message||e).slice(0,90)));
  page.on("request",req=>{
   try{
    if(new URL(req.url()).pathname==="/api/plan"&&req.method()==="POST"){
     const data=JSON.parse(req.postData()||"{}");
     requests.push({continue:data.continue===true,
       seeded:Array.isArray(data.resume_plan?.order_sequence),
       size:data.resume_plan?.order_sequence?.length||0,
       duration:data.resume_plan?.duration_minutes||0,
       fresh:data.__pp_fresh_recovery===true});
    }
   }catch(e){errors.push("request_capture_invalid")}
  });
  await page.goto(browserBase+"/",{waitUntil:"domcontentloaded",timeout:60000});
  await page.waitForFunction(()=>{
   const b=document.getElementById("opt");
   return !!window.__ppLegacyContinuationSeed&&b&&!b.disabled&&/continue|продолж/i.test(b.textContent||"");
  },{timeout:20000}).catch(()=>{});
  const before=await page.evaluate(()=>{
   const b=document.getElementById("opt");
   const seed=window.__ppLegacyContinuationSeed?.();
   return {seeded:!!seed,orders:seed?.order_sequence?.length||0,disabled:b?.disabled,
      label:String(b?.textContent||"").slice(0,38),gantt:document.querySelectorAll(".pg2-bar").length};
  });
  console.log("LEGACY_BROWSER_BEFORE",JSON.stringify(before));
  assert(before.seeded&&before.orders===2,"legacy saved plan not recognized");
  assert.equal(before.disabled,false,"saved plan continuation button must be enabled");
  await page.locator("#opt").click({timeout:10000});
  for(let i=0;i<35;i++){
    await page.waitForTimeout(1000);
    const check=await request("/api/plan-progress","GET",undefined,cookie);
    if(check.status===200&&check.data.success&&check.data.result?.operations?.length){
      console.log("LEGACY_BROWSER_FINAL",JSON.stringify({valid:check.data.result.valid,
        operations:check.data.result.operations.length}));
      break;
    }
    if(i===34)throw Error("legacy browser GA did not complete");
  }
  console.log("LEGACY_BROWSER_REQUEST",JSON.stringify(requests.slice(-3)));
  assert(requests.some(x=>x.continue&&x.seeded&&x.size===2&&!x.fresh),
    "real browser must POST a two-order legacy resume_plan");
  assert.equal(errors.length,0,"unexpected browser script errors: "+errors.slice(0,2).join(";"));
  const check=await request("/api/db-storage","GET",undefined,cookie);
  assert.equal(check.status,200);
  assert.equal(check.data.storage["prodplan.projects.v2"],stored,"saved plans must remain unchanged");
  console.log("LEGACY_BROWSER_CONTINUATION_END_TO_END_OK");
 }finally{await browser.close()}
})().catch(err=>{console.error("LEGACY_BROWSER_CONTINUATION_FAILED",String(err.message||err).slice(0,120));process.exit(1)});
