import assert from 'node:assert/strict';
export async function openView(page){if(!await page.locator('#view-options').evaluate(el=>el.open))await page.locator('#view-options > summary').click()}
export async function closeView(page){if(await page.locator('#view-options').evaluate(el=>el.open))await page.locator('#view-options > summary').click()}
export async function verifyMinimalWorkspace(page,seek,base){
 await page.locator('#clear-track').click();
 assert.equal(await page.locator('#track-panel').isVisible(),false);
 assert.equal(await page.locator('#point-panel').isVisible(),false);
 assert.equal(await page.locator('#annotation-panel').isVisible(),false);
 assert.equal(await page.locator('#tool-feedback').isVisible(),false);
 assert.equal(await page.locator('#status').isVisible(),false);
 assert.equal(await page.locator('#frame-metadata').isVisible(),false);
 await page.screenshot({path:'/tmp/rant-real-minimal.png',fullPage:true});
 // Native modal focus and Escape; playback shortcuts must not leak into a dialog.
 await page.locator('#open-info').click();
 assert.equal(await page.locator('#info-dialog').isVisible(),true);
 const frame=await page.locator('#timeline').inputValue();
 await page.locator('#info-dialog h2').click();await page.keyboard.press('ArrowRight');
 assert.equal(await page.locator('#timeline').inputValue(),frame);
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('#info-dialog').isVisible(),false);
 assert.equal(await page.locator('#open-info').evaluate(el=>el===document.activeElement),true);
 await openView(page);await page.keyboard.press('Escape');
 assert.equal(await page.locator('#view-options').evaluate(el=>el.open),false);
 // Annotation tools appear only on demand, place a real scene marker and export it.
 await page.locator('#annotate-mode').click();
 assert.equal(await page.locator('#annotation-panel').isVisible(),true);
 await page.locator('#label').fill('Road inspection');
 const canvas=await page.locator('#view canvas').boundingBox();
 await page.mouse.click(canvas.x+canvas.width*.45,canvas.y+canvas.height*.55);
 assert.match(await page.locator('#notes').textContent(),/Road inspection/);
 const downloadEvent=page.waitForEvent('download');await page.locator('#export').click();
 const download=await downloadEvent,stream=await download.createReadStream();let raw='';for await(const chunk of stream)raw+=chunk;
 const exported=JSON.parse(raw);assert.equal(exported.notes.length,1);assert.equal(exported.notes[0].label,'Road inspection');assert.ok(exported.notes[0].position.every(Number.isFinite));
 await page.locator('#close-annotations').click();assert.equal(await page.locator('#annotation-panel').isVisible(),false);
 await page.locator('#annotate-mode').click();assert.match(await page.locator('#notes').textContent(),/Road inspection/);await page.locator('#inspect-mode').click();
 // Pick an actual projected LiDAR return; its contextual inspector must clear on frame change.
 await seek(0);
 const manifest=await (await page.request.get(new URL('demo/manifest.json',base).href)).json();
 const f=manifest.frames[0],cal=manifest.calibration,buffer=await (await page.request.get(new URL(f.lidar,new URL('demo/manifest.json',base)).href)).body();
 const picks=[];
 for(let k=0;k<buffer.length;k+=16){
  const v=[buffer.readFloatLE(k),buffer.readFloatLE(k+4),buffer.readFloatLE(k+8)],t=cal.t,r=cal.r,p=cal.p;
  const a=[0,1,2].map(i=>t[i*4]*v[0]+t[i*4+1]*v[1]+t[i*4+2]*v[2]+t[i*4+3]);
  const b=[0,1,2].map(i=>r[i*3]*a[0]+r[i*3+1]*a[1]+r[i*3+2]*a[2]);
  const c=[0,1,2].map(i=>p[i*4]*b[0]+p[i*4+1]*b[1]+p[i*4+2]*b[2]+p[i*4+3]);
  const x=c[0]/c[2],y=c[1]/c[2];if(c[2]>1&&x>200&&x<900&&y>70&&y<300&&(!picks.length||Math.hypot(x-picks[0][0],y-picks[0][1])>70)){picks.push([x,y]);if(picks.length===2)break}
 }
 assert.equal(picks.length,2);const uv=picks[0],box=await page.locator('#camera').boundingBox();
 await page.keyboard.down('Alt');await page.mouse.click(box.x+uv[0]/1242*box.width,box.y+uv[1]/375*box.height);await page.keyboard.up('Alt');
 assert.equal(await page.locator('#point-panel').isVisible(),true);assert.match(await page.locator('#inspection').textContent(),/Point #/);
 assert.equal(await page.locator('#track-panel').isVisible(),false);
 await seek(1);assert.equal(await page.locator('#point-panel').isVisible(),false);
 await seek(0);await page.locator('#measure-mode').click();
 for(const [x,y] of picks)await page.mouse.click(box.x+x/1242*box.width,box.y+y/375*box.height);
 assert.equal(await page.locator('#tool-feedback').isVisible(),true);assert.match(await page.locator('#measure-overlay').textContent(),/^Distance [0-9.]+ m/);
 await page.locator('#inspect-mode').click();assert.equal(await page.locator('#tool-feedback').isVisible(),false);
 console.log('Minimal workspace passed: contextual panels, modal focus/Escape, view menu, annotation placement/export, actual point inspection and stale-selection clearing');
}
