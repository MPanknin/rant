import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage({viewport:{width:1280,height:900}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = process.env.RANT_TEST_URL || 'http://127.0.0.1:4173/';
  const url = new URL('cases/rellis/', base);
  const data = await (await page.request.get(new URL('rellis/case.json', base).href)).json();
  await page.goto(url.href);
  const canvas = page.locator('#scene');
  const ready = file => page.waitForFunction(file => document.querySelector('#scene').dataset.frame === file, file);
  await ready(data.reference.points);
  assert.equal(await canvas.getAttribute('data-mode'),'reported');
  const pixels = () => canvas.evaluate(c => c.toDataURL());
  const bad = await pixels();
  await page.locator('#overlay').uncheck();
  const image = await pixels();
  await page.locator('#corrected').click();
  assert.equal(await pixels(),image,'camera stays fixed');
  await page.locator('#overlay').check();
  assert.notEqual(await pixels(),bad,'changing chain changes actual rendered pixels');
  await page.locator('#reported').click();assert.equal(await pixels(),bad,'reversible A/B');
  await page.locator('#source').selectOption('drive');await ready(data.drive[0].points);
  await page.locator('#play').click();await ready(data.drive[2].points);await page.locator('#play').click();
  await page.locator('#corrected').click();
  await page.locator('#seek').focus();await page.keyboard.press('End');await ready(data.drive.at(-1).points);
  await page.locator('#source').selectOption('reference');await ready(data.reference.points);
  await page.setViewportSize({width:390,height:844});
  await page.locator('#reported').click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors,[]);
  console.log('RELLIS case passed on '+url.href+' (fixed-image A/B, real motion playback, seek, mobile)');
} finally {await browser.close()}
