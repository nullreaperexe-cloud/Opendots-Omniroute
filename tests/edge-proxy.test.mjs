import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(join(root, 'apps/opendots/vercel.json'), 'utf8'));

test('Vercel uses an external HTTPS rewrite for nested OpenDots APIs', () => {
  assert.equal(config.framework, 'vite');
  assert.deepEqual(config.rewrites, [{
    source: '/api/:path*',
    destination: 'https://kanish.tail7524cf.ts.net/api/:path*',
  }]);
  const destination = new URL(config.rewrites[0].destination);
  assert.equal(destination.protocol, 'https:');
  assert.equal(destination.hostname, 'kanish.tail7524cf.ts.net');
});

test('API routes are uncached and never forwarded to SPA HTML', () => {
  const rule = config.headers.find((h) => h.source === '/api/:path*');
  assert.ok(rule);
  assert.ok(rule.headers.some((h) => h.key === 'Cache-Control' && h.value.includes('no-store')));
  assert.ok(!config.rewrites[0].destination.includes('index.html'));
  assert.ok(!config.rewrites[0].destination.includes('api/proxy'));
  assert.equal(existsSync(join(root, 'apps/opendots/api/[...path].js')), false);
});

test('old Vercel serverless catchall is not needed for streaming responses', () => {
  assert.equal(existsSync(join(root, 'apps/opendots/api/proxy.js')), false);
  assert.ok(config.rewrites[0].destination.endsWith('/api/:path*'));
});
