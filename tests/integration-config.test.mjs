import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const text = (path) => readFileSync(join(root, path), 'utf8');

test('both original code trees are present', () => {
  assert.ok(existsSync(join(root,'apps/opendots/src/server/index.ts')));
  assert.ok(existsSync(join(root,'apps/omniroute/src')));
  assert.ok(existsSync(join(root,'apps/omniroute/LICENSE')));
});

test('OmniRoute routing is preferred and legacy providers remain', () => {
  const code=text('apps/opendots/src/server/index.ts');
  for (const fragment of ['OMNIROUTE_API_KEY','OMNIROUTE_MODEL','OMNIROUTE_BASE_URL',
    'omniRouteApiKey || openRouterApiKey || process.env.OPENAI_API_KEY', "'auto'"]) {
    assert.ok(code.includes(fragment),fragment);
  }
});

test('Inspector hidden but CopilotKit agent library retained', () => {
  const code=text('apps/opendots/src/client/App.tsx');
  assert.ok(code.includes('enableInspector={false}'));
  assert.ok(code.includes('<CopilotKitProvider'));
  assert.ok(!code.includes('Make it your own'));
});

test('Docker service uses private gateway + persistent volumes', () => {
  const yaml=text('docker-compose.yml');
  for (const fragment of ['127.0.0.1:20128:20128','http://omniroute:20128/v1',
    'opendots-data:/data', 'browser-link','internal: true']) {
    assert.ok(yaml.includes(fragment),fragment);
  }
});

test('Vercel forwards to HTTPS backend as a streaming body', () => {
  const source=text('apps/opendots/api/[...path].js');
  for (const fragment of ['OPENDOTS_BACKEND_ORIGIN',"origin.protocol !== 'https:'",
    'new Response(upstream.body']) assert.ok(source.includes(fragment),fragment);
});

test('private user database excluded', () => {
  assert.equal(existsSync(join(root,'apps/opendots/data/opendots.sqlite')),false);
});
