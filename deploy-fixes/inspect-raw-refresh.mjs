import fs from 'node:fs';

const root = process.argv[2] || 'app';
const file = root + '/public/app.js';
const source = fs.readFileSync(file, 'utf8');
console.log('RAW_APP_JS length=' + source.length);

for (const token of [
  "async function refresh",
  "function refresh",
  "function updateAccess",
  "api('/api/state'",
  "getElementById('refresh').onclick"
]) {
  const i = source.indexOf(token);
  console.log('--- RAW_TOKEN ' + JSON.stringify(token) + ' index=' + i + ' ---');
  if (i >= 0) console.log(source.slice(Math.max(0, i - 300), Math.min(source.length, i + 2400)));
}
