import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync,mkdirSync} from 'node:fs';
import {pages,RELEASE,growthRoutes} from '../growth.mjs';
const base=(process.env.LANDING_URL||'http://127.0.0.1:3000').replace(/\/$/,'');
assert.ok(['http://127.0.0.1:3000','https://liftorbit.app'].includes(base),'Unexpected test target');
const report={base,release:RELEASE,pages:[],checks:[]};
const get=(path,options={})=>fetch(base+path,{redirect:'manual',signal:AbortSignal.timeout(20000),...options});
const health=await (await get('/health')).json();assert.equal(health.release,RELEASE);
for(const path of ['/',...pages.map(p=>p.path)]){
 const res=await get(path); assert.equal(res.status,200,path);
 const html=await res.text();assert.ok(res.headers.get('content-type').startsWith('text/html'));
 const hash=createHash('sha256').update(html).digest('hex');assert.equal(res.headers.get('x-content-sha256'),hash);
 assert.equal((html.match(/<h1(?:\s[^>]*)?>/g)||[]).length,1,path);
 assert.ok(html.includes('rel="canonical" href="https://liftorbit.app'+path+'"'));
 assert.ok(!/content="noindex/i.test(html));
 for(const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)){
  JSON.parse(m[1]); const h=createHash('sha256').update(m[1]).digest('base64');assert.ok(res.headers.get('content-security-policy').includes("'sha256-"+h+"'"));
 }
 if(path!=='/') assert.equal(html,growthRoutes.get(path).body,'Deployed page differs from tested source');
 else {assert.ok(html.includes('google-site-verification'));assert.ok(html.includes('lo-resources-title'));}
 const head=await get(path,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
 report.pages.push({path,status:res.status,sha256:hash,canonical:true,head:true,schemaAndCsp:true});
}
const xml=await (await get('/sitemap.xml')).text();
for(const p of pages)assert.ok(xml.includes('<loc>https://liftorbit.app'+p.path+'</loc>'));
assert.equal(new Set([...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1])).size,7);
const robots=await (await get('/robots.txt')).text();assert.ok(robots.includes('https://liftorbit.app/sitemap.xml'));assert.ok(!/^Disallow:\s*\/$/m.test(robots));
for(const path of ['/growth.css','/capacity-calculator.js','/favicon.svg','/site.css','/site.js','/llms.txt','/65dead239d02c66083c4a583bb7b69c432fb9582.txt']){assert.equal((await get(path)).status,200,path);}
assert.equal((await get('/not-a-page-growth-qa')).status,404);
assert.equal((await get('/resources/',{method:'POST'})).status,405);
const slash=await get('/resources');assert.equal(slash.status,308);assert.equal(slash.headers.get('location'),'https://liftorbit.app/resources/');
const outbound=await get('/go/planner?from=%2Fresources%2F',{method:'HEAD'});assert.equal(outbound.status,302);assert.equal(outbound.headers.get('location'),'https://app.liftorbit.app/');
report.checks=['sitemap includes seven unique pages','robots allows crawl','assets available','404 and 405 preserved','canonical redirect','planner link fixed-target redirect'];
report.ok=true;mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/growth-http.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
