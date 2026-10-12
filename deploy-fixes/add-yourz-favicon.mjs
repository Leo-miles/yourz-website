import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2] || 'app';
const publicDir = path.join(root, 'public');
const indexPath = path.join(publicDir, 'index.html');

if (!fs.existsSync(indexPath)) {
  throw new Error('Cannot add YOURZ favicon: public/index.html was not found at ' + indexPath);
}

const faviconBase64 = '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';
const faviconPath = path.join(publicDir, 'favicon-yourz.png');
fs.writeFileSync(faviconPath, Buffer.from(faviconBase64, 'base64'));

let html = fs.readFileSync(indexPath, 'utf8');
html = html.replace(/<link\b(?=[^>]*\brel\s*=\s*["'][^"']*\b(?:icon|apple-touch-icon)\b[^"']*["'])[^>]*>\s*/gi, '');
const tags = [
  '<link rel="icon" type="image/png" sizes="64x64" href="/favicon-yourz.png?v=20261012">',
  '<link rel="shortcut icon" type="image/png" href="/favicon-yourz.png?v=20261012">'
].join('\n    ');
if (!/<head\b[^>]*>/i.test(html)) {
  throw new Error('Cannot add YOURZ favicon: no <head> element found in public/index.html');
}
html = html.replace(/<head\b[^>]*>/i, match => match + '\n    ' + tags + '\n');
fs.writeFileSync(indexPath, html);
console.log('YOURZ favicon installed: public/favicon-yourz.png and index.html icon links updated.');
