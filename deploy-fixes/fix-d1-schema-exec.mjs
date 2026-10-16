import fs from 'node:fs';

const file = process.argv[2] || 'src/handler.js';
const source = fs.readFileSync(file, 'utf8');
const before = 'async function doEnsureSchema(db) {\n  await db.exec(SCHEMA);';
const after = [
  'async function doEnsureSchema(db) {',
  "  for (const statement of SCHEMA.split(';').map(value => value.trim()).filter(Boolean)) {",
  '    await db.prepare(statement).run();',
  '  }'
].join('\n');
if (!source.includes(before)) throw new Error('Expected multi-statement D1 schema initializer not found; refusing unsafe patch.');
fs.writeFileSync(file, source.replace(before, after));
console.log('D1 schema initializer updated to execute one statement at a time in isolated preview.');
