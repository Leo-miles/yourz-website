import assert from 'node:assert/strict';

const base = process.env.DEPLOY_URL;
const username = process.env.BOOTSTRAP_ADMIN_USER;
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
if (!base || !username || !password) throw new Error('Live smoke test is missing required deployment settings.');

const api = (path) => new URL(path, base).toString();
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
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 300) }; }
  const cookieHeader = response.headers.get('set-cookie') || '';
  return { status: response.status, data, cookie: cookieHeader.match(/__Host-factory-session=[^;]+/)?.[0] || '' };
}
function need(ok, message) {
  if (!ok) throw new Error(message);
}
const suffix = Math.random().toString(36).slice(2, 10);
const testName = 'ZZ_DEPLOY_SMOKE_' + Date.now() + '_' + suffix;
let cleanupWarnings = [];

try {
  const health = await jsonFetch('/healthz');
  need(health.status === 200 && health.data.ok === true, 'Live health check failed: HTTP ' + health.status + ' ' + JSON.stringify(health.data));

  const visitor = await jsonFetch('/api/state');
  need(visitor.status === 200, 'Public entry failed: HTTP ' + visitor.status + ' ' + JSON.stringify(visitor.data));
  need(visitor.cookie.startsWith('__Host-factory-session='), 'Public entry did not issue a session cookie.');
  need(visitor.data.session?.role === 'editor', 'Public visitor did not receive edit access.');

  const adminLogin = await jsonFetch('/auth/local/login', {
    method: 'POST',
    body: { username, password }
  });
  need(adminLogin.status === 200 && adminLogin.cookie, 'Administrator cleanup login failed: HTTP ' + adminLogin.status + ' ' + JSON.stringify(adminLogin.data));
  const adminState = await jsonFetch('/api/state', { cookie: adminLogin.cookie });
  need(adminState.status === 200 && adminState.data.session?.role === 'admin', 'Administrator state check failed: HTTP ' + adminState.status + ' ' + JSON.stringify(adminState.data));

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

  const latestAdminState = await jsonFetch('/api/state', { cookie: adminLogin.cookie });
  need(latestAdminState.status === 200, 'Could not reload records before cleaning up the test record.');
  const purge = await jsonFetch('/api/action', {
    method: 'POST',
    cookie: adminLogin.cookie,
    csrf: latestAdminState.data.session.csrf,
    body: {
      baseRevision: latestAdminState.data.state.revision,
      type: 'factory.purge',
      id: testRecord.id,
      confirmName: testName
    }
  });
  need(purge.status === 200, 'Save test passed, but automatic cleanup failed: HTTP ' + purge.status + ' ' + JSON.stringify(purge.data));
  need(!purge.data.state?.factories?.some(f => f.name === testName), 'The temporary test record is still present after cleanup.');

  const stable = 'https://yourz-website.pages.dev';
  try {
    const stableHealth = await fetch(new URL('/healthz', stable), { redirect: 'manual' });
    console.log('Stable site health: HTTP ' + stableHealth.status);
  } catch (error) {
    console.log('Stable site health check unavailable: ' + (error?.message || error));
  }
  console.log('PASS: live public entry, live D1 save, live D1 reload, and automatic removal of the temporary test record.');
} catch (error) {
  // Best-effort cleanup in case the save committed but the response failed.
  try {
    const login = await jsonFetch('/auth/local/login', {
      method: 'POST',
      body: { username, password }
    });
    if (login.status === 200 && login.cookie) {
      const state = await jsonFetch('/api/state', { cookie: login.cookie });
      const matches = (state.data?.state?.factories || []).filter(f => f.name === testName);
      for (const record of matches) {
        const purge = await jsonFetch('/api/action', {
          method: 'POST',
          cookie: login.cookie,
          csrf: state.data.session?.csrf,
          body: { baseRevision: state.data.state.revision, type: 'factory.purge', id: record.id, confirmName: testName }
        });
        if (purge.status !== 200) cleanupWarnings.push('Could not automatically remove the temporary test entry (HTTP ' + purge.status + ').');
      }
    } else {
      cleanupWarnings.push('Could not authenticate cleanup; check for a record named ' + testName + ' if the save response was ambiguous.');
    }
  } catch (cleanupError) {
    cleanupWarnings.push('Cleanup check failed: ' + (cleanupError?.message || cleanupError));
  }
  console.error('LIVE SMOKE TEST FAILED: ' + (error?.message || error));
  for (const warning of cleanupWarnings) console.error('CLEANUP WARNING: ' + warning);
  process.exitCode = 1;
}
