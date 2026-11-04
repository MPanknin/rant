import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {verifyTrackWorkflow} from './track-workflow.mjs';
import {openView,closeView,verifyMinimalWorkspace} from './ui-workflow.mjs';
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
 if(process.env.RANT_EXPECTED_COMMIT){
  const revision=await page.request.get(new URL('revision.txt?v='+process.env.RANT_EXPECTED_COMMIT,base).href);
  assert.equal((await revision.text()).trim(),process.env.RANT_EXPECTED_COMMIT,'deployed revision matches the commit');
 }
 await page.goto(base+(process.env.RANT_EXPECTED_COMMIT?'?v='+process.env.RANT_EXPECTED_COMMIT:''),{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#mode')?.textContent==='KARLSRUHE · DRIVE 0005',{timeout:60000});
 if(await page.locator('#play').textContent()==='Ⅱ')await page.locator('#play').click();
 await seek(0);
 assert.equal(await page.locator('#timeline').getAttribute('max'),'153');
 assert.ok(sensorRequests.size<154,'startup must not eagerly fetch the recording');
 const first=await imageFingerprint();
 await openView(page);await page.locator('#project-cloud').check();await closeView(page);
 assert.ok(parseInt((await page.locator('#projection-status').textContent()).replaceAll(',',''))>1000,'real calibrated returns project into the image');
 await seek(35);assert.notEqual(await imageFingerprint(),first,'camera contains actual motion');
 await openView(page);await page.locator('#accumulate').check();await closeView(page);
 await page.waitForFunction(()=>document.querySelector('#accumulation-status')?.textContent.startsWith('20 / 20 scans'),null,{timeout:30000});
 const reconstructed=await page.locator('#accumulation-status').textContent();
 assert.ok(Number(reconstructed.split(' · ')[1].replace(/[^0-9]/g,''))>100000,'history is visibly denser than one scan');
 await page.screenshot({path:process.env.RANT_SCREENSHOT??'/tmp/rant-real-desktop.png',fullPage:true});
 await openView(page);await page.locator('#accumulate').uncheck();await closeView(page);
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
 await verifyTrackWorkflow(page,seek,base);
 await openView(page);await page.locator('#project-cloud').uncheck();await closeView(page);
 await page.locator('#track-select').selectOption('1');
 await verifyMinimalWorkspace(page,seek,base);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/rant-real-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile horizontal layout fits');
 await page.locator('#track-select').selectOption('1');assert.equal(await page.locator('#track-panel').isVisible(),true);
 await page.locator('#follow-track').check();await page.locator('#clear-track').click();
 await page.locator('#annotate-mode').click();assert.equal(await page.locator('#annotation-panel').isVisible(),true);
 await page.locator('#label').fill('Mobile marker');const mobileCanvas=await page.locator('#view canvas').boundingBox();await page.mouse.click(mobileCanvas.x+mobileCanvas.width*.5,mobileCanvas.y+mobileCanvas.height*.35);assert.match(await page.locator('#notes').textContent(),/Mobile marker/);await page.locator('#close-annotations').click();
 await page.locator('#open-recordings').click();assert.equal(await page.locator('#recordings-dialog').isVisible(),true);await page.keyboard.press('Escape');
 assert.deepEqual(errors,[]);
 console.log('Real browser integration passed: 154 paired frames, calibrated projection, distinct images, 20-scan reconstruction, playback, seeks, mobile. '+reconstructed);
}finally{await browser.close()}
