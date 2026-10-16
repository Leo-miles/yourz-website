import fs from 'node:fs';

const root = process.argv[2] || 'app';
const file = root + '/public/app.js';
let source = fs.readFileSync(file, 'utf8');

const token = 'async function refresh(manual=false){';
const index = source.indexOf(token);
if (index < 0) throw new Error('Load-latest refresh function was not found.');
const start = source.lastIndexOf('\n', index) + 1;
const boundary = source.indexOf('function updateAccess(){', index);
if (boundary < 0) throw new Error('Could not locate the boundary after refresh().');
const newline = source.lastIndexOf('\n', boundary);
if (newline < start) throw new Error('Refresh function boundary is before its start.');
const end = newline + 1;
const old = source.slice(start, end);
if (!old.includes("api('/api/state')") ||
    !old.includes('visitorInfo=data.visitor||visitorInfo') ||
    !old.includes('initialPageLogged')) {
  throw new Error('Refresh function does not match the expected app version; refusing an unsafe replacement.');
}

const replacement = [
  "  async function refresh(manual=false){",
  "   if(busy){if(manual)toast('Another save is in progress. Please load latest after it finishes. / 当前正在保存，请稍后再载入。');return;}",
  "   if(manual&&modal.open){if(dirty&&!confirm('Discard unsaved form changes and load the latest shared records? Copy any notes first. / 放弃未保存表单并载入最新共享资料？请先复制需要保留的文字。'))return;modal.close();dirty=false;}",
  "   const button=manual?document.getElementById('refresh'):null;",
  "   const previousLabel=button?.textContent;",
  "   if(button){button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='Loading latest… / 正在载入…';}",
  "   try{",
  "    const data=await api('/api/state',{cache:'no-store',headers:{'Cache-Control':'no-cache, no-store, max-age=0','Pragma':'no-cache'}});",
  "    state=C.validate(data.state);session=data.session;visitorInfo=data.visitor||visitorInfo;serverDay=data.today;timeZone=data.timeZone;stale=false;updateAccess();render();",
  "    if(!initialPageLogged){initialPageLogged=true;recordClientAudit('page.view','page',view,'首次访问');}",
  "    if(manual){const activeCount=state.factories.filter(f=>f.status==='active').length;const deletedCount=state.factories.filter(f=>f.status==='deleted').length;toast('Loaded latest data / 已载入最新资料：版本 '+state.revision+'，使用中 '+activeCount+' 家，回收站 '+deletedCount+' 家');}",
  "   } finally {",
  "    if(button){button.disabled=false;button.removeAttribute('aria-busy');button.textContent=previousLabel||'Load latest / 载入最新资料';}",
  "   }",
  "  }"
].join('\n') + '\n';
source = source.slice(0, start) + replacement + source.slice(end);
if (!source.includes("cache:'no-store'") ||
    !source.includes('Loaded latest data / 已载入最新资料') ||
    !source.includes("button.setAttribute('aria-busy','true')")) {
  throw new Error('Load-latest refresh enhancement verification failed.');
}
fs.writeFileSync(file, source);
console.log('Load-latest refresh fixed: explicit no-cache request, progress state, success counts, and existing error feedback preserved.');
