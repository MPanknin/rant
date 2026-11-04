import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({headless:true,args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage();
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const header='VERSION .7\nFIELDS x y z intensity\nSIZE 4 4 4 4\nTYPE F F F F\nCOUNT 1 1 1 1\nWIDTH 2\nHEIGHT 1\nPOINTS 2\nDATA binary\n';
const pcd=Buffer.alloc(Buffer.byteLength(header)+32);
pcd.write(header,0,'utf8');
for(let i=0;i<8;i++)pcd.writeFloatLE(i,Buffer.byteLength(header)+i*4);
let requests=0;
await page.addInitScript(()=>{window.RANT_STREAM={base:'https://mock.rant.test/',count:8,source:'smoke fixture'}});
await page.route('https://mock.rant.test/**',async route=>{
  requests++;
  await new Promise(resolve=>setTimeout(resolve,20));
  await route.fulfill({status:200,body:pcd,contentType:'application/octet-stream'});
});
try{
  await page.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded'});
  await page.locator('#play').click(); // stop auto-play to make seeks deterministic
  await page.waitForFunction(()=>document.querySelector('#count')?.textContent==='2',null,{timeout:15000});
  for(const index of [7,2,6,0,5,1]){
    await page.locator('#timeline').evaluate((slider,i)=>{slider.value=String(i);slider.dispatchEvent(new Event('input',{bubbles:true}))},index);
    await page.waitForFunction(i=>document.querySelector('#frame')?.textContent==='FRAME '+String(i).padStart(3,'0')&&document.querySelector('#count')?.textContent==='2',index,{timeout:10000});
  }
  await page.locator('#stream').click();
  await page.waitForFunction(()=>document.querySelector('#count')?.textContent==='2',null,{timeout:10000});
  await page.locator('#play').click(); // stop newly started playback
  assert.ok(requests>0,'expected mocked frame requests');
  assert.deepEqual(errors,[],'browser console exceptions');
  console.log('Browser smoke passed: load, seek, restart, rendering');
}finally{await browser.close()}
