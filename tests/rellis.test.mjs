import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {projectScan} from '../src/cases/rellis/projection.ts';

const dir = new URL('../public/rellis/', import.meta.url);
const recording = JSON.parse(readFileSync(new URL('case.json', dir)));
const expected = JSON.parse(readFileSync(new URL('rellis-opencv.json', import.meta.url)));
test('both RELLIS transform paths match the independent OpenCV projection on every published pair', () => {
  for (const pair of [recording.reference, ...recording.drive]) {
    const data = readFileSync(new URL(pair.points, dir));
    const xyz = new Float32Array(data.buffer, data.byteOffset, data.byteLength/4);
    for (const mode of ['reported','corrected']) {
      const points = projectScan(xyz, recording.rig, mode);
      const ref = expected[pair.points][mode];
      assert.equal(points.length, ref.count, pair.points+' '+mode);
      for (const [index,axis] of ['u','v'].entries()) {
        const mean = points.reduce((sum,p) => sum+p[axis], 0)/points.length;
        assert.ok(Math.abs(mean-ref.mean[index]) < 0.001, pair.points+' '+axis);
      }
    }
  }
});
