import fs from 'node:fs';

const file = process.argv[2] || 'app/public/app.js';
const source = fs.readFileSync(file, 'utf8');
const oldHandler = "const search=document.getElementById('search');if(search)search.oninput=()=>{const pos=search.selectionStart;query=search.value;render();const n=document.getElementById('search');n.focus();n.setSelectionRange(pos,pos);};";

if (!source.includes(oldHandler)) {
  throw new Error('Expected factory search input handler was not found; refusing to modify unknown code.');
}
if (source.includes("search.addEventListener('compositionstart'")) {
  throw new Error('IME handlers already appear to be installed; refusing duplicate patch.');
}

const newHandler = `const search=document.getElementById('search');if(search){let composing=false;search.addEventListener('compositionstart',()=>{composing=true;});search.addEventListener('compositionend',()=>{composing=false;query=search.value;const pos=search.selectionStart;render();const n=document.getElementById('search');if(n){n.focus();n.setSelectionRange(pos,pos);}});search.addEventListener('input',e=>{query=search.value;if(composing||e.isComposing)return;const pos=search.selectionStart;render();const n=document.getElementById('search');if(n){n.focus();n.setSelectionRange(pos,pos);}});}`;

const patched = source.replace(oldHandler, newHandler);
if (patched === source) throw new Error('Patch did not change the source.');
fs.writeFileSync(file, patched);
console.log('Applied IME-safe search input handler.');
