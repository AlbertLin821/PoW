// Run against localhost with POW_TEST_DOCX pointing to a two-paragraph DOCX fixture.
const puppeteer=require(process.env.POW_PUPPETEER||'puppeteer-core');
const assert=require('node:assert/strict');
const fixture=process.env.POW_TEST_DOCX;
if(!fixture)throw new Error('Set POW_TEST_DOCX to a disposable two-paragraph DOCX fixture.');
const suggestions=[
 {paragraph_id:'p-1',role:'heading1',reason:'測試章標題',needs_review:true},
 {paragraph_id:'p-2',role:'body',reason:'測試正文',needs_review:false}
];
(async()=>{
 const browser=await puppeteer.launch({executablePath:process.env.POW_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage();const errors=[];const calls=[];let mode='success';let release;
  await page.setViewport({width:1600,height:900});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',dialog=>dialog.accept());
  await page.setRequestInterception(true);
  page.on('request',async request=>{
   const url=new URL(request.url());
   if(url.pathname==='/api/models')return request.respond({contentType:'application/json',body:JSON.stringify({models:['test-model']})});
   if(url.pathname.endsWith('/ai')){
    calls.push('ai');
    if(mode==='delay')await new Promise(resolve=>release=resolve);
    try{return await request.respond({status:mode==='failure'?502:200,contentType:'application/json',body:JSON.stringify(mode==='failure'?{detail:'測試模型離線'}:{suggestions})});}catch{return;}
   }
   if(url.pathname.endsWith('/preview'))calls.push(JSON.parse(request.postData()));
   await request.continue();
  });
  const load=async()=>{
   await page.goto('http://127.0.0.1:8765');
   await page.waitForFunction(()=>document.querySelector('[name=body_size]')?.value==='12');
   await(await page.$('#document-file')).uploadFile(fixture);
   await page.waitForFunction(()=>document.querySelector('#filename').hidden===false);
  };
  const configure=async()=>{
   await page.click('#model-indicator');await page.click('#connect');
   await page.waitForFunction(()=>document.querySelector('#model-status').textContent.includes('已連接'));
   await page.type('#model','test-model');
  };
  const convert=async()=>{
   await page.click('#convert-preview');
   await page.waitForFunction(()=>document.querySelector('#converted-state').textContent==='已轉換，可編輯',{timeout:120000});
  };
  await load();assert.equal(await page.$eval('#review',e=>e.open),false);
  assert.equal(await page.$eval('#settings-panel',e=>e.hidden),false);
  assert.equal(await page.$eval('#settings-panel',e=>e.getBoundingClientRect().left),0);
  assert.equal(await page.$('#analysis-mode'),null);
  await convert();assert.equal(calls.length,1);assert.equal(calls[0].selections.length,2);
  assert.match(await page.$eval('#notice',e=>e.textContent),/規則分析與轉換/);
  console.log('PASS rule analysis and conversion in one click');

  await load();await configure();calls.length=0;
  await page.click('#convert-preview');await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('同意'));
  assert.equal(calls.length,0);
  await page.click('#ai-consent');await page.click('#toggle-settings');
  await convert();assert.equal(calls[0],'ai');assert.equal(calls[1].selections[0].role,'heading1');
  assert.match(await page.$eval('#inspect-paragraphs',e=>e.title),/1 段待確認/);
  console.log('PASS consent gate and AI then conversion in one click');

  if(await page.$eval('#settings-panel',e=>e.hidden))await page.click('#toggle-settings');
  await page.click('#inspect-paragraphs');assert.equal(await page.$eval('#filter',e=>e.value),'review');
  assert.equal(await page.$$eval('.paragraph',es=>es.length),1);
  assert.equal(await page.$eval('.paragraph-head strong',e=>e.textContent),'第 1 段');
  await page.select('select[data-id="p-1"]','heading2');calls.length=0;
  await page.click('#toggle-settings');await convert();assert.equal(calls[1].selections[0].role,'heading2');
  assert.equal(await page.$eval('#ai-consent',e=>e.checked),true);
  await page.$eval('[name=body_size]',e=>{e.value='13';e.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal(await page.$eval('#ai-consent',e=>e.checked),true);
  await page.click('#clear-file');await(await page.$('#document-file')).uploadFile(fixture);
  await page.waitForFunction(()=>document.querySelector('#filename').hidden===false);
  assert.equal(await page.$eval('#ai-consent',e=>e.checked),true);
  console.log('PASS review filter, human labels, manual override and consent scope');

  mode='failure';calls.length=0;await page.click('#convert-preview');
  await page.waitForFunction(()=>document.querySelector('#converted-state').textContent==='分析失敗，未轉換');
  assert.deepEqual(calls,['ai']);assert.equal(await page.$eval('#convert-preview',e=>e.disabled),false);
  assert.equal(await page.$eval('#connection',e=>e.dataset.state),'error');
  console.log('PASS model failure stops conversion and allows retry');

  mode='delay';calls.length=0;await page.click('#convert-preview');
  await page.waitForFunction(()=>document.querySelector('#converted-state').textContent==='分析中');
  while(!release)await new Promise(resolve=>setTimeout(resolve,20));
  await page.click('#cancel-ai');release();release=null;
  await page.waitForFunction(()=>!document.querySelector('#convert-preview').disabled);
  assert.deepEqual(calls,['ai']);assert.equal(await page.$eval('#download-edited',e=>e.hidden),true);
  console.log('PASS cancellation ignores late AI and does not convert');

  calls.length=0;await page.click('#convert-preview');
  await page.waitForFunction(()=>document.querySelector('#converted-state').textContent==='分析中');
  while(!release)await new Promise(resolve=>setTimeout(resolve,20));
  await page.$eval('[name=body_size]',e=>{e.value='14';e.dispatchEvent(new Event('input',{bubbles:true}));});release();release=null;
  await page.waitForFunction(()=>!document.querySelector('#convert-preview').disabled);
  assert.deepEqual(calls,['ai']);
  await page.click('#model-indicator');await page.type('#model','-changed');assert.equal(await page.$eval('#ai-consent',e=>e.checked),false);
  console.log('PASS settings mutation cancels in-flight work; model changes reset consent');
  await page.click('#toggle-settings');
  for(const width of [320,375,1920]){await page.setViewport({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight));}
  assert.deepEqual(errors,[]);console.log('PASS responsive layout and no JavaScript errors');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});
