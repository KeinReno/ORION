// Run after a DEBUG build with scripts/startup-smoke.config.json. Synthetic runtime states only.
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
const reports=[];
for (const mode of ['ready','error']) {
  const events=[];
  let complete;
  const finished=new Promise(resolve=>{complete=resolve;});
  const server=createServer(async(req,res)=>{
    res.setHeader('Access-Control-Allow-Origin','*');
    if(req.method==='OPTIONS'){res.writeHead(204).end();return;}
    let body='';for await(const chunk of req){body+=chunk;if(body.length>8000){res.writeHead(413).end();return;}}
    try{const value=JSON.parse(body);events.push(value);if(value.done)complete(value);res.writeHead(200).end('{}');}catch{res.writeHead(400).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const report=`http://127.0.0.1:${server.address().port}/`;
  const root=fs.mkdtempSync(path.resolve('tmp/startup-fixture-'));
  fs.writeFileSync(path.join(root,'index.html'),`<!doctype html><html lang="ru"><body>ORION startup fixture<script>fetch(${JSON.stringify(report)},{method:'POST',body:JSON.stringify({done:true,navigated:true,origin:location.origin})})</script></body></html>`);
  const child=spawn(path.resolve('apps/desktop/src-tauri/target/debug/orion-desktop.exe'),[],{windowsHide:true,stdio:'ignore',env:{...process.env,ORION_STARTUP_SMOKE:mode,ORION_STARTUP_SMOKE_ROOT:root,ORION_STARTUP_SMOKE_REPORT:report}});
  let timer;
  try{
    const result=await Promise.race([finished,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Startup smoke timeout')),30000);child.once('error',reject);child.once('exit',code=>reject(Error(`Shell exited ${code}`)));})]);
    for(const phase of ['database','migrations','server'])if(!events.some(e=>e.phase===phase))throw Error(`Missing phase ${phase}`);
    if(!events.some(e=>e.frames>20&&e.logo))throw Error('Startup did not paint/animate while waiting');
    if(mode==='ready'&&!result.navigated)throw Error('Did not navigate after readiness');
    if(mode==='error'&&(!result.errorVisible||result.retryVisible||result.busy!=='false'))throw Error('Error recovery UI missing');
    reports.push({mode,ok:true,events});
    console.log(`Native startup ${mode}: passed`);
    if(mode==='error'&&process.argv.includes('--inspect'))await new Promise(resolve=>setTimeout(resolve,45000));
  }finally{clearTimeout(timer);child.kill();await new Promise(resolve=>server.close(resolve));}
}
fs.writeFileSync('tmp/native-startup-smoke.json',JSON.stringify(reports,null,2));
