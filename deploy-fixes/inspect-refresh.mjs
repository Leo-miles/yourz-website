import fs from 'node:fs';
const root = process.argv[2] || 'app';
const file = root + '/public/app.js';
const source = fs.readFileSync(file, 'utf8');
console.log('REFRESH_DIAGNOSTIC source=' + file + ' bytes=' + source.length);
const targets = [
  ['refresh-async', 'async function refresh'],
  ['refresh-function', 'function refresh('],
  ['refresh-const', 'const refresh'],
  ['api-async', 'async function api('],
  ['api-function', 'function api('],
  ['api-fetch', 'fetch('],
  ['refresh-button-handler', "getElementById('refresh').onclick"]
];
for (const [label, token] of targets) {
  const i = source.indexOf(token);
  console.log('--- ' + label + ' index=' + i + ' ---');
  if (i >= 0) console.log(source.slice(Math.max(0, i - (label.includes('handler') ? 700 : 300)), Math.min(source.length, i + (label === 'api-fetch' ? 1200 : 3200))));
}
