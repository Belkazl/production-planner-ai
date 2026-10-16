import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {pages,growthRoutes,enhanceHome} from '../growth.mjs';
import {conversionPages,conversionRoutes,enhanceResource,enhanceConversionHome,CONVERSION_RELEASE} from '../public-preview.mjs';
const base=process.env.LANDING_URL||'http://127.0.0.1:3000';
assert(['http://127.0.0.1:3000','https://liftorbit.app'].includes(base));
mkdirSync('artifacts/screenshots',{recursive:true});
const report={base,release:CONVERSION_RELEASE,pages:[],checks:[]};
const expected=new Map(pages.map(p=>[p.path,enhanceResource(growthRoutes.get(p.path).body,p.path)]));
for(const p of conversionPages)expected.set(p.path,conversionRoutes.get(p.path).body);
expected.set('/',enhanceConversionHome(enhanceHome(readFileSync('index.html','utf8'))));
const get=(path,opts={})=>fetch(base+path,{redirect:'manual',signal:AbortSignal.timeout(20000),...opts});
const health=await (await get('/health')).json();assert.equal(health.release,CONVERSION_RELEASE);
for(const [path,html] of expected){
 const r=await get(path);assert.equal(r.status,200,path);assert.equal(await r.text(),html,'published content differs: '+path);
 assert.equal(r.headers.get('x-content-sha256'),createHash('sha256').update(html).digest('hex'));assert.equal(r.headers.get('x-frame-options'),'DENY');
 assert(html.includes('rel="canonical" href="https://liftorbit.app'+path+'"'));assert.equal((html.match(/<h1(?:\s[^>]*)?>/g)||[]).length,1);
 for(const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)){JSON.parse(m[1]);assert(r.headers.get('content-security-policy').includes(createHash('sha256').update(m[1]).digest('base64')))}
 assert.equal((await get(path,{method:'HEAD'})).status,200);report.pages.push({path,status:200,sourceMatched:true});
}
const sitemap=await (await get('/sitemap.xml')).text();for(const path of expected.keys())assert(sitemap.includes('<loc>https://liftorbit.app'+path+'</loc>'));assert(!sitemap.includes('/embed/'));
assert.equal((await get('/not-a-real-page')).status,404);
const redirect=await get('/go/register?from=%2F',{method:'HEAD'});assert.equal(redirect.status,302);assert.equal(redirect.headers.get('location'),'https://liftorbit.app/demo/');
const embed=await get('/embed/production-capacity/');assert.equal(embed.status,200);assert.equal(embed.headers.get('x-frame-options'),null);assert(embed.headers.get('content-security-policy').includes('frame-ancestors *'));assert.equal(embed.headers.get('x-robots-tag'),'noindex');
const usage=(body,origin=base)=>get('/api/usage',{method:'POST',headers:{origin,'content-type':'application/json','sec-fetch-site':'same-origin'},body:JSON.stringify(body)});
assert.equal((await usage({event:'calculator_used',source:'/tools/production-capacity-calculator/'})).status,204);
assert.equal((await usage({event:'calculator_used',source:'/tools/production-capacity-calculator/',units:999})).status,403);
assert.equal((await usage({event:'calculator_used',source:'/tools/production-capacity-calculator/'},'https://untrusted.test')).status,403);
report.checks.push('exact source match and SEO on 10 pages','unreleased registration link goes to read-only tour','embed allowed only on public tool','no production values accepted by event endpoint');
const browser=await chromium.launch({headless:true});let host;
try{
 for(const width of [1440,375]){
  const context=await browser.newContext({viewport:{width,height:width===375?812:1000},acceptDownloads:true});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const path of expected.keys()){
   const r=await page.goto(base+path,{waitUntil:'networkidle',timeout:30000});assert.equal(r.status(),200);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'overflow '+path+' '+width);
   if(path==='/'){assert.equal(await page.locator('[data-trial-trigger]').count(),0);assert.equal(await page.locator('#trial-dialog').count(),0);assert(await page.locator('a[href="/demo/"]').count()>=4)}
   if(path==='/demo/'){
    for(let i=0;i<4;i++){await page.locator('[data-tour-step="'+i+'"]').click();assert.equal(await page.locator('[data-tour-panel="'+i+'"]').isVisible(),true);await page.waitForFunction(index=>{const img=document.querySelector('[data-tour-panel="'+index+'"] img');return img&&img.complete&&img.naturalWidth===1440},i,{timeout:15000});}
    await page.locator('[data-tour-step="0"]').click();
   }
   if(path==='/tools/production-capacity-calculator/'){
    assert.equal(await page.locator('#lo-load').innerText(),'80.9%');await page.locator('[name=units]').fill('1400');assert.equal(await page.locator('#lo-load').innerText(),'110.3%');
    const pending=page.waitForEvent('download');await page.locator('#lo-export-result').click();const download=await pending;const data=JSON.parse(readFileSync(await download.path(),'utf8'));assert.equal(data.inputs.units,1400);assert.equal(data.summary.plannedLoad,'110.3%');
    await page.evaluate(()=>window.print=()=>window.__printed=true);await page.locator('#lo-print-result').click();assert(await page.evaluate(()=>window.__printed));await page.locator('button[type=reset]').click();
   }
   const name=(path==='/'?'home':path.replaceAll('/','_'))+'-'+width+'.png';await page.screenshot({path:'artifacts/screenshots/'+name,fullPage:true});
  }
  assert.deepEqual(errors,[]);await context.close();
 }
 const context=await browser.newContext();const page=await context.newPage();host=createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<iframe src="'+base+'/embed/production-capacity/" width="1100" height="1600"></iframe>')});await new Promise(r=>host.listen(3002,'127.0.0.1',r));
 await page.goto('http://127.0.0.1:3002/');const frame=page.frameLocator('iframe');await frame.locator('#lo-load').waitFor();assert.equal(await frame.locator('#lo-load').innerText(),'80.9%');await frame.locator('[name=units]').fill('1400');assert.equal(await frame.locator('#lo-load').innerText(),'110.3%');await context.close();
 const privacy=await browser.newContext();await privacy.addInitScript(()=>Object.defineProperty(navigator,'globalPrivacyControl',{value:true}));const p=await privacy.newPage();const events=[];p.on('request',r=>{if(r.url().includes('/api/usage'))events.push(r.url())});await p.goto(base+'/tools/production-capacity-calculator/',{waitUntil:'networkidle'});await p.locator('[name=units]').fill('1200');await p.waitForTimeout(500);assert.equal(events.length,0);await privacy.close();
 report.checks.push('20 desktop/mobile renders without horizontal overflow','calculator JSON export and print control','four real tour images','cross-origin embedding works','Global Privacy Control suppresses browser events');report.ok=true;
}finally{await browser.close();if(host)host.close();writeFileSync('artifacts/conversion-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
