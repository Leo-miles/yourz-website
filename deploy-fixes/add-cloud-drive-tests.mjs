import fs from 'node:fs';

const root = process.argv[2] || 'app';
const file = root + '/test-worker.mjs';
let t = fs.readFileSync(file, 'utf8');
function once(source, before, after, label) {
  if (!source.includes(before)) throw new Error('Patch target missing: ' + label);
  return source.replace(before, after);
}

const envBefore = "const env = { DB, BOOTSTRAP_ADMIN_USER:'admin', BOOTSTRAP_ADMIN_PASSWORD:'A-Strong-Test-Password-123!', TIME_ZONE:'Asia/Shanghai' };";
const envAfter = [
"const env = { DB, BOOTSTRAP_ADMIN_USER:'admin', BOOTSTRAP_ADMIN_PASSWORD:'A-Strong-Test-Password-123!', TIME_ZONE:'Asia/Shanghai' };",
"const objectStore = new Map();",
"env.FILES = {",
"  async put(key, value, options={}) {",
"    let bytes;",
"    if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);",
"    else if (value instanceof Uint8Array) bytes = value;",
"    else bytes = new Uint8Array(await new Response(value).arrayBuffer());",
"    objectStore.set(key, { bytes:bytes.slice(), options });",
"  },",
"  async get(key) {",
"    const item = objectStore.get(key); if (!item) return null;",
"    const bytes = item.bytes.slice();",
"    return { body:new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}}), arrayBuffer:async()=>bytes.slice().buffer, size:bytes.byteLength, httpMetadata:item.options?.httpMetadata||{} };",
"  },",
"  async delete(key) { objectStore.delete(key); }",
"};"
].join('\n');
t = once(t, envBefore, envAfter, 'attach mocked R2 binding');

const reqAnchor = "const health = await request('/healthz');";
const rawHelper = [
"async function rawRequest(path, { method='POST', body=new Uint8Array(), cookie='', csrf='', extraHeaders={} }={}) {",
"  const headers = new Headers({ 'Origin':'https://yourz.example.test', 'X-CSRF-Token':csrf, 'Content-Type':'application/octet-stream', ...extraHeaders });",
"  if (cookie) headers.set('Cookie',cookie);",
"  const req = new Request('https://yourz.example.test'+path,{method,headers,body});",
"  return onRequest({ request:req, env, next:async()=>new Response('STATIC') });",
"}",
"function cookieFrom(header,name) { const match=String(header||'').match(new RegExp(name+'=[^;,\\\\s]+')); return match?match[0]:''; }",
""
].join('\n') + '\n' + reqAnchor;
t = once(t, reqAnchor, rawHelper, 'add raw R2 upload test helper');

const visitorAnchor = "const anonymousCookie = anonymousEntry.headers.get('set-cookie').split(';')[0];";
t = once(t, visitorAnchor, visitorAnchor + "\nconst anonymousVisitorCookie = cookieFrom(anonymousEntry.headers.get('set-cookie'),'__Host-yourz-visitor');", 'capture anonymous visitor cookie');

const finalAnchor = "console.log('PASS: public entry, shared D1 state, record save, conflict protection, backup, and automatic re-entry.');";
const tests = [
"const driveCookie = anonymousCookie + '; ' + anonymousVisitorCookie;",
"assert.ok(anonymousVisitorCookie,'anonymous entry should set visitor tracking cookie');",
"const driveCsrf = anonymousState.session.csrf;",
"const testFileBytes = new TextEncoder().encode('SKU,Price\\\\nPB01,2.50\\\\n');",
"const uploaded = await rawRequest('/api/files/upload?category=quote',{body:testFileBytes,cookie:driveCookie,csrf:driveCsrf,extraHeaders:{'X-File-Name':encodeURIComponent('测试报价.xlsx')}});",
"assert.equal(uploaded.status,200,await uploaded.clone().text());",
"const uploadedData=await uploaded.json();assert.ok(uploadedData.id);",
"const fileListResponse=await request('/api/files?page=1&pageSize=10',{cookie:driveCookie});",
"assert.equal(fileListResponse.status,200,await fileListResponse.clone().text());",
"const fileList=await fileListResponse.json();assert.ok(fileList.files.some(f=>f.id===uploadedData.id&&f.original_filename==='测试报价.xlsx'));",
"const officeToken=await request('/api/files/preview-token',{method:'POST',body:{id:uploadedData.id},cookie:driveCookie,csrf:driveCsrf});",
"assert.equal(officeToken.status,200,await officeToken.clone().text());",
"const officeData=await officeToken.json();assert.ok(officeData.url.includes('/api/office-source/'));assert.ok(officeData.expiresAt);",
"const officeSource=await request(new URL(officeData.url).pathname);",
"assert.equal(officeSource.status,200,await officeSource.clone().text());",
"assert.equal(await officeSource.text(),new TextDecoder().decode(testFileBytes));",
"const replacementBytes=new TextEncoder().encode('SKU,Price\\\\nPB01,2.80\\\\n');",
"const replaced=await rawRequest('/api/files/replace?id='+encodeURIComponent(uploadedData.id),{body:replacementBytes,cookie:driveCookie,csrf:driveCsrf,extraHeaders:{'X-File-Name':encodeURIComponent('测试报价.xlsx')}});",
"assert.equal(replaced.status,200,await replaced.clone().text());",
"const versionsResponse=await request('/api/files/versions?id='+encodeURIComponent(uploadedData.id),{cookie:driveCookie});",
"assert.equal(versionsResponse.status,200);assert.equal((await versionsResponse.json()).versions.length,2);",
"const restoredVersion=await request('/api/files/restore-version',{method:'POST',body:{id:uploadedData.id,version:1},cookie:driveCookie,csrf:driveCsrf});",
"assert.equal(restoredVersion.status,200,await restoredVersion.clone().text());",
"const movedToTrash=await request('/api/files/action',{method:'POST',body:{action:'delete',id:uploadedData.id},cookie:driveCookie,csrf:driveCsrf});",
"assert.equal(movedToTrash.status,200,await movedToTrash.clone().text());",
"const trashList=await request('/api/files?page=1&pageSize=10&trash=1',{cookie:driveCookie});assert.ok((await trashList.json()).files.some(f=>f.id===uploadedData.id));",
"const restoredFile=await request('/api/files/action',{method:'POST',body:{action:'restore',id:uploadedData.id},cookie:driveCookie,csrf:driveCsrf});assert.equal(restoredFile.status,200,await restoredFile.clone().text());",
"const setLabel=await request('/api/visitor-label',{method:'POST',body:{label:'Test workstation'},cookie:driveCookie,csrf:driveCsrf});assert.equal(setLabel.status,200,await setLabel.clone().text());",
"const exportAudit=await request('/api/audit',{method:'POST',body:{action:'factory.export',targetType:'factory',targetId:'F000001',targetName:'Test factory'},cookie:driveCookie,csrf:driveCsrf});assert.equal(exportAudit.status,200,await exportAudit.clone().text());",
"const backupDownload=await request('/api/backup',{cookie:driveCookie});assert.equal(backupDownload.status,200,await backupDownload.clone().text());",
"const labeledVisitor=await DB.prepare('SELECT visitor_id,device_label FROM visitors WHERE device_label=?').bind('Test workstation').first();assert.ok(labeledVisitor?.visitor_id);",
"const auditActions=(await DB.prepare('SELECT action FROM audit_events').all()).results.map(x=>x.action);",
"for(const action of ['file.upload','file.preview.office','file.replace','file.version.restore','file.delete','file.restore','device.label','factory.export','backup.download'])assert.ok(auditActions.includes(action),'missing audit event '+action);",
"assert.ok(objectStore.size>=2,'R2 mock should retain original and replacement blobs for version history');",
"console.log('PASS: public entry, existing factory flows, mocked R2 upload/list/Office token/download/version restore/trash restore, visitor label and audit trail.');"
].join('\n');
t = once(t, finalAnchor, tests, 'run cloud drive and audit API tests');
fs.writeFileSync(file,t);
console.log('Added mocked-R2 cloud-drive/audit API tests to test-worker.mjs.');
