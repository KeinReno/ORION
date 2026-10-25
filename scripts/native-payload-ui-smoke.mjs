// Run after a DEBUG Tauri build with tmp/payload-ui-smoke.conf.json.
// No actual runtime, database, account or external web page is opened.
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
const root = process.cwd();
const reportFile = path.join(root, 'tmp', 'payload-native-ui.json');
let resolveReport;
let firstReport;
const reported = new Promise(resolve => { resolveReport = resolve; });
const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  if (req.method !== 'POST' || req.url !== '/report') { res.writeHead(404).end(); return; }
  let body=''; for await (const chunk of req) { body+=chunk; if(body.length>16000) { res.writeHead(413).end(); return; } }
  try {
    const report=JSON.parse(body);
    if (report.ok && !firstReport) {
      firstReport=report;
      const marker=path.join(process.env.LOCALAPPDATA,'com.orion.payload-smoke','app-runtime.json');
      if (!fs.existsSync(marker)) throw new Error('Isolated smoke marker missing');
      const alternate=fs.mkdtempSync(path.join(root,'tmp','payload-reload-'));
      const url=`http://127.0.0.1:${server.address().port}/report`;
      fs.writeFileSync(path.join(alternate,'login.html'),`<html><body>Rollback fixture<script>fetch(${JSON.stringify(url)},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ok:true,reloaded:true,origin:location.origin})})</script></body></html>`);
      fs.writeFileSync(`${marker}.tmp`,JSON.stringify({web:alternate,tag:'rollback-fixture'}));
      fs.renameSync(`${marker}.tmp`,marker);
    } else {
      const combined=firstReport && report.reloaded ? {...firstReport,checks:[...firstReport.checks,'Native selection reload'],ok:report.ok} : report;
      fs.writeFileSync(reportFile,JSON.stringify(combined,null,2)); resolveReport(combined);
    }
    res.writeHead(200).end('{}');
  }
  catch { res.writeHead(400).end(); }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const child=spawn(path.join(root,'apps/desktop/src-tauri/target/debug/orion-desktop.exe'),[],{
  cwd:root, windowsHide:true, stdio:'ignore', env:{...process.env,
    ORION_PAYLOAD_UI_SMOKE_ROOT:path.resolve(process.argv[2] || 'apps/desktop/src-tauri/resources/runtime/web'),
    ORION_PAYLOAD_UI_SMOKE_REPORT:`http://127.0.0.1:${server.address().port}/report`
  }
});
let timer;
try {
  const result=await Promise.race([reported,new Promise((_,reject)=>{ timer=setTimeout(()=>reject(new Error('Native UI smoke timeout')),45000); child.once('error',reject); child.once('exit',code=>reject(new Error(`Native UI exited ${code}`))); })]);
  console.log(result);
  if(!result.ok) process.exitCode=1;
} finally { clearTimeout(timer); child.kill(); await new Promise(resolve=>server.close(resolve)); }
