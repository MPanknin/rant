import test from 'node:test';
import assert from 'node:assert/strict';
import {relativePose,transformPoint,accumulateInto,isRigidPose} from '../src/geometry/poses.ts';
import {projectKitti,readRawCalibration,readObjectCalibration} from '../src/geometry/calibration.ts';
const identity=[1,0,0,0,0,1,0,0,0,0,1,0];
const moved=[0,-1,0,10,1,0,0,2,0,0,1,0];
function near(actual,expected){actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1e-6,`${actual} != ${expected}`))}
test('relative pose reverses translation and yaw in the correct order',()=>{
  near(transformPoint(relativePose(moved,identity),10,3,0),[1,0,0]);
  near(transformPoint(relativePose(moved,moved),3,4,5),[3,4,5]);
});
test('same stationary landmark aligns across translated and rotated observations',()=>{
  const output=new Float32Array(6);
  const result=accumulateInto(output,moved,[{points:new Float32Array([10,3,0,1]),pose:identity},{points:new Float32Array([1,0,0,1]),pose:moved}]);
  near([...output],[1,0,0,1,0,0]);assert.deepEqual(result,{count:2,used:2});
});
test('accumulation obeys both per-scan and output bounds and skips nonfinite returns',()=>{
  const output=new Float32Array(9),points=new Float32Array(Array.from({length:100},()=>[1,2,3,1]).flat());
  assert.equal(accumulateInto(output,identity,[{points,pose:identity}],2).count,2);
  assert.equal(accumulateInto(output,identity,[{points,pose:identity}],100).count,3);
  assert.equal(accumulateInto(output,identity,[{points:new Float32Array([NaN,0,0,1]),pose:identity}]).count,0);
});
test('pose validation rejects scale, reflection, missing and nonfinite matrices',()=>{
  assert.ok(isRigidPose(moved));assert.ok(!isRigidPose(null));
  for(const v of [2,-1,NaN]){const p=[...identity];p[0]=v;assert.ok(!isRigidPose(p))}
});
test('calibrated projection uses extrinsics, rectification and P translation',()=>{
  const calibration={p:[100,0,50,20,0,100,40,0,0,0,1,0],r:[1,0,0,0,1,0,0,0,1],t:[0,-1,0,0,0,0,-1,0,1,0,0,0]};
  near(projectKitti(10,1,2,calibration),[42,20]);assert.equal(projectKitti(-10,0,0,calibration),undefined);
});
test('Raw and Object calibration layouts remain distinct and validated',()=>{
  const p='100 0 50 0 0 100 40 0 0 0 1 0',r='1 0 0 0 1 0 0 0 1',t='1 0 0 0 0 1 0 0 0 0 1 0';
  const raw=readRawCalibration(`P_rect_02: ${p}\nR_rect_00: ${r}`,`R: ${r}\nT: 0 0 0`);
  assert.deepEqual(raw,readObjectCalibration(`P2: ${p}\nR0_rect: ${r}\nTr_velo_to_cam: ${t}`));
  assert.throws(()=>readObjectCalibration('P2: 1 2'));assert.throws(()=>readRawCalibration('',''));
});
