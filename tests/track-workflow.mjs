import assert from 'node:assert/strict';
import {PerspectiveCamera,Vector3} from 'three';

/** Genuine KITTI annotations; no intercepted dataset or invented object motion. */
export async function verifyTrackWorkflow(page,seek,base){
 const response=await page.request.get(new URL('demo/manifest.json',base).href),manifest=await response.json();
 assert.equal(manifest.tracks.length,15);
 assert.equal(await page.locator('#track-select option').count(),16);
 await seek(0);
 await page.waitForFunction(()=>document.querySelectorAll('#track-projection g').length>=3);
 // Select the cyclist by clicking inside its actual projected silhouette.
 const cameraTarget=await page.locator('#track-projection g[data-track-id="1"] path').evaluate(path=>{const r=path.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}});
 await page.mouse.click(cameraTarget.x,cameraTarget.y);
 assert.equal(await page.locator('#track-select').inputValue(),'1');
 assert.match(await page.locator('#track-inspector').textContent(),/Cyclist #1.*dataset annotation/s);
 assert.equal(await page.locator('#track-projection g[data-track-id="1"]').getAttribute('data-selected'),'true');
 await page.locator('#project-cloud').uncheck();
 assert.equal(await page.locator('#track-projection g[data-track-id="1"]').count(),1,'object overlay is independent of LiDAR overlay');
 await page.locator('#project-cloud').check();
 // Select a different annotation in 3D using its geometric center projected through the known reset view.
 await page.locator('#reset-view').click();
 const canvas=await page.locator('#view canvas').boundingBox();
 const pedestrian=manifest.tracks.find(t=>t.id==='2'),sample=pedestrian.samples[0];
 const camera=new PerspectiveCamera(58,canvas.width/canvas.height,.1,1200);camera.up.set(0,0,1);camera.position.set(24,-30,19);camera.lookAt(12,0,0);camera.updateMatrixWorld();
 const target=new Vector3(...sample.position);target.z+=pedestrian.size[2]/2;target.project(camera);
 await page.mouse.click(canvas.x+(target.x+1)/2*canvas.width,canvas.y+(1-target.y)/2*canvas.height);
 assert.equal(await page.locator('#track-select').inputValue(),'2','3D cuboid selects the corresponding track');
 assert.equal(await page.locator('#track-projection g[data-track-id="2"]').getAttribute('data-selected'),'true','3D selection highlights camera box');
 await page.locator('#track-select').selectOption('1');
 await page.locator('#follow-track').check();
 await page.locator('#play').click();
 await page.waitForFunction(()=>Number(document.querySelector('#timeline').value)>=5,null,{timeout:30000});
 await page.locator('#play').click();
 assert.equal(await page.locator('#track-select').inputValue(),'1');
 assert.match(await page.locator('#track-focus-state').textContent(),/^Following/);
 await seek(35);
 await page.locator('#follow-track').uncheck();await page.locator('#reset-view').click();
 await page.screenshot({path:'/tmp/rant-tracks-desktop.png',fullPage:true});
 // A later track must not appear before its labels begin; first/last navigate its actual span.
 await page.locator('#track-select').selectOption('4');
 assert.equal(await page.locator('#track-inspector').getAttribute('data-present'),'false');
 assert.match(await page.locator('#track-inspector').textContent(),/Not annotated/);
 assert.equal(await page.locator('#track-range').getAttribute('aria-label'),'Selected object annotated in frames 113 to 123');
 await page.locator('#track-first').click();await seek(113);
 assert.equal(await page.locator('#track-inspector').getAttribute('data-present'),'true');
 await page.locator('#follow-track').check();
 await page.locator('#track-last').click();await seek(123);
 await seek(124);
 assert.equal(await page.locator('#track-inspector').getAttribute('data-present'),'false');
 assert.match(await page.locator('#track-focus-state').textContent(),/^Follow paused/);
 assert.equal(await page.locator('#track-projection g[data-track-id="4"]').count(),0,'expired annotation must disappear');
 await seek(120);assert.match(await page.locator('#track-focus-state').textContent(),/^Following/);
 await page.locator('#show-tracks').uncheck();assert.equal(await page.locator('#track-projection').count(),0);
 await page.locator('#show-tracks').check();
 await page.locator('#clear-track').click();assert.equal(await page.locator('#track-select').inputValue(),'');assert.equal(await page.locator('#follow-track').isChecked(),false);
 await page.locator('#reset-view').click();
 console.log('Real object workflows passed: 15 tracks, camera/3D picking, linked selection, follow playback, presence ranges, first/last and missing observations');
}
