// Use a synthetic DOCX with a saved Word page boundary before the title 摘要.
const puppeteer=require(process.env.POW_PUPPETEER||'puppeteer-core');
const assert=require('node:assert/strict');
const fixture=process.env.POW_PAGINATION_DOCX;
if(!fixture)throw new Error('Set POW_PAGINATION_DOCX to the saved-page-break fixture.');
(async()=>{
 const browser=await puppeteer.launch({executablePath:process.env.POW_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport({width:1800,height:1600});await page.goto('http://127.0.0.1:8765');
  await page.waitForFunction(()=>document.querySelector('[name=body_size]')?.value==='12');
  await(await page.$('#document-file')).uploadFile(fixture);
  const verify=async(side)=>{
   await page.waitForFunction(side=>!document.querySelector('#'+side+'-preview').hidden,{timeout:120000},side);
   const frame=await(await page.$('#'+side+'-preview')).contentFrame();
   await frame.waitForFunction(()=>{
    const first=document.querySelector('[data-docx-page-wrapper][data-index="0"]');
    const second=document.querySelector('[data-docx-page-wrapper][data-index="1"]');
    return first?.innerText.includes('測試大學報告')&&second?.innerText.includes('摘要');
   },{timeout:15000});
   const text=await frame.$eval('[data-docx-page-wrapper][data-index="0"]',e=>e.innerText);
   assert(!text.includes('摘要'),side+' merged abstract into cover');
  };
  await verify('original');await page.click('#convert-preview');
  await page.waitForFunction(()=>document.querySelector('#converted-state').textContent==='已轉換，可編輯',{timeout:120000});
  await verify('converted');assert.deepEqual(errors,[]);
  console.log('PASS saved page boundary: original and converted cover exclude abstract; abstract on page 2');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});
