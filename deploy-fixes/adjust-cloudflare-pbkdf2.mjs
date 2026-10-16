import fs from 'node:fs';

const file = process.argv[2] || 'src/handler.js';
const source = fs.readFileSync(file, 'utf8');
const before = 'const PBKDF2_ITERATIONS = 180_000;';
const after = 'const PBKDF2_ITERATIONS = 100_000;';
if (!source.includes(before)) {
  if (source.includes(after)) {
    console.log('Cloudflare-compatible PBKDF2 iteration count is already configured.');
    process.exit(0);
  }
  throw new Error('Expected PBKDF2 setting not found; refusing unsafe patch.');
}
fs.writeFileSync(file, source.replace(before, after));
console.log('Applied Cloudflare-compatible PBKDF2 setting to isolated preview only.');
