Bun.serve({port:18081,async fetch(req){
 const path=new URL(req.url).pathname;
 if(path!=="/")return new Response("not_found",{status:404});
 const h=await Bun.file("/tmp/pp-gateway-fixture.html").text();
 if(!h.includes('id="ganttScroll"')||!h.includes("ppIncumbentDecision(a,b)"))return new Response("invalid-fixture",{status:500});
 return new Response(h,{headers:{"content-type":"text/html; charset=utf-8"}});
}});
console.log("QA_PLANNER_UI_SOURCE_READY_18081");
