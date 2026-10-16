import assert from 'node:assert/strict';
import {calculateCapacity,pages,growthRoutes,enhanceHome,enhanceSitemap,RELEASE} from '../growth.mjs';
let checks=0; const check=(fn)=>{fn();checks++;};
const v={machines:2,days:5,shifts:1,hours:8,availability:85,units:1000,cycle:3,setups:10,setupMinutes:30};
const r=calculateCapacity(v);
for(const [key,value] of Object.entries({gross:80,available:68,processing:50,setup:5,required:55,headroom:13,maximumUnits:1260}))check(()=>assert.equal(r[key],value));
check(()=>assert.ok(Math.abs(r.load-80.88235294117648)<1e-10));
check(()=>assert.equal(calculateCapacity({...v,units:1400}).headroom,-7));
check(()=>assert.equal(calculateCapacity({...v,units:0,setups:0}).load,0));
check(()=>assert.equal(calculateCapacity({...v,units:1260}).headroom,0));
check(()=>assert.equal(calculateCapacity({...v,setups:1000}).maximumUnits,0));
for(const key of Object.keys(v)){
 for(const bad of [NaN,Infinity,-1,'1',undefined])check(()=>assert.throws(()=>calculateCapacity({...v,[key]:bad}),RangeError));
}
for(const key of ['machines','days','shifts','availability','cycle','hours'])check(()=>assert.throws(()=>calculateCapacity({...v,[key]:0}),RangeError));
for(const key of ['machines','days','shifts','units','setups'])check(()=>assert.throws(()=>calculateCapacity({...v,[key]:1.5}),RangeError));
check(()=>assert.throws(()=>calculateCapacity({...v,shifts:4,hours:8}),/24 hours/));
check(()=>assert.equal(pages.length,6));
const titles=new Set();
for(const page of pages){
 const html=growthRoutes.get(page.path).body;
 check(()=>assert.equal((html.match(/<h1>/g)||[]).length,1));
 check(()=>assert.ok(html.includes(`rel="canonical" href="https://liftorbit.app${page.path}"`)));
 check(()=>assert.ok(!titles.has(page.title)));titles.add(page.title);
 check(()=>JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]));
 check(()=>assert.ok(html.includes('aria-label="Breadcrumb"')));
 check(()=>assert.ok(html.includes('rel="nofollow">Explore the planner')));
 for(const [,href] of html.matchAll(/href="(\/[^"?#]*)/g)){
  check(()=>assert.ok(href==='/'||href==='/favicon.svg'||href==='/go/planner'||growthRoutes.has(href),'broken internal link '+href));
 }
}
const base='<html><head></head><body><nav><a href="#faq">FAQ</a></nav><main><h1>Original homepage</h1></main></body></html>';
const enhanced=enhanceHome(base);
check(()=>assert.ok(enhanced.includes('Original homepage')));
check(()=>assert.equal((enhanced.match(/<h1>/g)||[]).length,1));
check(()=>assert.ok(enhanced.includes('href="/resources/"')));
check(()=>assert.throws(()=>enhanceHome('broken')));
const sitemap=enhanceSitemap('<?xml version="1.0"?><urlset><url><loc>https://liftorbit.app/</loc><lastmod>2026-10-15</lastmod></url></urlset>');
check(()=>assert.equal((sitemap.match(/<loc>/g)||[]).length,7));
check(()=>assert.equal(enhanceSitemap(sitemap),sitemap));
check(()=>assert.ok(sitemap.includes('2026-10-16')));
console.log(JSON.stringify({ok:true,release:RELEASE,unitChecks:checks,pages:pages.map(p=>p.path)},null,2));
