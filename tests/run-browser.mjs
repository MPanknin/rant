import {createServer} from 'vite';
import {spawn} from 'node:child_process';
const server=await createServer({server:{host:'127.0.0.1',port:4174,strictPort:true}});
await server.listen();
try{
 for(const test of ['tests/browser-smoke.mjs','tests/browser-real.mjs','tests/browser-rellis.mjs']){
  const code=await new Promise(resolve=>spawn(process.execPath,[test],{stdio:'inherit',env:{...process.env,RANT_TEST_URL:'http://127.0.0.1:4174/'}}).on('exit',resolve));
  if(code)throw Error(`${test} exited ${code}`);
 }
}finally{await server.close()}
