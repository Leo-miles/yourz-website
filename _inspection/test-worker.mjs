import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onRequest } from './src/handler.js';

class BoundStatement {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new BoundStatement(this.db, this.sql, args); }
  async first() { return this.db.sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: this.db.sqlite.prepare(this.sql).all(...this.args) }; }
  async run() {
    const result = this.db.sqlite.prepare(this.sql).run(...this.args);
    return { meta: { changes: Number(result.changes || 0), last_row_id: Number(result.lastInsertRowid || 0) } };
  }
}
class D1Mock {
  constructor() { this.sqlite = new DatabaseSync(':memory:'); }
  async exec(sql) { this.sqlite.exec(sql); return { count: 0 }; }
  prepare(sql) { return new BoundStatement(this, sql); }
  async batch(statements) {
    const results = [];
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      for (const statement of statements) {
        const res = await statement.run();
        results.push(res);
      }
      this.sqlite.exec('COMMIT');
      return results;
    } catch (e) { this.sqlite.exec('ROLLBACK'); throw e; }
  }
}
const DB = new D1Mock();
const env = { DB, BOOTSTRAP_ADMIN_USER:'admin', BOOTSTRAP_ADMIN_PASSWORD:'A-Strong-Test-Password-123!', TIME_ZONE:'Asia/Shanghai' };
async function request(path, { method='GET', body, cookie, csrf, origin='https://yourz.example.test' }={}) {
  const headers = new Headers();
  if (body !== undefined) { headers.set('Content-Type','application/json'); headers.set('Origin',origin); headers.set('X-CSRF-Token',csrf||''); }
  if (cookie) headers.set('Cookie', cookie);
  const req = new Request(origin+path, {method, headers, body:body === undefined ? undefined : JSON.stringify(body)});
  return onRequest({ request:req, env, next:async()=>new Response('STATIC') });
}
const health = await request('/healthz');
assert.equal(health.status,200); assert.equal((await health.json()).storage,'cloudflare-d1');
const login = await request('/auth/local/login',{method:'POST',body:{username:'admin',password:'A-Strong-Test-Password-123!'}});
assert.equal(login.status,200, await login.clone().text());
const adminCookie = login.headers.get('set-cookie').split(';')[0];
const stateResponse = await request('/api/state',{cookie:adminCookie});
assert.equal(stateResponse.status,200);
const initial = await stateResponse.json(); assert.equal(initial.session.role,'admin'); assert.equal(initial.state.factories.length,0);
const csrf = initial.session.csrf;
const factoryData = {name:'Test Factory',products:'Power banks',city:'Yiwu',business:'factory',lead:'days7'};
const save = await request('/api/action',{method:'POST',body:{baseRevision:0,type:'factory.save',data:factoryData},cookie:adminCookie,csrf});
assert.equal(save.status,200, await save.clone().text());
const saved = await save.json(); assert.equal(saved.state.factories.length,1); assert.equal(saved.state.factories[0].id,'F000001');
const addUser = await request('/api/team',{method:'POST',body:{action:'create',userId:'coworker1',password:'Coworker-Password-2026!',role:'editor'},cookie:adminCookie,csrf});
assert.equal(addUser.status,200, await addUser.clone().text());
const memberLogin = await request('/auth/local/login',{method:'POST',body:{username:'coworker1',password:'Coworker-Password-2026!'}});
assert.equal(memberLogin.status,200, await memberLogin.clone().text());
const memberCookie = memberLogin.headers.get('set-cookie').split(';')[0];
const memberStateResp = await request('/api/state',{cookie:memberCookie});
const memberState = await memberStateResp.json(); assert.equal(memberState.state.factories[0].name,'Test Factory'); assert.equal(memberState.session.role,'editor');
const conflict = await request('/api/action',{method:'POST',body:{baseRevision:0,type:'factory.save',data:{...factoryData,name:'Overwriting'}},cookie:memberCookie,csrf:memberState.session.csrf});
assert.equal(conflict.status,409);
const viewOnly = await request('/api/team',{method:'POST',body:{action:'role',userId:'coworker1',role:'viewer'},cookie:adminCookie,csrf});
assert.equal(viewOnly.status,200, await viewOnly.clone().text());
const memberWrite = await request('/api/action',{method:'POST',body:{baseRevision:1,type:'factory.save',id:'F000001',data:{...factoryData,name:'Blocked update'}},cookie:memberCookie,csrf:memberState.session.csrf});
assert.equal(memberWrite.status,403);
const backup = await request('/api/backup',{cookie:adminCookie}); assert.equal(backup.status,200); assert.equal((await backup.json()).factories.length,1);
const logout = await request('/api/logout',{method:'POST',body:{},cookie:adminCookie,csrf}); assert.equal(logout.status,200);
const signedOut = await request('/api/state',{cookie:adminCookie}); assert.equal(signedOut.status,401);
console.log('PASS: bootstrap admin, local sign-in, shared D1 state, add employee, role permissions, save-conflict protection, backup, and logout.');
DB.sqlite.close();
