import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../apps/opendots/api/[...path].js';

test('Vercel proxy streams POST calls with authorization to HTTPS backend', async () => {
  const savedOrigin = process.env.OPENDOTS_BACKEND_ORIGIN;
  const savedFetch = globalThis.fetch;
  let target;
  let options;
  try {
    process.env.OPENDOTS_BACKEND_ORIGIN = 'https://agent.example.com';
    globalThis.fetch = async (url, init) => {
      target = url.toString();
      options = init;
      return new Response('{"ok":true}', {
        headers: { 'content-type': 'application/json', 'cache-control':'private' }
      });
    };
    const request = new Request('https://my-dots.vercel.app/api/copilotkit?thread=abc', {
      method:'POST',
      headers: { authorization:'Bearer SOME_TEST_TOKEN', origin: 'https://my-dots.vercel.app' },
      body:'{"hello":"world"}',
      duplex:'half',
    });
    const response = await handler(request);
    assert.equal(target,'https://agent.example.com/api/copilotkit?thread=abc');
    assert.equal(options.headers.get('authorization'),'Bearer SOME_TEST_TOKEN');
    assert.equal(options.headers.get('origin'),'https://my-dots.vercel.app');
    assert.equal(response.status,200);
    assert.equal(response.headers.get('Cache-Control'),'no-store');
    assert.equal(await response.text(),'{"ok":true}');
  } finally {
    globalThis.fetch = savedFetch;
    if (savedOrigin === undefined) delete process.env.OPENDOTS_BACKEND_ORIGIN;
    else process.env.OPENDOTS_BACKEND_ORIGIN = savedOrigin;
  }
});

test('no configured origin fails closed', async () => {
  const savedOrigin = process.env.OPENDOTS_BACKEND_ORIGIN;
  try {
    delete process.env.OPENDOTS_BACKEND_ORIGIN;
    const response = await handler(new Request('https://example.vercel.app/api/status'));
    assert.equal(response.status,503);
  } finally {
    if (savedOrigin === undefined) delete process.env.OPENDOTS_BACKEND_ORIGIN;
    else process.env.OPENDOTS_BACKEND_ORIGIN = savedOrigin;
  }
});
