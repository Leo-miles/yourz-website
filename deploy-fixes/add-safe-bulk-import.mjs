import fs from 'node:fs';

const root = process.argv[2] || 'app';
const htmlPath = root + '/public/index.html';
const jsPath = root + '/public/app.js';
const read = p => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s);

let html = read(htmlPath);
let source = read(jsPath);
const marker = 'YOURZ SAFE SUPPLIER IMPORT V1';
const version = 'v=yourz-safe-supplier-import-20261016-1';

if (!html.includes('id="importSuppliers"')) {
  const backupButton = /<button\b(?=[^>]*\bid=["']backup["'])[^>]*>[\s\S]*?<\/button>/i;
  const match = html.match(backupButton);
  if (!match) throw new Error('Could not find the existing backup button in index.html; refusing a blind UI edit.');
  html = html.replace(backupButton, match[0] + '\n<button id="importSuppliers" class="secondary" type="button" hidden>Import supplier JSON / 导入工厂 JSON</button>');
}

if (!source.includes(marker)) {
  const updateMarker = "function updateAccess(){";
  const restoreMarker = "document.getElementById('restorefile').onchange=async e=>{";
  if (!source.includes(updateMarker)) throw new Error('Could not locate updateAccess() in app.js; refusing an unsafe patch.');
  if (!source.includes(restoreMarker)) throw new Error('Could not locate the backup restore input handler in app.js; refusing an unsafe patch.');

  const importCode = [
    '/* YOURZ SAFE SUPPLIER IMPORT V1 */',
    'const __yourzImportButton=document.getElementById("importSuppliers");',
    'const __yourzImportInput=document.createElement("input");',
    '__yourzImportInput.type="file";__yourzImportInput.accept=".json,application/json";__yourzImportInput.hidden=true;__yourzImportInput.id="yourzSupplierImportFile";document.body.appendChild(__yourzImportInput);',
    'const __yourzOriginalUpdateAccess=updateAccess;',
    'updateAccess=function(){__yourzOriginalUpdateAccess();if(__yourzImportButton)__yourzImportButton.hidden=!canEdit();};',
    '__yourzImportButton?.addEventListener("click",()=>{if(!canEdit()){toast("Ask an administrator for edit access / 请管理员授予编辑权限");return;}if(stale||busy){toast("Please load the latest records and finish saving first / 请先载入最新资料并等待保存完成");return;}__yourzImportInput.click();});',
    '__yourzImportInput.addEventListener("change",async event=>{',
    ' const file=event.target.files?.[0];event.target.value="";if(!file)return;',
    ' const oldLabel=__yourzImportButton.textContent;let importedCount=0;let skippedCount=0;let deletedCount=0;',
    ' __yourzImportButton.disabled=true;',
    ' try{',
    '  if(stale||busy)throw new Error("Shared records changed or another save is in progress. Load latest and retry / 共享资料有变化或正在保存，请载入最新资料后重试");',
    '  if(file.size>10*1024*1024)throw new Error("JSON backup exceeds 10 MB / JSON 文件超过 10 MB");',
    '  const incoming=C.validate(JSON.parse(await file.text()));',
    '  if(!incoming||!Array.isArray(incoming.factories)||!Number.isInteger(incoming.nextId))throw new Error("This is not a compatible YOURZ factory backup / 不是兼容的 YOURZ 工厂备份");',
    '  if(incoming.factories.length>10000)throw new Error("The file contains too many records / 文件记录数量超出限制");',
    '  const incomingIds=new Set();const incomingNames=new Set();',
    '  for(const f of incoming.factories){if(!f||typeof f.id!=="string"||!f.id||incomingIds.has(f.id))throw new Error("Missing or duplicate factory ID in source file / 源文件存在空编号或重复编号");incomingIds.add(f.id);if(f.status==="active"){if(typeof f.name!=="string"||!f.name.trim())throw new Error("An active factory has no name / 有有效工厂没有名称");const nm=f.name.trim().toLocaleLowerCase();if(incomingNames.has(nm))throw new Error("Duplicate active factory name in source file: "+f.name+" / 源文件存在重复的有效工厂名称");incomingNames.add(nm);}}',
    '  const rows=incoming.factories.filter(f=>f.status==="active").sort((a,b)=>Number(String(a.id).replace(/^\\D+/,""))-Number(String(b.id).replace(/^\\D+/,"")));',
    '  deletedCount=incoming.factories.filter(f=>f.status==="deleted").length;',
    '  const stable=value=>{if(Array.isArray(value))return "["+value.map(stable).join(",")+"]";if(value&&typeof value==="object")return "{"+Object.keys(value).filter(k=>k!=="updatedAt").sort().map(k=>JSON.stringify(k)+":"+stable(value[k])).join(",")+"}";return JSON.stringify(value);};',
    '  const byId=new Map(state.factories.map(f=>[f.id,f]));const retired=new Set(state.retired||[]);const byName=new Map(state.factories.filter(f=>f.status==="active").map(f=>[String(f.name||"").trim().toLocaleLowerCase(),f]));',
    '  const plan=[];const conflicts=[];',
    '  for(const f of rows){const old=byId.get(f.id);if(old){if(old.status==="active"&&stable(old)===stable(f)){skippedCount++;continue;}conflicts.push("ID "+f.id+" ("+f.name+")");continue;}if(retired.has(f.id)){conflicts.push("retired ID "+f.id);continue;}const sameName=byName.get(String(f.name||"").trim().toLocaleLowerCase());if(sameName){conflicts.push("name "+f.name+" already uses "+sameName.id);continue;}plan.push(f);}',
    '  if(conflicts.length)throw new Error("Conflicts found; no new records were imported: "+conflicts.slice(0,6).join("; ")+(conflicts.length>6?"; …":"")+" / 存在编号或名称冲突，本次未开始导入");',
    '  if(!plan.length){toast("No new factories. Matching active records skipped: "+skippedCount+"; deleted source records ignored: "+deletedCount+" / 没有新工厂，已跳过 "+skippedCount+" 条相同记录，并忽略 "+deletedCount+" 条源文件删除记录");return;}',
    '  if(!confirm("Import "+plan.length+" new active factories into the shared database? Existing records will not be overwritten. "+skippedCount+" matching records will be skipped; "+deletedCount+" deleted source records will be ignored. / 导入 "+plan.length+" 家有效工厂到共享资料库？不会覆盖现有记录；跳过 "+skippedCount+" 条相同记录，忽略源文件中 "+deletedCount+" 条已删除记录。"))return;',
    '  for(const factory of plan){',
    '   if(!canEdit())throw new Error("Edit permission changed during import / 导入期间编辑权限发生变化");',
    '   const candidate=C.clone(state);candidate.factories.push(JSON.parse(JSON.stringify(factory)));',
    '   const number=Number(String(factory.id).replace(/^\\D+/,""));if(Number.isFinite(number))candidate.nextId=Math.max(Number(candidate.nextId)||1,number+1);',
    '   await commit(candidate,false);importedCount++;',
    '   if(importedCount%5===0||importedCount===plan.length)__yourzImportButton.textContent="Importing "+importedCount+"/"+plan.length+" / 导入中 "+importedCount+"/"+plan.length;',
    '  }',
    '  toast("Import complete / 导入完成：新增 "+importedCount+" 家，跳过相同记录 "+skippedCount+" 家，忽略已删除记录 "+deletedCount+" 条");',
    ' }catch(error){toast((importedCount?"Import stopped after "+importedCount+" factories; choose the same file again to resume safely. / 已导入 "+importedCount+" 家后暂停，选择同一文件可安全续传。 ":"Import failed before any new records were imported. / 导入失败。 ")+(error?.message||String(error)));}',
    ' finally{__yourzImportButton.disabled=false;__yourzImportButton.textContent=oldLabel;updateAccess();}',
    '});',
    ''
  ].join('\n');

  source = source.replace(restoreMarker, importCode + '\n' + restoreMarker);
  if (!source.includes(marker) || !source.includes('Conflicts found; no new records were imported') || !source.includes('__yourzImportInput.addEventListener("change"')) {
    throw new Error('Safe import module verification failed.');
  }
}

const scriptRef = /(<script\b[^>]*\bsrc=["'])([^"']*app\.js)(?:\?[^"']*)?(["'][^>]*>)/i;
const scriptMatch = html.match(scriptRef);
if (!scriptMatch) throw new Error('Could not find the app.js reference in index.html.');
const updatedTag = scriptMatch[1] + scriptMatch[2] + '?' + version + scriptMatch[3];
html = html.replace(scriptRef, updatedTag);
if (!html.includes('app.js?' + version)) throw new Error('Could not verify the versioned app.js reference.');

write(jsPath, source);
write(htmlPath, html);
console.log('Safe supplier import module applied: merge-only, per-record writes, duplicate checks, conflict stop, progress and resumable behavior.');
console.log('Browser cache bust applied: app.js?' + version);
