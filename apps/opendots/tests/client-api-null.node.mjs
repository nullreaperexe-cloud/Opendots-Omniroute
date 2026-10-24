// Regression tests for optional JSON null responses. From apps/opendots:
// node --import tsx --test tests/client-api-null.node.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const originalSessionStorage = globalThis.sessionStorage;
const originalFetch = globalThis.fetch;
const sessions = new Map();
Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: {
    getItem: (key) => sessions.get(key) ?? null,
    setItem: (key, value) => { sessions.set(key, value); },
    removeItem: (key) => { sessions.delete(key); },
  },
});
const { api, ApiError } = await import('../src/client/api.ts');

after(() => {
  globalThis.fetch = originalFetch;
  if (originalSessionStorage === undefined) delete globalThis.sessionStorage;
  else Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: originalSessionStorage,
  });
});

function mockResponse(body, status = 200, contentType = 'application/json') {
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.cache, 'no-store');
    return new Response(body, {
      status,
      headers: { 'content-type': contentType },
    });
  };
}

test('no capture: HTTP 200 application/json null is legitimate success', async () => {
  mockResponse('null');
  assert.equal(await api('/conversations/example/capture'), null);
});

test('no page context: HTTP 200 JSON null unblocks the chat composer', async () => {
  mockResponse('null');
  assert.equal(await api('/conversations/example/page-context'), null);
});

test('JSON object responses remain intact', async () => {
  mockResponse('{"conversations":[]}');
  assert.deepEqual(await api('/workspace'), { conversations: [] });
});

test('invalid JSON body is still rejected even with HTTP 200', async () => {
  mockResponse('', 200);
  await assert.rejects(api('/workspace'), /invalid JSON/);
});

test('HTML fallback is rejected even with HTTP 200', async () => {
  mockResponse('<!doctype html>', 200, 'text/html');
  await assert.rejects(api('/workspace'), /API routing error/);
});

test('HTTP authorization errors are not swallowed by null handling', async () => {
  mockResponse('{"error":"Owner token required"}', 401);
  await assert.rejects(
    api('/workspace'),
    (err) => err instanceof ApiError &&
      err.status === 401 && /Owner token required/.test(err.message),
  );
});

test('genuine HTTP 204 produces undefined without parsing', async () => {
  mockResponse(null, 204, '');
  assert.equal(await api('/action'), undefined);
});
