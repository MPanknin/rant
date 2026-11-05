// Capture the actual case UI. Requires playwright, Chromium and ffmpeg.
// Usage: node scripts/record-rellis.mjs output.mp4
import {chromium} from 'playwright';
import {createServer} from 'vite';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

const output=resolve(process.argv[2] || 'rellis-case.mp4');
const dir=await mkdtemp(join(tmpdir(),'rant-rellis-'));
const data=JSON.parse(await readFile(new URL('../public/rellis/case.json',import.meta.url),'utf8'));
const server=await createServer({server:{host:'127.0.0.1',port:4188,strictPort:true}});
await server.listen();
const browser=await chromium.launch();
try {
  const page=await browser.newPage({viewport:{width:1280,height:1000},deviceScaleFactor:1});
  await page.goto('http://127.0.0.1:4188/cases/rellis/');
  const ready=file=>page.waitForFunction(f=>document.querySelector('#scene').dataset.frame===f,file);
  await ready(data.reference.points);
  const entries=[];
  async function take(seconds){
    const name='shot-'+String(entries.length).padStart(3,'0')+'.png';
    await page.mouse.move(1270,5);
    await page.screenshot({path:join(dir,name)});
    entries.push({name,seconds});
  }
  await take(4);
  await page.locator('#corrected').click();await take(4);
  await page.locator('#overlay').uncheck();await take(2);
  await page.locator('#overlay').check();await take(2);
  for(const mode of ['reported','corrected']){
    await page.locator('#'+mode).click();
    await page.locator('#source').selectOption('drive');
    for(let i=0;i<data.drive.length;i++){
      await page.locator('#seek').evaluate((el,value)=>{
        el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));
      },i);
      await ready(data.drive[i].points);
      const duration=i+1<data.drive.length ? data.drive[i+1].cameraTime-data.drive[i].cameraTime : .2;
      await take(duration+(i===0?1:0));
    }
  }
  await page.locator('#source').selectOption('reference');await ready(data.reference.points);
  await page.locator('#reported').click();await take(3);
  await page.locator('#corrected').click();
  await take(30-entries.reduce((sum,e)=>sum+e.seconds,0));
  const list=entries.map(e=>`file '${e.name}'\nduration ${e.seconds.toFixed(6)}`).join('\n');
  await writeFile(join(dir,'frames.txt'),list+'\nfile '+entries.at(-1).name+'\n');
  execFileSync('ffmpeg',['-v','error','-y','-f','concat','-safe','0','-i','frames.txt','-t','30',
    '-vf','fps=25,format=yuv420p','-c:v','libx264','-crf','21','-movflags','+faststart',output],{cwd:dir});
  if(process.env.RELLIS_QA_DIR) {
    const {copyFile}=await import('node:fs/promises');
    await copyFile(join(dir,entries[0].name),join(process.env.RELLIS_QA_DIR,'reported.png'));
    await copyFile(join(dir,entries[1].name),join(process.env.RELLIS_QA_DIR,'corrected.png'));
    await copyFile(join(dir,entries[30].name),join(process.env.RELLIS_QA_DIR,'moving.png'));
  }
} finally {
  await browser.close();await server.close();await rm(dir,{recursive:true,force:true});
}
