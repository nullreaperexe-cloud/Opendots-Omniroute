// Validate Vercel's CDN-level rewrite configuration before every deploy.
// These are configuration regression tests, NOT proof of production connectivity.
// The Windows integration diagnostic checks the actual authenticated endpoints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const projectRoot = new URL('../', import.meta.url);
const config = JSON.parse(readFileSync(new URL('vercel.json', projectRoot), 'utf8'));

test('all nested API routes forward directly to the persistent HTTPS home backend', () => {
  assert.deepEqual(config.rewrites, [{
    source: '/api/:path*',
    destination: 'https://kanish.tail7524cf.ts.net/api/:path*',
  }]);
  const destination = new URL(config.rewrites[0].destination);
  assert.equal(destination.protocol, 'https:');
  assert.equal(destination.hostname, 'kanish.tail7524cf.ts.net');
  assert.equal(destination.pathname, '/api/:path*');
});

test('API paths do not rewrite to the Vite SPA or a Vercel function', () => {
  const rewrite = config.rewrites[0];
  assert.ok(!rewrite.destination.includes('/api/proxy'));
  assert.ok(!rewrite.destination.includes('index.html'));
  assert.ok(!existsSync(new URL('api/[...path].js', projectRoot)));
  assert.ok(!existsSync(new URL('api/proxy.js', projectRoot)));
});

test('Vercel disables API caching to avoid owner-data leakage', () => {
  const rule = config.headers.find(x => x.source === '/api/:path*');
  assert.ok(rule, 'Missing API headers rule');
  const headers = Object.fromEntries(rule.headers.map(x => [x.key.toLowerCase(), x.value]));
  assert.match(headers['cache-control'], /no-store/);
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['x-opendots-route'], 'external-funnel-v3');
});

test('frontend build and server process remain in separate environments', () => {
  assert.equal(config.framework, 'vite');
  assert.equal(config.outputDirectory, 'dist/client');
  assert.match(config.buildCommand, /npm run verify:web/);
  assert.ok(!JSON.stringify(config).includes('20128'));
  assert.ok(!JSON.stringify(config).includes('OMNIROUTE_API_KEY'));
});
