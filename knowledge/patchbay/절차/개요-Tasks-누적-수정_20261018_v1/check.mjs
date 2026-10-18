import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';

const root=process.env.PATCHBAY_ROOT || process.cwd();
const out=process.env.PATCHBAY_CHECK_OUT || '/private/tmp/patchbay-overview-fixed-check';
const require=createRequire(path.join(root,'app/apps/flow/package.json'));
const {serve}=require('@hono/node-server');
const {chromium}=require(process.env.PLAYWRIGHT_CORE || '/private/tmp/patchbay-kg-browser/node_modules/playwright-core');
const core=await import(path.join(root,'app/packages/core/dist/index.js'));
const {createFlowApp}=await import(path.join(root,'app/apps/flow/dist-server/server.js'));
await fs.mkdir(out,{recursive:true});
await fs.mkdir(path.join(out,'live'),{recursive:true});
const home=await fs.mkdtemp(path.join(os.tmpdir(),'pb-overview-fixed-'));
await core.ensureStudioInitialized(home);
const repo=path.join(home,'repo');await fs.mkdir(repo);
await core.registerProject(home,{alias:'demo',kind:'local_repo',path:repo,name:'가상 전환 검증'});
let modelCalls=0;
const app=createFlowApp({studioHome:home,project:'demo',roomRunner:async()=>{modelCalls++;throw Error('No model calls allowed')}});
const server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:0});
await new Promise(r=>server.listening?r():server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-first-run','--disable-background-networking','--use-mock-keychain']});
const results=[];
// 자동 제안 동기화는 생략된 inactive를 false로 정규화할 수 있다.
const stableTodos=async()=> (await core.readTodos(home,'demo')).map(todo=>({...todo,inactive:todo.inactive??false}));
async function probe(name,{mode='none',width=1512,live=false,checkCleanup=false}={}){
 const context=await browser.newContext({viewport:{width,height:1100},reducedMotion:'reduce'});
 const page=await context.newPage();
 const errors=[],samples=[];
 let blockedLiveWrites=0,todoReads=0;
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(new URL(r.url()).pathname==='/api/todos')todoReads++});
 if(live)await page.route('**/api/**',route=>{
  if(['GET','HEAD'].includes(route.request().method()))return route.continue();
  blockedLiveWrites++;return route.fulfill({status:200,contentType:'application/json',body:'{}'});
 });
 if(mode!=='normal')await page.route('**/api/overview?*',async route=>{
  if(mode==='race')await new Promise(r=>setTimeout(r,1000));
  const status=mode==='none'?404:mode==='failure'?503:200;
  const body=status===200?{content:'# 가상 프로젝트\n\n전환 회귀 검증용 문서\n\n## 목적\n\n반복 전환 확인',rel:'docs/개요.md'}:{error:'가상 개요 조회 실패'};
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 const snapshot=async stage=>{
  const value=await page.evaluate(stage=>({stage,dashboard:document.querySelectorAll('.main-dashboard-grid').length,overview:document.querySelectorAll('.main-overview').length,tasks:document.querySelectorAll('.todo-pane').length,history:document.querySelectorAll('.history-card').length,menus:document.querySelectorAll('.todo-menu').length}),stage);
  samples.push(value);return value;
 };
 const expectView=async (view,stage)=>{
  const s=await snapshot(stage);const dashboard=view==='dashboard';
  assert.equal(s.tasks,dashboard?1:0,name+': Tasks count at '+stage);
  assert.equal(s.history,dashboard?1:0,name+': History count at '+stage);
  assert.equal(s.dashboard,dashboard?1:0,name+': dashboard root at '+stage);
  assert.equal(s.overview,dashboard?0:1,name+': overview root at '+stage);
  assert.equal(s.menus,0,name+': stale portal at '+stage);
 };
 try{
  await page.goto(live?(process.env.PATCHBAY_URL || 'http://127.0.0.1:4318'):base);
  await page.getByRole('button',{name:'메인 화면',exact:true}).click();
  await page.locator('.main-header').waitFor();
  const select=view=>page.locator('.main-switch').getByRole('button',{name:view==='dashboard'?'대시보드':'개요',exact:true}).click();
  await select('dashboard');
  await page.locator('.todo-pane').waitFor();
  if(!live)await page.locator('.todo-row').first().waitFor();
  await page.waitForTimeout(mode==='race'?1200:250);
  const before=live?null:await stableTodos();
  await expectView('dashboard','initial');
  for(let i=1;i<=5;i++){
   if(mode==='race')await page.getByRole('button',{name:'새로고침',exact:true}).click();
   if(i===1 && await page.locator('.todo-more').count()){
    await page.locator('.todo-more').first().click();await page.locator('.todo-menu').waitFor();
   }
   await select('overview');await expectView('overview','overview-'+i+'-immediate');
   await page.waitForTimeout(mode==='race'?1200:100);
   await expectView('overview','overview-'+i+'-settled');
   if(i===5 && (name==='fallback404'||name==='mobile404'||live))await page.screenshot({path:path.join(out,live?'live':'',name+'-overview.png'),fullPage:true});
   await select('dashboard');await expectView('dashboard','dashboard-'+i);
  }
  let readsAfterUnmount=null;
  if(checkCleanup){
   await select('overview');await page.waitForTimeout(300);
   const start=todoReads;await page.waitForTimeout(3400);readsAfterUnmount=todoReads-start;
   assert.equal(readsAfterUnmount,0,'Todo polling must stop on overview');
   await expectView('overview','unmounted-after-poll-period');
  }
  if(!live)assert.deepEqual(await stableTodos(),before,'Stored todos must remain unchanged');
  assert.equal(errors.length,0,errors.join('\n'));
  const result={name,mode,width,live,cycles:5,samples,readsAfterUnmount,storedTodosUnchanged:!live,blockedLiveWrites,errors};
  results.push(result);console.log(JSON.stringify({name,cycles:5,passed:true,readsAfterUnmount}));
 }catch(e){await page.screenshot({path:path.join(out,name+'-failure.png'),fullPage:true});throw e}
 finally{await context.close()}
}
try{
 await probe('fallback404',{checkCleanup:true});
 await probe('fallback503',{mode:'failure'});
 await probe('document',{mode:'document'});
 await probe('refresh-race',{mode:'race'});
 await probe('mobile404',{width:390});
 await probe('live-fallback404',{live:true});
 await probe('live-normal',{mode:'normal',live:true});
 assert.equal(modelCalls,0);
 const result={at:new Date().toISOString(),scenarios:results.length,roundTrips:results.reduce((n,r)=>n+r.cycles,0),modelCalls,results};
 await fs.writeFile(path.join(out,'validation.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({scenarios:result.scenarios,roundTrips:result.roundTrips,modelCalls,passed:true}));
}finally{
 await browser.close();await app.close();server.closeAllConnections();await new Promise(r=>server.close(r));
}
