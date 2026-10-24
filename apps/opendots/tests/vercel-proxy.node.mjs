// Run from apps/opendots: node --test tests/vercel-proxy.node.mjs
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import handler from '../api/proxy.js';

const originalFetch = globalThis.fetch;
const originalOrigin = process.env.OPENDOTS_BACKEND_ORIGIN;
process.env.OPENDOTS_BACKEND_ORIGIN = 'https://private-backend.example';
after(() => {
  globalThis.fetch = originalFetch;
  if (originalOrigin === undefined) delete process.env.OPENDOTS_BACKEND_ORIGIN;
  else process.env.OPENDOTS_BACKEND_ORIGIN = originalOrigin;
});

function request(path, init) {
  return new Request('https://site.vercel.app/api/' + path, init);
}

test('Vite config routes nested API paths to a real single-file function', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url)));
  assert.deepEqual(config.rewrites, [{
    source: '/api/:path*',
    destination: '/api/proxy?__opendots_path=:path*',
  }]);
});

test('proxies nested CopilotKit GET route with query, owner authorization, and marker', async () => {
  let called = false;
  globalThis.fetch = async (target, init) => {
    called = true;
    assert.equal(target.pathname, '/api/copilotkit/threads/abc/events');
    assert.equal(target.searchParams.get('threadId'), 'abc');
    assert.equal(target.searchParams.has('__opendots_path'), false);
    assert.equal(init.headers.get('authorization'), 'Bearer not-a-real-owner-token');
    assert.equal(init.headers.get('origin'), 'https://site.vercel.app');
    assert.equal(init.headers.has('sec-fetch-site'), false);
    assert.equal(init.headers.has('host'), false);
    assert.equal(init.method, 'GET');
    return new Response('{"ok":true}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const response = await handler(request(
    'copilotkit/threads/abc/events?__opendots_path=copilotkit%2Fthreads%2Fabc%2Fevents&threadId=abc',
    { headers: {
      authorization: 'Bearer not-a-real-owner-token',
      origin: 'https://site.vercel.app',
      'sec-fetch-site': 'same-origin',
      host: 'site.vercel.app',
    } },
  ));
  assert.equal(called, true);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-OpenDots-Proxy'), 'vercel-edge-v2');
  assert.deepEqual(await response.json(), { ok: true });
});

test('forwards streamed POST request and SSE response without buffering', async () => {
  globalThis.fetch = async (target, init) => {
    assert.equal(target.pathname, '/api/copilotkit/agent/mydot/run');
    assert.equal(init.method, 'POST');
    assert.equal(init.duplex, 'half');
    assert.equal(init.headers.get('content-type'), 'application/json');
    assert.equal(await new Response(init.body).text(), '{"prompt":"Hello"}');
    return new Response('data: {"type":"RUN_FINISHED"}\\n\\n', {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Content-Length': '999',
        'Content-Encoding': 'gzip',
      },
    });
  };
  const response = await handler(request(
    'copilotkit/agent/mydot/run?__opendots_path=copilotkit%2Fagent%2Fmydot%2Frun',
    { method: 'POST', headers: { 'content-type': 'application/json' },
      body: '{"prompt":"Hello"}' },
  ));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  assert.equal(response.headers.has('content-encoding'), false);
  assert.equal(response.headers.has('content-length'), false);
  assert.match(await response.text(), /RUN_FINISHED/);
});

test('rejects bad and conflicting rewritten route parameters', async () => {
  globalThis.fetch = () => { throw Error('Must never reach backend'); };
  for (const suffix of [
    '__opendots_path=',
    '__opendots_path=x%2F..%2Fstate',
    '__opendots_path=foo%2Fbar&__opendots_path=state',
    '__opendots_path=x%2Fbad%5Csegment',
  ]) {
    const response = await handler(request('proxy?' + suffix));
    assert.equal(response.status, 400, suffix);
  }
});

test('preserves upstream authorization errors instead of returning false success', async () => {
  globalThis.fetch = async () => new Response('{"error":"Forbidden"}', {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
  const response = await handler(request(
    'proxy?__opendots_path=copilotkit%2Finfo',
  ));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('X-OpenDots-Proxy'), 'vercel-edge-v2');
  assert.deepEqual(await response.json(), { error: 'Forbidden' });
});

test('backend network failure is a distinct HTTP 502', async () => {
  globalThis.fetch = async () => { throw Error('Network unavailable'); };
  const response = await handler(request('proxy?__opendots_path=state'));
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /unavailable/);
});

test('missing backend configuration is a distinct HTTP 503', async () => {
  delete process.env.OPENDOTS_BACKEND_ORIGIN;
  const response = await handler(request('proxy?__opendots_path=state'));
  assert.equal(response.status, 503);
  process.env.OPENDOTS_BACKEND_ORIGIN = 'https://private-backend.example';
});
