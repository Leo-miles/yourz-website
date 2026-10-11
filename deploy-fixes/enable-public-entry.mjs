import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2] || 'app';
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, s) => fs.writeFileSync(path.join(root, p), s);
const once = (s, a, b, name) => { if (!s.includes(a)) throw new Error('Patch target missing: '+name); return s.replace(a,b); };

let h = read('src/handler.js');
const helpers = [
"async function ensurePasswordlessMember(db) {",
"  const userId = 'auto-shared';",
"  await db.prepare(\"INSERT OR IGNORE INTO members(user_id,role,last_seen) VALUES(?, 'editor', ?)\").bind(userId, stamp()).run();",
"  await db.prepare(\"UPDATE members SET role='editor' WHERE user_id=?\").bind(userId).run();",
"}",
"async function createPasswordlessSession(db) {",
"  const userId = 'auto-shared';",
"  const raw = token(), csrf = token(), digest = await sha256Hex(raw), now = Date.now();",
"  await db.prepare('DELETE FROM sessions WHERE expires<=?').bind(now).run();",
"  await db.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires) VALUES(?,?,?,?)').bind(digest, userId, csrf, now + SESSION_TTL * 1000).run();",
"  await db.prepare('UPDATE members SET last_seen=? WHERE user_id=?').bind(stamp(), userId).run();",
"  return { session:{ userId, role:'editor', csrf, tokenHash:digest }, cookie:sessionCookie(raw, SESSION_TTL) };",
"}",
"function writeGuard(request, session, admin = false) {"
].join('\n');
h = once(h, 'function writeGuard(request, session, admin = false) {', helpers, 'insert shared visitor sessions');
const sessionOld = "  const session = await currentSession(request, env.DB);\n  if (route === '/api/state' && method === 'GET') {";
const sessionNew = [
"  let session = await currentSession(request, env.DB);",
"  let autoCookie = '';",
"  if (!session && route === '/api/state' && method === 'GET') {",
"    await ensurePasswordlessMember(env.DB);",
"    const created = await createPasswordlessSession(env.DB);",
"    session = created.session;",
"    autoCookie = created.cookie;",
"  }",
"  if (route === '/api/state' && method === 'GET') {"
].join('\n');
h = once(h, sessionOld, sessionNew, 'create session on first visit');
h = once(h,
"    return jsonResponse(request, 200, { state:await readState(env.DB), session:publicSession(session), today:today(envTimeZone()), timeZone:envTimeZone() });",
[
"    const body = { state:await readState(env.DB), session:publicSession(session), today:today(envTimeZone()), timeZone:envTimeZone() };",
"    return autoCookie ? responseWithCookie(request, 200, body, autoCookie) : jsonResponse(request, 200, body);"
].join('\n'), 'set visitor cookie');
h = once(h, "    if (session.role !== 'admin') fail(403, 'Only administrators can download full backups / 只有管理员可下载完整备份');\n", '', 'allow backup download');
h = h.replace("if (session?.role === 'admin') message += ' / 管理员诊断：' + errorName + ': ' + errorMessage;", "if (session) message += ' / 错误详情：' + errorName + ': ' + errorMessage;");
write('src/handler.js', h);

let a = read('public/app.js');
a = once(a,
"function updateAccess(){if(!isAdmin()){teamData=null;if(view==='team')view='factories';}document.getElementById('newfactory').hidden=!canEdit();document.getElementById('backup').hidden=!isAdmin();document.querySelector('[data-view=\"team\"]').hidden=!isAdmin();document.getElementById('signout').hidden=!session;document.getElementById('refresh').hidden=!session;}",
"function updateAccess(){if(!isAdmin()){teamData=null;if(view==='team')view='factories';}document.getElementById('newfactory').hidden=!canEdit();document.getElementById('backup').hidden=!session;document.querySelector('[data-view=\"team\"]').hidden=true;document.getElementById('signout').hidden=true;document.getElementById('refresh').hidden=!session;}",
'hide sign-in-only controls');
const ls = a.indexOf(" function renderLogin(message=''){"), le = a.indexOf(' function requestFrom(candidate,force){', ls);
if (ls < 0 || le < 0) throw new Error('Patch target missing: sign-in panel');
const loginPanel = [
" function renderLogin(message=''){",
"  session=null;updateAccess();document.getElementById('storage').textContent='Connecting / 正在连接';",
"  main.innerHTML='<div class=\"panel\"><h1>Factory Database / 工厂资料库</h1><p class=\"notice error\">'+esc(message||'暂时无法连接共享资料库，请重试。')+'</p><button class=\"primary\" id=\"retryconnection\" type=\"button\">重新连接</button></div>';",
"  document.getElementById('retryconnection').onclick=()=>refresh().catch(e=>renderLogin(e.message));",
" }",
""
].join('\n');
a = a.slice(0, ls) + loginPanel + a.slice(le);
a = once(a,
"async function backup(prefix='Supplier_Backup'){if(!isAdmin())throw Error('Ask an administrator to download a full backup / 请管理员下载完整备份');const data=await api('/api/backup');",
"async function backup(prefix='Supplier_Backup'){const data=await api('/api/backup');",
'allow backup download in UI');
a = a.replace("if(response.status===401){session=null;state=C.blank();renderLogin('Sign in again / 请重新登录');}", "if(response.status===401){session=null;state=C.blank();renderLogin('连接已中断，请点击重新连接。');}");
const formStart = a.indexOf("  if(form.id==='loginform'){"), formEnd = a.indexOf("  if(form.id==='adduserform'){", formStart);
if (formStart < 0 || formEnd < 0 || formEnd <= formStart) throw new Error('Patch target missing: sign-in submit');
a = a.slice(0, formStart) + a.slice(formEnd);
write('public/app.js', a);

let t = read('test-worker.mjs');
t = once(t,
"const health = await request('/healthz');\nassert.equal(health.status,200); assert.equal((await health.json()).storage,'cloudflare-d1');",
[
"const health = await request('/healthz');",
"assert.equal(health.status,200); assert.equal((await health.json()).storage,'cloudflare-d1');",
"const anonymousEntry = await request('/api/state');",
"assert.equal(anonymousEntry.status,200, await anonymousEntry.clone().text());",
"const anonymousCookie = anonymousEntry.headers.get('set-cookie').split(';')[0];",
"const anonymousState = await anonymousEntry.json();",
"assert.equal(anonymousState.session.role,'editor');",
"assert.equal(anonymousState.state.factories.length,0);",
"assert.ok(anonymousCookie.includes('__Host-factory-session='));"
].join('\n'), 'test first entry without credentials');
t = once(t,
"const signedOut = await request('/api/state',{cookie:adminCookie}); assert.equal(signedOut.status,401);\nconsole.log('PASS: bootstrap admin, local sign-in, shared D1 state, add employee, role permissions, save-conflict protection, backup, and logout.');",
[
"const signedOut = await request('/api/state',{cookie:adminCookie}); assert.equal(signedOut.status,200);",
"assert.equal((await signedOut.json()).session.role,'editor');",
"console.log('PASS: public entry, shared D1 state, record save, conflict protection, backup, and automatic re-entry.');"
].join('\n'), 'test automatic re-entry');
write('test-worker.mjs', t);
console.log('Public entry patch applied.');
