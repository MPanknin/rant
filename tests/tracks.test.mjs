import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTracks,sampleAt,boxCorners,presenceRanges,projectedBox,projectedHull,inHull,trackPath,estimatedSpeed} from '../src/data/tracks.ts';
const sample=(frame,position=[10,0,-1],rotation=[0,0,0])=>({frame,position,rotation});
const track=(samples=[sample(0),sample(1)])=>({id:'object-1',label:'Car',size:[4,2,2],samples});
const pose=x=>[1,0,0,x,0,1,0,0,0,0,1,0];
const calibration={p:[100,0,50,0,0,100,40,0,0,0,1,0],r:[1,0,0,0,1,0,0,0,1],t:[0,-1,0,0,0,0,-1,0,1,0,0,0]};
test('track schema rejects duplicate IDs, invalid dimensions and out-of-order/out-of-range samples',()=>{
 assert.deepEqual(validateTracks(undefined,3),[]);assert.equal(validateTracks([track()],3).length,1);
 assert.throws(()=>validateTracks([track(),track()],3),/unique/);
 for(const samples of [[sample(-1)],[sample(3)],[sample(1),sample(0)],[sample(0,[NaN,0,0])]])assert.throws(()=>validateTracks([track(samples)],3));
 assert.throws(()=>validateTracks([{...track(),size:[0,2,2]}],3));
});
test('exact sample lookup never invents object poses in gaps or outside the track',()=>{
 const t=track([sample(1),sample(2),sample(5)]);
 assert.equal(sampleAt(t,0),undefined);assert.equal(sampleAt(t,3),undefined);assert.equal(sampleAt(t,5).frame,5);assert.equal(sampleAt(t,6),undefined);
 assert.deepEqual(presenceRanges(t),[[1,2],[5,5]]);
});
test('cuboids use bottom-center anchors and rotate length along Velodyne yaw',()=>{
 const t=track(),s=sample(0,[10,3,-1],[0,0,Math.PI/2]);
 const points=boxCorners(t,s);
 assert.ok(Math.abs(points[0][0]-11)<1e-8);assert.ok(Math.abs(points[0][1]-1)<1e-8);
 assert.equal(points[0][2],-1);assert.equal(points[4][2],1);
});
test('camera cuboid projection and hull picking follow calibrated image coordinates',()=>{
 const t=track(),lines=projectedBox(t,t.samples[0],calibration),hull=projectedHull(lines);
 assert.equal(lines.length,12);assert.ok(inHull(hull,50,40));assert.ok(!inHull(hull,0,0));
 assert.ok(hull.every(p=>p.every(Number.isFinite)));
});
test('near-plane clipping excludes boxes behind the camera without nonfinite edges',()=>{
 const t=track();assert.deepEqual(projectedBox(t,sample(0,[-10,0,0]),calibration),[]);
 const lines=projectedBox(t,sample(0,[1,0,0]),calibration);assert.ok(lines.length>0&&lines.every(l=>l.every(Number.isFinite)));
});
test('trajectory and speed remove ego motion; stationary world objects stay stationary',()=>{
 const frames=[{time:0,pose:pose(0)},{time:1,pose:pose(2)}],t=track([sample(0,[10,0,0]),sample(1,[8,0,0])]);
 assert.deepEqual(trackPath(t,frames,1),[[[8,0,0],[8,0,0]]]);assert.equal(estimatedSpeed(t,1,frames),0);
 const moving=track([sample(0,[10,0,0]),sample(1,[11,0,0])]);assert.equal(estimatedSpeed(moving,1,frames),3);
 assert.equal(estimatedSpeed(t,1,[{time:0},{time:1}]),undefined);
});
test('trajectory never connects missing annotations or missing ego poses',()=>{
 const frames=[{time:0,pose:pose(0)},{time:1,pose:pose(1)},{time:2,pose:pose(2)}];
 assert.deepEqual(trackPath(track([sample(0),sample(2)]),frames,2),[]);
 assert.equal(estimatedSpeed(track([sample(0),sample(2)]),2,frames),undefined);
 assert.deepEqual(trackPath(track(),[{time:0},{time:1,pose:pose(1)}],1),[]);
});
