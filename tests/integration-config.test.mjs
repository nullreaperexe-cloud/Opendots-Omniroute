import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const text = (path) => readFileSync(join(root, path), 'utf8');

test('both original code trees remain present', () => {
  assert.ok(existsSync(join(root, 'apps/opendots/src/server/index.ts')));
  assert.ok(existsSync(join(root, 'apps/omniroute/src')));
  assert.ok(existsSync(join(root, 'apps/omniroute/LICENSE')));
});

test('FreeLLMAPI is optional and the original model providers remain available', () => {
  const selection = text('apps/opendots/src/server/model-provider.ts');
  const index = text('apps/opendots/src/server/index.ts');
  for (const variable of [
    'FREELLMAPI_API_KEY', 'FREELLMAPI_MODEL', 'FREELLMAPI_BASE_URL',
    'OMNIROUTE_API_KEY', 'OMNIROUTE_MODEL', 'OMNIROUTE_BASE_URL',
    'OPENROUTER_API_KEY', 'OPENAI_API_KEY',
  ]) {
    assert.ok(selection.includes(variable), variable);
  }
  assert.ok(index.includes('modelGatewayFromEnv(process.env)'));
  assert.ok(index.includes('apiKey: modelGateway.apiKey'));
  assert.ok(index.includes('model: modelGateway.model'));
  assert.ok(index.includes('baseUrl: modelGateway.baseUrl'));
});

test('CopilotKit runtime and hidden inspector are retained', () => {
  const code = text('apps/opendots/src/client/App.tsx');
  assert.ok(code.includes('enableInspector={false}'));
  assert.ok(code.includes('<CopilotKitProvider'));
  assert.ok(!code.includes('Make it your own'));
});

test('Docker services use private gateways and persistent data volumes', () => {
  const yaml = text('docker-compose.yml');
  for (const fragment of [
    '127.0.0.1:20128:20128', 'http://omniroute:20128/v1',
    'FREELLMAPI_API_KEY', 'http://freellmapi:3001/v1',
    '127.0.0.1:3001:3001', 'freellmapi-data:',
    'opendots-data:/data', 'browser-link', 'internal: true',
  ]) {
    assert.ok(yaml.includes(fragment), fragment);
  }
});

test('Vercel forwards nested /api paths directly to HTTPS Funnel', () => {
  const vercel = JSON.parse(text('apps/opendots/vercel.json'));
  assert.deepEqual(vercel.rewrites, [{
    source: '/api/:path*',
    destination: 'https://kanish.tail7524cf.ts.net/api/:path*',
  }]);
  const headers = vercel.headers.find((x) => x.source === '/api/:path*');
  assert.ok(headers);
  assert.ok(headers.headers.some((h) =>
    h.key.toLowerCase() === 'cache-control' && h.value.includes('no-store')
  ));
  assert.equal(existsSync(join(root, 'apps/opendots/api/[...path].js')), false);
  assert.equal(existsSync(join(root, 'apps/opendots/api/proxy.js')), false);
});

test('private user database remains excluded from the repository', () => {
  assert.equal(existsSync(join(root, 'apps/opendots/data/opendots.sqlite')), false);
});
