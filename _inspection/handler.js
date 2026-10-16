import C from './core.mjs';

const roles = new Set(['viewer', 'editor', 'blocked']);
const factoryFields = ['name','products','city','business','lead','contact','phone','wechat','email','address','workers','area','lines','capacity','specialty','moq','payment','risks','owner','checked','source','other','notes'];
const childFields = {
  stocks: ['product','quantity','price','currency','moq','status','lead','date','model','notes'],
  chats: ['date','summary','needed','timing','exactDate','action','task','owner','ours','theirs','notes'],
  contacts: ['name','position','phone','wechat','email','address','notes']
};
const choices = {
  business: ['','factory','trade','both','unsure','other'], lead: ['','days3','days7','days14','days30','over30','unsure','other'],
  advantages: ['price','quality','delivery','small','custom','other'], status: ['','in','limited','order','unsure','other'],
  needed: ['','yes','no','unsure','other'], timing: ['','today','days3','week1','weeks2','exact','unsure','other'], task: ['','notstarted','progress','done','cancelled','other']
};
const SESSION_COOKIE = '__Host-factory-session';
const SESSION_TTL = 8 * 60 * 60;
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const MAX_RAW_STATE_BYTES = 8 * 1024 * 1024;
const MAX_COMPRESSED_STATE_CHARS = 1_850_000; // D1 maximum row size is 2 MB.
const PBKDF2_ITERATIONS = 180_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let schemaPromise;
const loginAttempts = new Map();

class AppError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const fail = (status, message, code) => { throw new AppError(status, message, code); };
const stamp = () => new Date().toISOString();
function today(timeZone = 'Asia/Shanghai') {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date());
  const part = k => p.find(x => x.type === k).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function normalizeUser(v) {
  if (typeof v !== 'string') fail(400, 'Invalid username / 登录账号无效');
  const s = v.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(s)) fail(400, 'Username must be 3–32 characters using letters, numbers, dot, underscore or hyphen / 账号需为3–32位字母、数字、点、下划线或连字符');
  return s;
}
function cleanPassword(v) {
  if (typeof v !== 'string' || v.length < 12 || v.length > 256) fail(400, 'Password must be 12–256 characters / 密码长度必须为12–256位');
  return v;
}
function text(v, max = 10000) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string' || v.length > max) fail(400, 'Invalid text / 文字无效或过长');
  return v.trim();
}
function checkChoice(key, value) {
  if (!choices[key].includes(value)) fail(400, 'Invalid choice / 选项无效');
  return value;
}
function pick(data, fields, numeric = []) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'Invalid form / 表单无效');
  const result = {};
  for (const key of fields) {
    if (numeric.includes(key)) {
      const value = data[key];
      if (value === undefined || value === null || value === '') result[key] = null;
      else if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(400, 'Invalid number / 数字无效');
      else result[key] = value;
    } else result[key] = text(data[key]);
  }
  return result;
}
function validBackup(data) {
  try {
    const out = C.validate(data);
    for (const f of out.factories) {
      checkChoice('business', f.business || '');
      checkChoice('lead', f.lead || '');
      if (f.advantages.some(x => !choices.advantages.includes(x))) fail(400, 'Invalid advantage / 优势选项无效');
      for (const [k, fields] of Object.entries(childFields)) for (const item of f[k]) {
        for (const key of fields) if (!['quantity','price','moq'].includes(key)) text(item[key]);
        if (k === 'stocks') { checkChoice('status', item.status || ''); checkChoice('lead', item.lead || ''); }
        if (k === 'chats') for (const key of ['needed','timing','task']) checkChoice(key, item[key] || '');
      }
    }
    return out;
  } catch (e) {
    if (e instanceof AppError) throw e;
    fail(400, 'Invalid backup; records unchanged / 备份无效，资料未更改');
  }
}
function randomBytes(size = 32) { const b = new Uint8Array(size); crypto.getRandomValues(b); return b; }
function base64url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function fromBase64url(s) {
  const raw = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(raw + '='.repeat((4 - raw.length % 4) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function token() { return base64url(randomBytes(32)); }
async function sha256Hex(s) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(s));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function passwordHash(password, saltText) {
  const salt = fromBase64url(saltText);
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name:'PBKDF2', hash:'SHA-256', salt, iterations:PBKDF2_ITERATIONS }, key, 256);
  return base64url(new Uint8Array(bits));
}
function secureEqual(a, b) {
  const x = encoder.encode(String(a)), y = encoder.encode(String(b));
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i % (x.length || 1)] || 0) ^ (y[i % (y.length || 1)] || 0);
  return diff === 0;
}
async function gzipText(textValue) {
  const stream = new Blob([textValue]).stream().pipeThrough(new CompressionStream('gzip'));
  return base64url(new Uint8Array(await new Response(stream).arrayBuffer()));
}
async function gunzipText(value) {
  const stream = new Blob([fromBase64url(value)]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}
const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspace (
 id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0, write_token TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS members (
 user_id TEXT PRIMARY KEY,
 role TEXT NOT NULL CHECK(role IN ('admin','viewer','editor','blocked')),
 last_seen TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS credentials (
 user_id TEXT PRIMARY KEY REFERENCES members(user_id) ON DELETE CASCADE,
 salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL,
 csrf TEXT NOT NULL, expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL,
 user_id TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
CREATE INDEX IF NOT EXISTS idx_audit_id ON audit(id DESC);
`;
async function doEnsureSchema(db) {
  await db.exec(SCHEMA);
  const packed = await gzipText(JSON.stringify(C.blank()));
  await db.prepare('INSERT OR IGNORE INTO workspace(id,payload,revision,write_token) VALUES(1,?,0,?)').bind(packed, '').run();
}
async function ensureSchema(db) {
  if (!db) fail(503, 'Database binding is not configured yet. Follow the Cloudflare setup guide. / 尚未配置数据库，请按 Cloudflare 部署说明完成绑定。', 'setup');
  if (!schemaPromise) schemaPromise = doEnsureSchema(db).catch(e => { schemaPromise = null; throw e; });
  await schemaPromise;
}
async function ensureBootstrapAdmin(db, env) {
  const current = await db.prepare("SELECT user_id FROM members WHERE role='admin' LIMIT 1").first();
  if (current) return true;
  if (!env.BOOTSTRAP_ADMIN_USER || !env.BOOTSTRAP_ADMIN_PASSWORD) return false;
  const userId = normalizeUser(env.BOOTSTRAP_ADMIN_USER);
  const password = cleanPassword(env.BOOTSTRAP_ADMIN_PASSWORD);
  const salt = base64url(randomBytes(16));
  const derived = await passwordHash(password, salt);
  const now = stamp();
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO members(user_id,role,last_seen) SELECT ?, 'admin', ? WHERE NOT EXISTS (SELECT 1 FROM members WHERE role='admin')").bind(userId, now),
    db.prepare('INSERT OR IGNORE INTO credentials(user_id,salt,password_hash,created_at) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM members WHERE user_id=? AND role=\'admin\')').bind(userId, salt, derived, now, userId)
  ]);
  return !!(await db.prepare("SELECT user_id FROM members WHERE role='admin' LIMIT 1").first());
}
async function readState(db) {
  const row = await db.prepare('SELECT payload,revision FROM workspace WHERE id=1').first();
  if (!row) fail(500, 'Shared workspace is not initialized / 共享资料库尚未初始化');
  try {
    const s = C.validate(JSON.parse(await gunzipText(row.payload)));
    if (s.revision !== row.revision) s.revision = row.revision;
    return s;
  } catch { fail(500, 'Shared data could not be read; ask the administrator to restore a backup / 共享资料读取失败，请管理员从备份恢复'); }
}
function cookieValue(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  for (const part of cookie.split(';')) {
    const i = part.indexOf('=');
    if (i >= 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}
function sessionCookie(value, maxAge) { return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`; }
function securityHeaders(headers, origin) {
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  if (origin.startsWith('https://')) headers.set('Strict-Transport-Security', 'max-age=31536000');
  return headers;
}
function jsonResponse(request, status, body, extra = {}) {
  const headers = securityHeaders(new Headers({ 'Content-Type':'application/json; charset=utf-8', ...extra }), new URL(request.url).origin);
  return new Response(JSON.stringify(body), { status, headers });
}
function responseWithCookie(request, status, body, cookie) {
  return jsonResponse(request, status, body, { 'Set-Cookie': cookie });
}
function requireOrigin(request) {
  const origin = request.headers.get('Origin');
  if (origin !== new URL(request.url).origin) fail(403, 'Request could not be verified; refresh the app / 无法验证请求，请刷新应用');
}
async function parseBody(request) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_BODY_BYTES) fail(413, 'File or form exceeds 10 MB / 文件或表单超过10MB');
  const raw = await request.text();
  if (encoder.encode(raw).length > MAX_BODY_BYTES) fail(413, 'File or form exceeds 10 MB / 文件或表单超过10MB');
  try { return JSON.parse(raw); } catch { fail(400, 'Invalid JSON / 数据格式无效'); }
}
function publicSession(s) { return { userId:s.userId, role:s.role, csrf:s.csrf }; }
async function currentSession(request, db) {
  const raw = cookieValue(request, SESSION_COOKIE);
  if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
  const digest = await sha256Hex(raw);
  const row = await db.prepare(`SELECT s.token_hash,s.user_id,s.csrf,s.expires,m.role
    FROM sessions s JOIN members m ON m.user_id=s.user_id
    WHERE s.token_hash=? AND s.expires>?`).bind(digest, Date.now()).first();
  if (!row) return null;
  if (row.role === 'blocked') fail(403, 'Your access has been removed / 您的权限已被取消', 'blocked');
  return { userId:row.user_id, role:row.role, csrf:row.csrf, tokenHash:row.token_hash };
}
function writeGuard(request, session, admin = false) {
  if (!session) fail(401, 'Please sign in to use the shared database / 请先登录共享资料库', 'signin');
  if (admin && session.role !== 'admin' || !admin && !['admin','editor'].includes(session.role)) fail(403, 'You do not have permission for this action / 您没有此操作权限');
  requireOrigin(request);
  if (request.headers.get('X-CSRF-Token') !== session.csrf) fail(403, 'Request could not be verified; refresh the app / 无法验证请求，请刷新应用');
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) fail(415, 'Use JSON content / 数据格式必须为JSON');
}
async function login(request, env, db) {
  requireOrigin(request);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  let attempt = loginAttempts.get(ip);
  if (!attempt || now > attempt.resetAt) attempt = { count:0, resetAt:now + 10 * 60 * 1000 };
  if (attempt.count >= 10) fail(429, 'Too many sign-in attempts; wait 10 minutes / 登录尝试过多，请10分钟后重试');
  attempt.count += 1; loginAttempts.set(ip, attempt);
  const input = await parseBody(request);
  let userId;
  try { userId = normalizeUser(input.username); } catch { userId = ''; }
  const password = typeof input.password === 'string' && input.password.length <= 256 ? input.password : '';
  const row = userId ? await db.prepare(`SELECT m.user_id,m.role,c.salt,c.password_hash
    FROM members m JOIN credentials c ON c.user_id=m.user_id WHERE m.user_id=?`).bind(userId).first() : null;
  if (!row || !password || row.role === 'blocked') {
    // Perform a dummy KDF for unknown users to reduce username-enumeration timing differences.
    await passwordHash(password || 'invalid-password-guard', base64url(new Uint8Array(16)));
    fail(401, 'Incorrect username or password / 登录账号或密码错误', 'signin');
  }
  const derived = await passwordHash(password, row.salt);
  if (!secureEqual(derived, row.password_hash)) fail(401, 'Incorrect username or password / 登录账号或密码错误', 'signin');
  const raw = token(), csrf = token(), digest = await sha256Hex(raw), expires = Date.now() + SESSION_TTL * 1000;
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires<=?').bind(now),
    db.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires) VALUES(?,?,?,?)').bind(digest, row.user_id, csrf, expires),
    db.prepare('UPDATE members SET last_seen=? WHERE user_id=?').bind(stamp(), row.user_id)
  ]);
  loginAttempts.delete(ip);
  return responseWithCookie(request, 200, { ok:true }, sessionCookie(raw, SESSION_TTL));
}
function editState(session, request, old) {
  if (!Number.isSafeInteger(request.baseRevision) || request.baseRevision !== old.revision)
    fail(409, 'Someone else saved changes. Keep your notes and refresh before saving again. / 其他人已保存修改，请保留未保存文字，刷新后再保存。', 'conflict');
  const id = text(request.id, 80), data = request.data;
  let next, recordId = id;
  switch (request.type) {
    case 'factory.save': {
      const input = pick(data, factoryFields);
      checkChoice('business', input.business); checkChoice('lead', input.lead);
      if (data.advantages !== undefined && (!Array.isArray(data.advantages) || data.advantages.length > 20)) fail(400, 'Invalid advantages / 优势无效');
      input.advantages = [...new Set((data.advantages || []).map(x => text(x, 80)))];
      if (input.advantages.some(x => !choices.advantages.includes(x))) fail(400, 'Invalid advantages / 优势无效');
      const r = C.saveFactory(old, input, id, stamp()); next = r.state; recordId = r.id; break;
    }
    case 'child.save': {
      const kind = text(request.kind, 30);
      if (!childFields[kind]) fail(400, 'Invalid record type / 记录类型无效');
      const input = pick(data, childFields[kind], kind === 'stocks' ? ['quantity','price','moq'] : []);
      if (data.id) input.id = text(data.id, 80);
      if (kind === 'stocks') { checkChoice('status', input.status); checkChoice('lead', input.lead); }
      if (kind === 'chats') {
        for (const k of ['needed','timing','task']) checkChoice(k, input[k]);
        if (input.timing === 'exact' && !input.exactDate && input.needed !== 'no') fail(400, 'Choose an exact date or a different timing option / 请填写指定日期或改选其他时间');
      }
      next = C.saveChild(old, id, kind, input, stamp(), today(envTimeZone())); break;
    }
    case 'factory.delete': {
      const f = C.factory(old, id);
      if (f.status !== 'active') fail(400, 'Factory is already in Trash / 工厂已在回收站');
      if (request.confirmName !== f.name) fail(400, 'Factory name changed; refresh and confirm again / 工厂名称已改变，请刷新并再次确认');
      next = C.setDeleted(old, id, true, stamp()); break;
    }
    case 'factory.restore': {
      if (C.factory(old, id).status !== 'deleted') fail(400, 'Factory is not in Trash / 工厂不在回收站');
      next = C.setDeleted(old, id, false, stamp()); break;
    }
    case 'factory.purge': {
      if (session.role !== 'admin') fail(403, 'Only an administrator can delete permanently / 只有管理员可永久删除');
      if (request.confirmName !== C.factory(old, id).name) fail(400, 'Factory name does not match / 工厂名称不匹配');
      next = C.purge(old, id); break;
    }
    case 'backup.restore': {
      if (session.role !== 'admin') fail(403, 'Only an administrator can restore a full backup / 只有管理员可恢复完整备份');
      next = C.restoreBackup(old, validBackup(request.backup)); break;
    }
    default: fail(400, 'Unknown action / 未知操作');
  }
  next = C.validate(next); next.revision = old.revision + 1;
  return { next, recordId };
}
let configuredTimeZone = 'Asia/Shanghai';
function envTimeZone() { return configuredTimeZone; }
async function saveEdit(request, db, session, input) {
  const old = await readState(db);
  const { next, recordId } = editState(session, input, old);
  const raw = JSON.stringify(next);
  if (encoder.encode(raw).length > MAX_RAW_STATE_BYTES) fail(413, 'Database size limit reached; ask the administrator / 数据库达到容量限制，请联系管理员');
  const packed = await gzipText(raw);
  if (packed.length > MAX_COMPRESSED_STATE_CHARS) fail(413, 'The compressed data exceeds this free database row limit. Export a backup and contact the administrator / 压缩后的资料超过免费数据库单行容量，请先备份并联系管理员');
  const writeToken = token();
  const batch = await db.batch([
    db.prepare('UPDATE workspace SET payload=?,revision=?,write_token=? WHERE id=1 AND revision=?').bind(packed, next.revision, writeToken, old.revision),
    db.prepare(`INSERT INTO audit(at,user_id,action,target)
      SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM workspace WHERE id=1 AND revision=? AND write_token=?)`).bind(stamp(), session.userId, input.type, recordId, next.revision, writeToken)
  ]);
  if (Number(batch?.[0]?.meta?.changes || 0) !== 1) fail(409, 'Someone else saved changes. Keep your notes and refresh before saving again. / 其他人已保存修改，请保留未保存文字，刷新后再保存。', 'conflict');
  return { state:next, recordId, session:publicSession(session), today:today(envTimeZone()), timeZone:envTimeZone() };
}
async function handleApp(request, env, context) {
  const url = new URL(request.url), route = url.pathname, method = request.method.toUpperCase();
  const apiPath = route.startsWith('/api/');
  const authPath = route.startsWith('/auth/');
  if (route !== '/healthz' && !apiPath && !authPath) return await context.next();
  await ensureSchema(env.DB);
  configuredTimeZone = typeof env.TIME_ZONE === 'string' && env.TIME_ZONE ? env.TIME_ZONE : 'Asia/Shanghai';
  new Intl.DateTimeFormat('en-CA', { timeZone:configuredTimeZone });

  if (route === '/healthz' && method === 'GET') {
    await ensureBootstrapAdmin(env.DB, env);
    return jsonResponse(request, 200, { ok:true, storage:'cloudflare-d1', auth:'local' });
  }
  if (route === '/auth/local/login' && method === 'POST') {
    const admin = await ensureBootstrapAdmin(env.DB, env);
    if (!admin) fail(503, 'Initial administrator is not configured. Add BOOTSTRAP_ADMIN_USER and secret BOOTSTRAP_ADMIN_PASSWORD in Cloudflare Pages settings, then redeploy. / 初始管理员尚未配置，请在 Cloudflare Pages 设置 BOOTSTRAP_ADMIN_USER 和保密变量 BOOTSTRAP_ADMIN_PASSWORD 后重新部署。', 'setup');
    return await login(request, env, env.DB);
  }
  if (authPath) fail(404, 'Authentication route not found / 登录接口不存在');
  const session = await currentSession(request, env.DB);
  if (route === '/api/state' && method === 'GET') {
    if (!session) fail(401, 'Please sign in to use the shared database / 请先登录共享资料库', 'signin');
    return jsonResponse(request, 200, { state:await readState(env.DB), session:publicSession(session), today:today(envTimeZone()), timeZone:envTimeZone() });
  }
  if (route === '/api/backup' && method === 'GET') {
    if (!session) fail(401, 'Please sign in to use the shared database / 请先登录共享资料库', 'signin');
    if (session.role !== 'admin') fail(403, 'Only administrators can download full backups / 只有管理员可下载完整备份');
    const headers = securityHeaders(new Headers({ 'Content-Type':'application/json; charset=utf-8', 'Content-Disposition':`attachment; filename="Supplier_Backup_${today(envTimeZone())}.json"` }), url.origin);
    return new Response(JSON.stringify(await readState(env.DB)), { status:200, headers });
  }
  if (route === '/api/action' && method === 'POST') {
    writeGuard(request, session);
    const input = await parseBody(request);
    return jsonResponse(request, 200, await saveEdit(request, env.DB, session, input));
  }
  if (route === '/api/logout' && method === 'POST') {
    if (!session) return responseWithCookie(request, 200, { ok:true }, sessionCookie('', 0));
    requireOrigin(request);
    if (request.headers.get('X-CSRF-Token') !== session.csrf) fail(403, 'Request could not be verified / 无法验证请求');
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(session.tokenHash).run();
    return responseWithCookie(request, 200, { ok:true }, sessionCookie('', 0));
  }
  if (route === '/api/team' && method === 'GET') {
    if (!session) fail(401, 'Please sign in to use the shared database / 请先登录共享资料库', 'signin');
    if (session.role !== 'admin') fail(403, 'Administrator access required / 需要管理员权限');
    const memberResult = await env.DB.prepare('SELECT user_id,role,last_seen FROM members ORDER BY user_id').all();
    const auditResult = await env.DB.prepare('SELECT at,user_id,action,target FROM audit ORDER BY id DESC LIMIT 100').all();
    return jsonResponse(request, 200, { members:memberResult.results || [], audit:auditResult.results || [] });
  }
  if (route === '/api/team' && method === 'POST') {
    writeGuard(request, session, true);
    const input = await parseBody(request);
    const action = input.action || 'role';
    const id = normalizeUser(input.userId);
    if (action === 'create') {
      const password = cleanPassword(input.password);
      const role = input.role;
      if (!['viewer','editor'].includes(role)) fail(400, 'Choose viewer or editor access / 请选择只读或可编辑权限');
      const salt = base64url(randomBytes(16)), derived = await passwordHash(password, salt), at = stamp();
      try {
        await env.DB.batch([
          env.DB.prepare('INSERT INTO members(user_id,role,last_seen) VALUES(?,?,?)').bind(id, role, at),
          env.DB.prepare('INSERT INTO credentials(user_id,salt,password_hash,created_at) VALUES(?,?,?,?)').bind(id, salt, derived, at),
          env.DB.prepare('INSERT INTO audit(at,user_id,action,target) VALUES(?,?,?,?)').bind(at, session.userId, 'team.create', id)
        ]);
      } catch { fail(409, 'This account already exists / 此账号已存在'); }
      return jsonResponse(request, 200, { ok:true, userId:id });
    }
    if (action === 'reset_password') {
      if (id === session.userId) { /* keep the current session alive */ }
      const password = cleanPassword(input.password);
      const existing = await env.DB.prepare('SELECT user_id FROM credentials WHERE user_id=?').bind(id).first();
      if (!existing) fail(404, 'Account not found / 账号不存在');
      const salt = base64url(randomBytes(16)), derived = await passwordHash(password, salt), at = stamp();
      await env.DB.batch([
        env.DB.prepare('UPDATE credentials SET salt=?,password_hash=?,created_at=? WHERE user_id=?').bind(salt, derived, at, id),
        env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').bind(id, id === session.userId ? session.tokenHash : ''),
        env.DB.prepare('INSERT INTO audit(at,user_id,action,target) VALUES(?,?,?,?)').bind(at, session.userId, 'team.password.reset', id)
      ]);
      return jsonResponse(request, 200, { ok:true });
    }
    if (action === 'role') {
      const role = input.role;
      if (!roles.has(role)) fail(400, 'Choose a valid access role / 请选择有效权限');
      const target = await env.DB.prepare('SELECT role FROM members WHERE user_id=?').bind(id).first();
      if (!target) fail(404, 'Account not found / 账号不存在');
      if (target.role === 'admin') fail(400, 'The primary administrator role cannot be changed here / 不能在此处修改主管理员权限');
      const at = stamp();
      await env.DB.batch([
        env.DB.prepare('UPDATE members SET role=? WHERE user_id=?').bind(role, id),
        ...(role === 'blocked' ? [env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(id)] : []),
        env.DB.prepare('INSERT INTO audit(at,user_id,action,target) VALUES(?,?,?,?)').bind(at, session.userId, 'team.role', id)
      ]);
      return jsonResponse(request, 200, { ok:true });
    }
    fail(400, 'Unknown team action / 未知团队操作');
  }
  fail(404, 'Action not found / 操作不存在');
}

export async function onRequest(context) {
  const { request, env } = context;
  try {
    const response = await handleApp(request, env, context);
    const headers = new Headers(response.headers);
    securityHeaders(headers, new URL(request.url).origin);
    return new Response(response.body, { status:response.status, statusText:response.statusText, headers });
  } catch (e) {
    const message = e instanceof AppError ? e.message : 'Server error; records unchanged / 服务器错误，资料未更改';
    return jsonResponse(request, e instanceof AppError ? e.status : 500, { error:message, code:e instanceof AppError ? (e.code || 'error') : 'error' });
  }
}
