import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {STARTER_VERSION} from '../starter-demo.mjs';
const base=process.env.APP_URL||'http://127.0.0.1:8080';
assert(['http://127.0.0.1:8080','https://app.liftorbit.app'].includes(base));
mkdirSync('artifacts/screenshots',{recursive:true});
const report={base,release:STARTER_VERSION,checks:[],screenshots:[],visibleRussian:[]};
const browser=await chromium.launch({headless:true});const accounts=[];
const project=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('prodplan.projects.v2')||'[]'));
const hit=(page,path,body)=>page.evaluate(async({path,body})=>{const r=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()}},{path,body});
async function capture(page,name){await page.waitForTimeout(1200);await page.screenshot({path:'artifacts/screenshots/'+name+'.png',fullPage:false});report.screenshots.push(name+'.png');const russian=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.children.length===0&&!e.closest('.pp-i18n-route-label')&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0&&/[\u0400-\u04ff]/.test(e.textContent)).map(e=>e.textContent.trim()).filter(Boolean).slice(0,25));report.visibleRussian.push({screen:name,labels:russian});}
async function register(label){
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
 const account={context,page,email:'qa-starter-'+label+'-'+randomUUID()+'@example.invalid',password:randomUUID()+'Zz9!'};accounts.push(account);
 await page.goto(base+'/?register=1',{waitUntil:'domcontentloaded',timeout:60000});await page.locator('#companyWrap').waitFor({state:'visible',timeout:10000});
 await page.locator('#email').fill(account.email);await page.locator('#password').fill(account.password);await page.locator('#company').fill('LiftOrbit internal onboarding QA');
 const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/register',{timeout:60000});await page.locator('#go').click();const registration=await pending;
 assert.equal(registration.status(),200,'registration HTTP status');report.checks.push('registration '+label+': '+registration.headers()['x-liftorbit-starter']);
 await page.locator('#ppProtectedLogout').waitFor({timeout:60000});
 await page.waitForFunction(()=>{const p=JSON.parse(localStorage.getItem('prodplan.projects.v2')||'[]');return p.length===1&&p[0].demoTemplate==='starter-en-2026-10-16-v1'},{timeout:30000});
 await page.waitForFunction(()=>document.getElementById('opt')&&!document.getElementById('opt').disabled,{timeout:30000});
 const rows=await project(page);assert.equal(rows.length,1);assert.equal(rows[0].model.orders.length,3);assert.equal(rows[0].model.equipment.length,5);assert.equal(/[\u0400-\u04ff]/.test(JSON.stringify(rows[0].model)),false);
 const model=await hit(page,'/api/model');assert.equal(model.status,200);assert.equal(model.data.model.orders.length,3);assert.notEqual(model.data.model_ready,false);
 report.checks.push('private English demo hydrated and imported '+label);return account;
}
async function build(page){await page.locator('.nav span[data-pp-en-label="Planning"]').click();await page.locator('#opt').click();await page.waitForFunction(()=>{const p=JSON.parse(localStorage.getItem('prodplan.projects.v2')||'[]')[0];return p&&p.lastPlan&&p.lastPlan.valid!==false&&!p.lastPlan.partial},{timeout:180000});await page.waitForFunction(()=>!document.getElementById('opt').disabled,{timeout:180000});return (await project(page))[0].lastPlan;}
try{
 const a=await register('A'),b=await register('B');const beforeB=await project(b.page),beforeA=await project(a.page);assert.notEqual(beforeA[0].id,beforeB[0].id);report.checks.push('independent project IDs');
 await capture(a.page,'starter-overview');await a.page.locator('#loStarterGuide [data-orders]').click();await capture(a.page,'starter-orders');
 await a.page.locator('.side .item[data-pp-en-label="Equipment"]').click();await capture(a.page,'starter-equipment');
 const plan=await build(a.page),ops=plan.generic_operations||plan.operations||[];assert(ops.length>=15,'real plan must include operations');assert(ops.some(o=>o.is_setup||o.phase==='setup'),'real plan must include setup');
 report.plan={operationCount:ops.length,setupCount:ops.filter(o=>o.is_setup||o.phase==='setup').length,durationMinutes:plan.duration_minutes,valid:plan.valid!==false};await capture(a.page,'starter-schedule');
 const planned=await project(a.page),retry=await hit(a.page,'/api/onboarding/starter',{});assert.equal(retry.status,200);assert.equal(retry.data.created,false);assert.deepEqual(await project(a.page),planned);assert.deepEqual(await project(b.page),beforeB);
 await a.page.locator('.side .item[data-pp-en-label="Orders"]').click();await a.page.locator('[data-oarea]').first().fill('150');
 const saved=a.page.waitForResponse(r=>new URL(r.url()).pathname==='/api/project/model/import'&&r.request().method()==='POST',{timeout:45000});await a.page.locator('[data-pp-save]').click();assert.equal((await saved).status(),200);
 await a.page.waitForFunction(()=>{const p=JSON.parse(localStorage.getItem('prodplan.projects.v2')||'[]')[0];return p&&Number(p.model.orders[0].area)===150},{timeout:15000});
 const changed=await build(a.page);assert(changed.valid!==false);assert.deepEqual(await project(b.page),beforeB);report.checks.push('edit quantity in UI; rebuild real plan; other account unchanged');
 await a.page.reload({waitUntil:'domcontentloaded',timeout:60000});await a.page.locator('#ppProtectedLogout').waitFor({timeout:60000});await a.page.waitForFunction(()=>{const p=JSON.parse(localStorage.getItem('prodplan.projects.v2')||'[]');return p.length===1&&p[0].lastPlan},{timeout:30000});assert.equal((await project(a.page))[0].id,planned[0].id);report.checks.push('saved plan persists; no duplicate on reload');
 await a.page.setViewportSize({width:375,height:812});await capture(a.page,'starter-mobile');
 await a.page.locator('#ppProtectedLogout').click();await a.page.locator('#loginTab').waitFor({timeout:30000});assert.equal((await hit(a.page,'/api/db-storage')).status,401);
 await a.page.locator('#email').fill(a.email);await a.page.locator('#password').fill(a.password);await a.page.locator('#go').click();await a.page.locator('#ppProtectedLogout').waitFor({timeout:60000});assert.equal((await project(a.page))[0].id,planned[0].id);report.checks.push('logout revokes access; sign-in preserves data');
 assert.deepEqual(report.visibleRussian.filter(x=>x.labels.length),[],'English screens must not have Russian labels');report.ok=true;
}catch(e){report.ok=false;let message=String(e.stack||e);for(const a of accounts){message=message.replaceAll(a.password,'[redacted]').replaceAll(a.email,'[synthetic account]')}report.error=message;console.error(message);process.exitCode=1;for(let i=0;i<accounts.length;i++){try{await accounts[i].page.screenshot({path:'artifacts/debug-'+i+'.png',fullPage:false})}catch{}}}
finally{writeFileSync('artifacts/starter-report.json',JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report,null,2));}
