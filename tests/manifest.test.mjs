import test from 'node:test';
import assert from 'node:assert/strict';
import {validateManifest} from '../src/data/manifest.ts';
const url='https://example.test/data/manifest.json';
const fixture=()=>({name:'drive',frames:[{time:0,lidar:'a.bin?version=1',camera:'a.jpg',pose:[1,0,0,0,0,1,0,0,0,0,1,0]},{time:.1,lidar:'b.bin'}]});
test('relative paths, optional camera frames, and optional calibration are preserved',()=>{
  const result=validateManifest(fixture(),url);assert.equal(result.frames[0].url,'https://example.test/data/a.bin?version=1');assert.equal(result.frames[0].imageUrl,'https://example.test/data/a.jpg');assert.equal(result.frames[1].imageUrl,undefined);assert.equal(result.frames[1].calibration,undefined);
});
test('timestamps must increase strictly',()=>{for(const time of [0,-1,NaN]){const f=fixture();f.frames[1].time=time;assert.throws(()=>validateManifest(f,url),/timestamps/)}});
test('invalid calibration, poses, and sensor protocols are rejected',()=>{
  const f=fixture();f.calibration={p:[],r:[],t:[]};assert.throws(()=>validateManifest(f,url),/calibration/);
  delete f.calibration;f.frames[0].pose[0]=2;assert.throws(()=>validateManifest(f,url),/Pose/);
  delete f.frames[0].pose;f.frames[0].lidar='javascript:alert(1)';assert.throws(()=>validateManifest(f,url),/HTTP/);
});
test('missing frames and unsupported scan formats fail before dataset switching',()=>{
  assert.throws(()=>validateManifest({},url));const f=fixture();f.frames[0].lidar='a.zip';assert.throws(()=>validateManifest(f,url),/LiDAR/);
});
