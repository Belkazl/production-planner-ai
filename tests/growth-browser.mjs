import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {pages} from '../growth.mjs';
const base=(process.env.LANDING_URL||'http://127.0.0.1:3000').replace(/\/$/,'');
assert.ok(['http://127.0.0.1:3000','https://liftorbit.app'].includes(base));
mkdirSync('artifacts/screenshots',{recursive:true});
const browser=await chromium.launch({headless:true});const results=[];
try{
 for(const width of [1440,375]){
  const context=await browser.newContext({viewport:{width,height:width===375?812:1000},reducedMotion:'reduce'});
  const page=await context.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  for(const path of ['/',...pages.map(p=>p.path)]){
   const res=await page.goto(base+path,{waitUntil:'networkidle',timeout:30000});assert.equal(res.status(),200);
   assert.equal(await page.locator('h1').count(),1);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Overflow '+path+' at '+width);
   if(path==='/')assert.ok(await page.locator('#lo-resources-title').count());
   if(path.startsWith('/tools/')){
    assert.equal(await page.locator('#lo-load').innerText(),'80.9%');
    await page.locator('#lo-overload-example').click();assert.equal(await page.locator('#lo-load').innerText(),'110.3%');
    assert.equal(await page.locator('#lo-headroom').innerText(),'7 h');
    await page.locator('button[type=reset]').click();await page.waitForTimeout(50);
    await page.locator('[name=availability]').fill('0');assert.equal(await page.locator('#lo-results').isHidden(),true);
    await page.locator('button[type=reset]').click();await page.waitForTimeout(50);
    await page.locator('[name=shifts]').fill('4');assert.ok((await page.locator('#lo-error').innerText()).includes('24 hours'));
    await page.locator('button[type=reset]').click();await page.waitForTimeout(50);
    assert.equal(await page.locator('#lo-load').innerText(),'80.9%');
   }
   const name=(path==='/'?'home':path.replace(/^\/|\/$/g,'').replaceAll('/','-'))+'-'+width+'.png';
   await page.screenshot({path:'artifacts/screenshots/'+name,fullPage:true});
   results.push({path,width,status:200,overflow:false,screenshot:name});
  }
  assert.deepEqual(errors,[]);await context.close();
 }
}finally{await browser.close();}
writeFileSync('artifacts/growth-browser.json',JSON.stringify({ok:true,base,results},null,2));console.log('PASS: 14 live browser renders and calculator interaction checks');
