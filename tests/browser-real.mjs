import {chromium} from 'playwright';
import assert from 'node:assert/strict';
// No intercepted requests: exercise the actual prepared recording and renderer.
const browser=await chromium.launch({headless:true,args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[],sensorRequests=new Set();
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(/demo\/\d+\.(bin|jpg)/.test(r.url()))sensorRequests.add(r.url())});
const base=process.env.RANT_TEST_URL??'http://127.0.0.1:4173/';
async function seek(index){
  await page.locator('#timeline').evaluate((el,i)=>{el.value=String(i);el.dispatchEvent(new Event('input',{bubbles:true}))},index);
  await page.waitForFunction(i=>document.querySelector('#frame')?.textContent==='FRAME '+String(i).padStart(3,'0')&&document.querySelector('#camera img')?.alt==='Camera frame '+String(i).padStart(10,'0')&&Number(document.querySelector('#count')?.textContent.replaceAll(',',''))>10000,index,{timeout:30000});
}
async function imageFingerprint(){return page.locator('#camera img').evaluate(img=>{const c=document.createElement('canvas');c.width=32;c.height=12;c.getContext('2d').drawImage(img,0,0,32,12);return Array.from(c.getContext('2d').getImageData(0,0,32,12).data).join(',')})}
try{
 await page.goto(base,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#mode')?.textContent==='KARLSRUHE · DRIVE 0005',{timeout:60000});
 if(await page.locator('#play').textContent()==='Ⅱ')await page.locator('#play').click();
 await seek(0);
 assert.equal(await page.locator('#timeline').getAttribute('max'),'153');
 assert.ok(sensorRequests.size<154,'startup must not eagerly fetch the recording');
 const first=await imageFingerprint();
 assert.ok(parseInt((await page.locator('#projection-status').textContent()).replaceAll(',',''))>1000,'real calibrated returns project into the image');
 await seek(35);assert.notEqual(await imageFingerprint(),first,'camera contains actual motion');
 await page.locator('#accumulate').check();
 await page.waitForFunction(()=>document.querySelector('#accumulation-status')?.textContent.startsWith('20 / 20 scans'),null,{timeout:30000});
 const reconstructed=await page.locator('#accumulation-status').textContent();
 assert.ok(Number(reconstructed.split(' · ')[1].replace(/[^0-9]/g,''))>100000,'history is visibly denser than one scan');
 await page.screenshot({path:process.env.RANT_SCREENSHOT??'/tmp/rant-real-desktop.png',fullPage:true});
 await page.locator('#accumulate').uncheck();
 await page.locator('#next-frame').click();
 await page.waitForFunction(()=>document.querySelector('#frame')?.textContent==='FRAME 036');
 await page.locator('#prev-frame').click();
 await page.waitForFunction(()=>document.querySelector('#frame')?.textContent==='FRAME 035');
 await page.locator('#play').click();
 await page.waitForFunction(()=>Number(document.querySelector('#timeline')?.value)>=40,null,{timeout:30000});
 await page.locator('#play').click();
 const current=Number(await page.locator('#timeline').inputValue());
 await seek(current);
 assert.match(await page.locator('#camera-sync').textContent(),/SYNC/);
 for(const i of [130,10,80,0])await seek(i);
 assert.match(await page.locator('#status').textContent(),/0 failed/);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/rant-real-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile horizontal layout fits');
 assert.deepEqual(errors,[]);
 console.log('Real browser integration passed: 154 paired frames, calibrated projection, distinct images, 20-scan reconstruction, playback, seeks, mobile. '+reconstructed);
}finally{await browser.close()}
