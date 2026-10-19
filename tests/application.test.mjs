import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';

async function start(t, env) {
  const child = spawn(process.execPath, ['app/server.mjs'], {
    env: { ...process.env, PORT: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(async () => {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  });
  const logs = [];
  let buffer = '';
  let stderr = '';
  child.stderr.on('data', (data) => { stderr += data; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timeout: ${stderr}`)), 8000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${stderr}`)); });
    child.stdout.on('data', (data) => {
      buffer += data;
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const record = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1); logs.push(record);
        if (record.event === 'server_started') { clearTimeout(timer); resolve(record.port); }
      }
    });
  });
  return { url: `http://127.0.0.1:${port}`, logs };
}

test('healthy -> bad upstream port -> corrected config; requests and health agree', async (t) => {
  const catalog = await start(t, { APP_ROLE: 'catalog' });
  const healthy = await start(t, { APP_ROLE: 'storefront', CATALOG_URL: catalog.url });
  let result = await fetch(`${healthy.url}/api/catalog`, { headers: { 'x-request-id': 'test-baseline' } });
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.products.length, 3);
  assert.equal(body.requestId, 'test-baseline');
  assert.equal((await fetch(`${healthy.url}/readyz`)).status, 200);

  const temporary = http.createServer(); temporary.listen(0, '127.0.0.1'); await once(temporary, 'listening');
  const closedPort = temporary.address().port; await new Promise((resolve) => temporary.close(resolve));
  const broken = await start(t, { APP_ROLE: 'storefront', CATALOG_URL: `http://127.0.0.1:${closedPort}` });
  result = await fetch(`${broken.url}/api/catalog`, { headers: { 'x-request-id': 'test-broken' } });
  assert.equal(result.status, 503); assert.equal((await result.json()).error, 'catalog_unavailable');
  assert.equal((await fetch(`${broken.url}/livez`)).status, 200);
  assert.equal((await fetch(`${broken.url}/readyz`)).status, 503);
  assert.equal((await fetch(broken.url)).status, 200, 'the HTML shell can work during the incident');
  const failure = broken.logs.find((entry) => entry.event === 'dependency_failed' && entry.requestId === 'test-broken');
  assert.ok(failure, 'the customer request must correlate to the failure log');
  assert.equal(failure.errorCode, 'ECONNREFUSED');
  assert.ok(catalog.logs.some((entry) => entry.requestId === 'test-baseline'));

  const fixed = await start(t, { APP_ROLE: 'storefront', CATALOG_URL: catalog.url });
  for (let i = 0; i < 3; i++) {
    result = await fetch(`${fixed.url}/api/catalog`); assert.equal(result.status, 200);
    assert.equal((await result.json()).products.length, 3);
  }
  assert.equal((await fetch(`${fixed.url}/readyz`)).status, 200);
  assert.equal(fixed.logs.filter((entry) => entry.event === 'dependency_failed').length, 0);
});

test('slow dependency fails within the timeout while liveness remains healthy', async (t) => {
  const slow = http.createServer((request, response) => {
    setTimeout(() => { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"products":[]}'); }, 600).unref();
  });
  slow.listen(0, '127.0.0.1'); await once(slow, 'listening');
  t.after(() => { slow.closeAllConnections(); slow.close(); });
  const storefront = await start(t, { APP_ROLE: 'storefront', CATALOG_URL: `http://127.0.0.1:${slow.address().port}`, REQUEST_TIMEOUT_MS: '100' });
  const result = await fetch(`${storefront.url}/api/catalog`);
  assert.equal(result.status, 503); await result.text();
  assert.ok(storefront.logs.some((entry) => entry.errorCode === 'TimeoutError'));
  assert.equal((await fetch(`${storefront.url}/livez`)).status, 200);
});

test('HTTP routes handle unknown paths and unsupported methods', async (t) => {
  const storefront = await start(t, { APP_ROLE: 'storefront' });
  assert.equal((await fetch(`${storefront.url}/missing`)).status, 404);
  assert.equal((await fetch(`${storefront.url}/api/catalog`, { method: 'POST' })).status, 405);
  const result = await fetch(`${storefront.url}/livez`, { headers: { 'x-request-id': '<script>' } });
  assert.match(result.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
});
