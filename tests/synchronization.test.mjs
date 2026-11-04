import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseKittiTimestamps,nearestTimestampIndex} from '../src/data/synchronization.ts';

test('KITTI nanosecond timestamps preserve sub-millisecond offsets',()=>{
  const raw='2011-09-26 13:02:45.123456789\n2011-09-26 13:02:45.223456789\n';
  const relative=parseKittiTimestamps(raw);
  assert.ok(relative);
  assert.equal(relative.length,2);
  assert.ok(Math.abs(relative[1]-.1)<.00001);
  const absolute=parseKittiTimestamps(raw,false);
  assert.ok(absolute);
  assert.ok(absolute[0]>1e9);
});
test('nearest camera match obeys tolerance and tie-breaking',()=>{
  const times=[1,1.1,1.2,1.3];
  assert.equal(nearestTimestampIndex(times,1.12),1);
  assert.equal(nearestTimestampIndex(times,1.28),3);
  assert.equal(nearestTimestampIndex(times,1.16),2);
  assert.equal(nearestTimestampIndex(times,1.4),undefined);
});
test('rejects malformed or nonmonotonic timestamps',()=>{
  assert.equal(parseKittiTimestamps('not a timestamp'),undefined);
  assert.equal(parseKittiTimestamps('2011-09-26 13:02:46.0\n2011-09-26 13:02:45.0'),undefined);
});
