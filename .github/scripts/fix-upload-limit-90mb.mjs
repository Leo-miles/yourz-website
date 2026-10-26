import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2] || 'app';
const appFile = path.join(root, 'public/app.js');
const htmlFile = path.join(root, 'public/index.html');
let app = fs.readFileSync(appFile, 'utf8');
let html = fs.readFileSync(htmlFile, 'utf8');

const replacements = [
  ['const MAX_PRODUCT_FILE_BYTES = 20 * 1024 * 1024;', 'const MAX_PRODUCT_FILE_BYTES = 90 * 1024 * 1024;'],
  ["if (size > MAX_PRODUCT_FILE_BYTES) fail(413, 'Each file must be 20 MB or smaller / 单个文件不能超过20MB');", "if (size > MAX_PRODUCT_FILE_BYTES) fail(413, 'Each file must be 90 MB or smaller / 单个文件不能超过90MB');"],
  ['Each file can be up to 20 MB; shared storage has a 9 GB safety cap.', 'Each file can be up to 90 MB; shared storage has a 9 GB safety cap.'],
  ['单个文件最大20MB，共享存储设有9GB安全上限。', '单个文件最大90MB，共享存储设有9GB安全上限。'],
  ['if(file.size>20*1024*1024){failed.push(file.name+": exceeds 20 MB / 超过20MB");continue;}', 'if(file.size>90*1024*1024){failed.push(file.name+": exceeds 90 MB / 超过90MB");continue;}']
];
for (const [before, after] of replacements) {
  if (app.includes(after)) continue;
  if (!app.includes(before)) throw new Error('Upload limit patch target missing: ' + before.slice(0, 100));
  app = app.replace(before, after);
}
if (!app.includes('const MAX_PRODUCT_FILE_BYTES = 90 * 1024 * 1024;') ||
    !app.includes('if(file.size>90*1024*1024)') ||
    !app.includes('单个文件最大90MB')) {
  throw new Error('90 MB upload limit verification failed.');
}
fs.writeFileSync(appFile, app);

// Force a fresh browser asset after the upload-limit behavior changes.
const marker = 'supplier-quotes=20261020-1&xlsx-images=20261020-1';
if (html.includes(marker)) {
  html = html.replace(marker, marker + '&upload-limit=20261025-1');
} else if (!html.includes('upload-limit=20261025-1')) {
  throw new Error('Could not locate the expected app.js cache marker; refusing an unsafe deploy.');
}
fs.writeFileSync(htmlFile, html);
console.log('Upload limit patch applied and verified: 90 MB per file; browser cache marker updated.');
