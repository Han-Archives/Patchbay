import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const root=process.env.PATCHBAY_ROOT || process.cwd();
const require=createRequire(root+'/app/apps/flow/package.json');
const {serve}=require('@hono/node-server');
const {chromium}=require('/private/tmp/patchbay-kg-browser/node_modules/playwright-core');
const core=await import(root+'/app/packages/core/dist/index.js');
const {createFlowApp}=await import(root+'/app/apps/flow/dist-server/server.js');
const out='/private/tmp/patchbay-overview-diagnose';
await fs.mkdir(out,{recursive:true});
const home=await fs.mkdtemp(path.join(os.tmpdir(),'pb-overview-'));
await core.ensureStudioInitialized(home);
const repo=path.join(home,'repo');await fs.mkdir(repo);
await core.registerProject(home,{alias:'demo',kind:'local_repo',path:repo,name:'가상 검증'});
let modelCalls=0;
const app=createFlowApp({studioHome:home,project:'demo',roomRunner:async()=>{modelCalls++;throw Error('No inference allowed')}});
const server=serve({fetch:app.fetch,port:0,hostname:'127.0.0.1'});
await new Promise(r=>server.listening?r():server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-first-run','--disable-background-networking','--use-mock-keychain']});
const results=[];
async function probe(name,url,overviewMode,live=false,uniqueKeys=false){
 const context=await browser.newContext({viewport:{width:1512,height:1100},reducedMotion:'reduce'});
 const errors=[],warnings=[];
 const page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')warnings.push(m.text())});
 let patchedBundle=0;
 if(uniqueKeys)await page.route('**/assets/index-*.js',async route=>{
  const response=await route.fetch();const original=await response.text();
  const needle='(0,x.jsx)(qF,{project:e,revision:t,suggestions:ve},e),(0,x.jsx)(LF,{project:e,revision:t+ee},e)';
  if(original.split(needle).length!==2)throw Error('Diagnostic bundle needle must match exactly once');
  const body=original.replace(needle,'(0,x.jsx)(qF,{project:e,revision:t,suggestions:ve},`tasks:${e}`),(0,x.jsx)(LF,{project:e,revision:t+ee},`history:${e}`)');
  patchedBundle++;await route.fulfill({response,body});
 });
 if(live)await page.route('**/api/todos/action',route=>route.fulfill({status:200,contentType:'application/json',body:'{}'}));
 if(overviewMode==='none')await page.route('**/api/overview?*',route=>route.fulfill({status:404,contentType:'application/json',body:'{"error":"가상 개요 없음"}'}));
 if(overviewMode==='document'||overviewMode==='refresh-race')await page.route('**/api/overview?*',async route=>{
  if(overviewMode==='refresh-race')await new Promise(r=>setTimeout(r,600));
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({content:'# 가상 프로젝트\n\n개요 진단용 문서입니다.\n\n## 목적\n\n화면 전환 확인',rel:'docs/개요.md'})});
 });
 await page.goto(url);
 await page.getByRole('button',{name:'메인 화면',exact:true}).click();
 await page.locator('.main-header').waitFor();
 await page.locator('.main-switch button').filter({hasText:'대시보드'}).click();
 await page.locator('.todo-pane').first().waitFor();
 await page.waitForTimeout(900);
 const samples=[];
 async function sample(stage){samples.push(await page.evaluate(stage=>({stage,view:document.querySelector('.main-shell')?.className,panes:document.querySelectorAll('.todo-pane').length,rows:document.querySelectorAll('.todo-row').length,overview:document.querySelectorAll('.main-overview').length,parents:[...document.querySelectorAll('.todo-pane')].map(el=>({className:el.parentElement?.className,visible:!!el.getClientRects().length})),children:[...document.querySelector('.main-shell')?.children??[]].map(el=>el.className)}),stage))}
 await sample('dashboard-initial');
 await page.screenshot({path:out+'/'+name+'-before.png',fullPage:true});
 for(let i=1;i<=5;i++){
  if(overviewMode==='refresh-race')await page.getByRole('button',{name:'새로고침',exact:true}).click();
  await page.locator('.main-switch button').filter({hasText:'개요'}).click();
  await page.waitForTimeout(150);await sample('overview-'+i+'-immediate');
  await page.waitForTimeout(650);await sample('overview-'+i+'-settled');
  if(i===5)await page.screenshot({path:out+'/'+name+'-overview.png',fullPage:true});
  await page.locator('.main-switch button').filter({hasText:'대시보드'}).click();
  await page.waitForTimeout(200);await sample('dashboard-'+i);
 }
 const result={name,overviewMode,live,uniqueKeys,patchedBundle,samples,errors,warnings};
 results.push(result);console.log(JSON.stringify({name,uniqueKeys,patchedBundle,overviewCounts:samples.filter(s=>s.stage.endsWith('-settled')).map(s=>s.panes),dashboardCounts:samples.filter(s=>s.stage.startsWith('dashboard')).map(s=>s.panes),errors}));
 await context.close();
}
try{
 if(process.argv.includes('--ab-only')){
  await probe('unique-keys-no-overview',base,'none',false,true);
  await probe('unique-keys-refresh-race',base,'refresh-race',false,true);
  const todos=await (await fetch(base+'/api/todos?alias=demo')).json();
  await fs.writeFile(out+'/ab-results.json',JSON.stringify({at:new Date().toISOString(),modelCalls,storedTodos:todos.todos?.length,results},null,2));
 }else{
 await probe('fixture-no-overview',base,'none');
 await probe('fixture-document',base,'document');
 await probe('fixture-refresh-race',base,'refresh-race');
 await probe('live-normal','http://127.0.0.1:4318','normal',true);
 await probe('live-fallback','http://127.0.0.1:4318','none',true);
 await fs.writeFile(out+'/results.json',JSON.stringify({at:new Date().toISOString(),modelCalls,results},null,2));
 }
}finally{await browser.close();await app.close();server.closeAllConnections();await new Promise(r=>server.close(r))}
