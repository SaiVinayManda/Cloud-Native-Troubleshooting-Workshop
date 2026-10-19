import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const role = process.env.APP_ROLE || 'storefront';
if (!['catalog', 'storefront'].includes(role)) throw new Error('APP_ROLE must be catalog or storefront');
const port = Number(process.env.PORT ?? (role === 'catalog' ? 8081 : 8080));
const catalogUrl = process.env.CATALOG_URL || 'http://catalog:8081';
const timeout = Number(process.env.REQUEST_TIMEOUT_MS || 1200);
const products = [
  { id: 'mug', name: 'Trail mug', price: 18 },
  { id: 'notebook', name: 'Field notebook', price: 12 },
  { id: 'tote', name: 'Canvas tote', price: 24 }
];
const files = role === 'storefront' ? new Map(await Promise.all([
  ['/', 'index.html', 'text/html'], ['/styles.css', 'styles.css', 'text/css'], ['/client.js', 'client.js', 'text/javascript']
].map(async ([path, file, type]) => [path, { body: await readFile(new URL(`./public/${file}`, import.meta.url)), type }]))) : new Map();

function log(level, event, details = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, service: role, event, ...details }));
}
function json(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(payload));
}

const server = http.createServer(async (request, response) => {
  const started = Date.now();
  const path = new URL(request.url, 'http://localhost').pathname;
  const suppliedId = request.headers['x-request-id'];
  const requestId = typeof suppliedId === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(suppliedId) ? suppliedId : randomUUID();
  response.setHeader('x-request-id', requestId);
  response.on('finish', () => {
    // Healthy probe traffic is intentionally quiet; failed dependencies are always logged.
    if (path !== '/livez' && path !== '/readyz') {
      log('info', 'http_request', { requestId, method: request.method, path, status: response.statusCode, durationMs: Date.now() - started });
    }
  });
  if (request.method !== 'GET') return json(response, 405, { error: 'method_not_allowed', requestId });
  if (path === '/livez') return json(response, 200, { status: 'alive', service: role });
  if (role === 'catalog') {
    if (path === '/readyz') return json(response, 200, { status: 'ready', service: role });
    if (path === '/items') return json(response, 200, { products });
    return json(response, 404, { error: 'not_found', requestId });
  }
  const file = files.get(path);
  if (file) {
    response.writeHead(200, { 'content-type': `${file.type}; charset=utf-8` });
    return response.end(file.body);
  }
  if (path !== '/api/catalog' && path !== '/readyz') return json(response, 404, { error: 'not_found', requestId });
  try {
    const upstream = await fetch(new URL('/items', catalogUrl), {
      headers: { 'x-request-id': requestId }, signal: AbortSignal.timeout(timeout)
    });
    if (!upstream.ok) {
      const error = new Error(`upstream HTTP ${upstream.status}`);
      error.code = 'UPSTREAM_HTTP_ERROR';
      throw error;
    }
    const data = await upstream.json();
    if (!Array.isArray(data.products)) {
      const error = new Error('upstream response has no products array');
      error.code = 'UPSTREAM_INVALID_RESPONSE';
      throw error;
    }
    return json(response, 200, path === '/readyz' ? { status: 'ready', service: role } : { status: 'ok', products: data.products, requestId });
  } catch (error) {
    const errorCode = error.name === 'TimeoutError' ? error.name : (error.cause?.code || error.code || error.name);
    log('error', 'dependency_failed', { requestId, upstream: catalogUrl, errorCode, durationMs: Date.now() - started });
    return json(response, 503, {
      status: 'unavailable', error: 'catalog_unavailable', requestId,
      message: 'The storefront cannot reach its catalog. Inspect the application logs.'
    });
  }
});

server.listen(port, '0.0.0.0', () => {
  log('info', 'server_started', { port: server.address().port, ...(role === 'storefront' ? { catalogUrl } : {}) });
});
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    log('info', 'server_stopping', { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 3000).unref();
  });
}
