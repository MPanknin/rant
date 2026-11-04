import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { TimelineCache } from '../src/data/timeline-cache.ts';

const flush=async()=>{await new Promise(resolve=>setTimeout(resolve,0))};

test('prioritizes playhead and bounds resident bytes',async()=>{
  const loaded=[];
  const cache=new TimelineCache({
    maxResidentBytes:24,concurrency:1,ahead:3,behind:1,
    sizeOf:v=>v.byteLength,
    load:async(i)=>{loaded.push(i);return {value:new Uint8Array(12),bytes:12}}
  });
  cache.reset(8);
  await flush();
  assert.equal(loaded[0],0);
  assert.ok(cache.stats.residentBytes<=24);
  cache.seek(6);
  await flush();
  assert.equal(cache.playhead,6);
  assert.ok(cache.stats.residentBytes<=24);
  assert.ok(cache.get(6));
  cache.dispose();
});

test('stale completion cannot repopulate reset cache',async()=>{
  let finish;
  const cache=new TimelineCache<Uint8Array>({
    ahead:0,behind:0,concurrency:1,sizeOf:v=>v.byteLength,
    load:()=>new Promise(resolve=>{finish=resolve})
  });
  cache.reset(1);
  cache.reset(0);
  finish?.({value:new Uint8Array(4),bytes:4});
  await flush();
  assert.equal(cache.stats.resident,0);
  assert.equal(cache.stats.active,0);
});

test('oversized frames do not cause unbounded retry',async()=>{
  let attempts=0;
  const cache=new TimelineCache<Uint8Array>({
    ahead:0,behind:0,maxResidentBytes:4,sizeOf:v=>v.byteLength,
    load:async()=>{attempts++;return {value:new Uint8Array(8),bytes:8}}
  });
  cache.reset(1);
  await flush();
  assert.equal(attempts,1);
  assert.equal(cache.stats.resident,0);
  cache.dispose();
});
