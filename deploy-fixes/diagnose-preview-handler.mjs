import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2] || 'app';
const handlerPath = path.join(root, 'src/handler.js');
const source = fs.readFileSync(handlerPath, 'utf8');
console.log('HANDLER_DIAGNOSTIC bytes=' + source.length);
function show(label, token, before=400, after=2600) {
  const i=source.indexOf(token);
  console.log('--- ' + label + ' index=' + i + ' ---');
  if(i>=0) console.log(source.slice(Math.max(0,i-before),Math.min(source.length,i+after)));
}
show('SCHEMA','const SCHEMA',0,7000);
show('doEnsureSchema','async function doEnsureSchema',100,2200);
show('ensureSchema','async function ensureSchema',100,1400);
show('ensureBootstrapAdmin','async function ensureBootstrapAdmin',100,2400);
show('currentSession','async function currentSession');
show('healthz-route',"route === '/healthz'",200,1400);
show('handleApp','async function handleApp',100,2800);
show('onRequest','export async function onRequest',100,3000);
show('jsonResponse','function jsonResponse',100,1200);
show('securityHeaders','function securityHeaders',100,1200);
for (const p of ['functions/api/[[path]].js','functions/auth/[[path]].js','functions/[[path]].js','functions/_middleware.js','_worker.js']) {
  const full=path.join(root,p);
  if (fs.existsSync(full)) {
    console.log('--- FILE ' + p + ' ---');
    console.log(fs.readFileSync(full,'utf8').slice(0,2400));
  }
}
