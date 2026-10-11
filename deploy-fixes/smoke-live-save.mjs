import assert from 'node:assert/strict';

const base = process.env.DEPLOY_URL;
const username = process.env.BOOTSTRAP_ADMIN_USER;
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
if (!base || !username || !password) throw new Error('Live smoke test is missing required deployment settings.');

const api = path => new URL(path, base).toString();
async function jsonFetch(path, { method = 'GET', cookie = '', csrf = '', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers.Origin = base;
    headers['X-CSRF-Token'] = csrf;
  }
  const response = await fetch(api(path), {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual'
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = { error: raw.slice(0, 300) }; }
  const cookieHeader = response.headers.get('set-cookie') || '';
  return { status: response.status, data, cookie: cookieHeader.match(/__Host-factory-session=[^;]+/)?.[0] || '' };
}
function need(ok, message) {
  if (!ok) throw new Error(message);
}
async function loadAdminState(cookie, reason = 'Could not load the administrator view') {
  const current = await jsonFetch('/api/state', { cookie });
  need(current.status === 200 && current.data.session?.role === 'admin', reason + ': HTTP ' + current.status + ' ' + JSON.stringify(current.data));
  return current;
}
async function purgeRecord(cookie, currentState, record) {
  let state = currentState;
  let found = (state.data.state.factories || []).find(f => f.id === record.id);
  if (!found) return await loadAdminState(cookie);
  if (found.status !== 'deleted') {
    const moved = await jsonFetch('/api/action', {
      method: 'POST',
      cookie,
      csrf: state.data.session.csrf,
      body: { baseRevision: state.data.state.revision, type: 'factory.delete', id: found.id, confirmName: found.name }
    });
    need(moved.status === 200, 'Could not move temporary test record to Trash: HTTP ' + moved.status + ' ' + JSON.stringify(moved.data));
    state = await loadAdminState(cookie, 'Could not reload after moving the temporary test record to Trash');
  }
  found = (state.data.state.factories || []).find(f => f.id === record.id);
  if (found) {
    const purged = await jsonFetch('/api/action', {
      method: 'POST',
      cookie,
      csrf: state.data.session.csrf,
      body: { baseRevision: state.data.state.revision, type: 'factory.purge', id: found.id, confirmName: found.name }
    });
    need(purged.status === 200, 'Could not permanently remove temporary test record: HTTP ' + purged.status + ' ' + JSON.stringify(purged.data));
  }
  return await loadAdminState(cookie, 'Could not verify removal of temporary test record');
}
async function clearOldTestRecords(cookie, state) {
  let current = state;
  const oldRecords = (current.data.state.factories || []).filter(f => typeof f.name === 'string' && f.name.startsWith('ZZ_DEPLOY_SMOKE_'));
  for (const record of oldRecords) {
    current = await purgeRecord(cookie, current, record);
    console.log('Removed an old temporary deployment-test record.');
  }
  return current;
}

const suffix = Math.random().toString(36).slice(2, 10);
const testName = 'ZZ_DEPLOY_SMOKE_' + Date.now() + '_' + suffix;
let cleanupWarnings = [];
let adminCookie = '';

try {
  const health = await jsonFetch('/healthz');
  need(health.status === 200 && health.data.ok === true, 'Live health check failed: HTTP ' + health.status + ' ' + JSON.stringify(health.data));

  const visitor = await jsonFetch('/api/state');
  need(visitor.status === 200, 'Public entry failed: HTTP ' + visitor.status + ' ' + JSON.stringify(visitor.data));
  need(visitor.cookie.startsWith('__Host-factory-session='), 'Public entry did not issue a session cookie.');
  need(visitor.data.session?.role === 'editor', 'Public visitor did not receive edit access.');

  const adminLogin = await jsonFetch('/auth/local/login', { method: 'POST', body: { username, password } });
  need(adminLogin.status === 200 && adminLogin.cookie, 'Administrator cleanup login failed: HTTP ' + adminLogin.status + ' ' + JSON.stringify(adminLogin.data));
  adminCookie = adminLogin.cookie;
  let adminState = await loadAdminState(adminCookie, 'Administrator state check failed');
  adminState = await clearOldTestRecords(adminCookie, adminState);

  const create = await jsonFetch('/api/action', {
    method: 'POST',
    cookie: visitor.cookie,
    csrf: visitor.data.session.csrf,
    body: {
      baseRevision: adminState.data.state.revision,
      type: 'factory.save',
      data: { name: testName, products: 'deployment smoke test', city: 'temporary test', business: 'factory', lead: 'days7' }
    }
  });
  need(create.status === 200, 'Real database save failed: HTTP ' + create.status + ' ' + JSON.stringify(create.data));
  need(create.data.state?.factories?.some(f => f.name === testName), 'Save returned success but the test record was not returned.');
  const testRecord = create.data.state.factories.find(f => f.name === testName);
  need(testRecord?.id, 'The saved test record has no ID.');

  adminState = await loadAdminState(adminCookie, 'Could not reload records before cleaning up the test record');
  need(adminState.data.state.factories.some(f => f.id === testRecord.id && f.name === testName), 'Saved test record was not found after reloading from D1.');
  adminState = await purgeRecord(adminCookie, adminState, testRecord);
  need(!adminState.data.state.factories.some(f => f.name === testName), 'The temporary test record is still present after cleanup.');

  const stable = 'https://yourz-website.pages.dev';
  try {
    const stableHealth = await fetch(new URL('/healthz', stable), { redirect: 'manual' });
    console.log('Stable site health: HTTP ' + stableHealth.status);
  } catch (error) {
    console.log('Stable site health check unavailable: ' + (error?.message || error));
  }
  console.log('PASS: live public entry, live D1 save, live D1 reload, and automatic removal of the temporary test record.');
} catch (error) {
  try {
    if (!adminCookie) {
      const login = await jsonFetch('/auth/local/login', { method: 'POST', body: { username, password } });
      if (login.status === 200) adminCookie = login.cookie;
    }
    if (adminCookie) {
      let current = await loadAdminState(adminCookie);
      current = await clearOldTestRecords(adminCookie, current);
      const stillPresent = current.data.state.factories.some(f => f.name === testName);
      if (stillPresent) cleanupWarnings.push('The current temporary test entry still exists after cleanup.');
    } else {
      cleanupWarnings.push('Administrator cleanup login failed; no record should have been created before the save test succeeded.');
    }
  } catch (cleanupError) {
    cleanupWarnings.push('Cleanup check failed: ' + (cleanupError?.message || cleanupError));
  }
  console.error('LIVE SMOKE TEST FAILED: ' + (error?.message || error));
  for (const warning of cleanupWarnings) console.error('CLEANUP WARNING: ' + warning);
  process.exitCode = 1;
}
