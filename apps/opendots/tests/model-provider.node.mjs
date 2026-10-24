import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelGatewayFromEnv } from '../src/server/model-provider.ts';

test('FreeLLMAPI unified key selects local gateway and smart routing', () => {
  const c = modelGatewayFromEnv({ FREELLMAPI_API_KEY: '  freellmapi-test-only  ' });
  assert.equal(c.provider, 'freellmapi');
  assert.equal(c.apiKey, 'freellmapi-test-only');
  assert.equal(c.baseUrl, 'http://127.0.0.1:3001/v1');
  assert.equal(c.model, 'auto:smart');
});
test('Docker FreeLLMAPI address and fast route are preserved', () => {
  const c = modelGatewayFromEnv({
    FREELLMAPI_API_KEY: 'freellmapi-test-only',
    FREELLMAPI_BASE_URL: 'http://freellmapi:3001/v1',
    FREELLMAPI_MODEL: 'auto:fast',
  });
  assert.equal(c.model, 'auto:fast');
  assert.equal(c.baseUrl, 'http://freellmapi:3001/v1');
});
test('FreeLLMAPI has explicit priority over configured OmniRoute', () => {
  const c = modelGatewayFromEnv({
    OMNIROUTE_API_KEY: 'old-omni-test-key',
    FREELLMAPI_API_KEY: 'freellmapi-test-only',
    OPENROUTER_API_KEY: 'old-router-test-key',
  });
  assert.equal(c.provider, 'freellmapi');
  assert.equal(c.apiKey, 'freellmapi-test-only');
});
test('Empty FreeLLMAPI key leaves existing OmniRoute deployment unchanged', () => {
  const c = modelGatewayFromEnv({
    FREELLMAPI_API_KEY: ' ',
    OMNIROUTE_API_KEY: 'private-internal-router',
    OMNIROUTE_MODEL: 'auto',
    OMNIROUTE_BASE_URL: 'http://omniroute:20128/v1',
  });
  assert.deepEqual(c, {
    provider: 'omniroute',
    apiKey: 'private-internal-router',
    model: 'auto',
    baseUrl: 'http://omniroute:20128/v1',
  });
});
test('OpenRouter legacy credentials are still supported', () => {
  const c = modelGatewayFromEnv({
    OMNIROUTE_API_KEY: '',
    OPENROUTER_API_KEY: 'test-router',
    OPENROUTER_MODEL: 'test-model',
  });
  assert.equal(c.provider, 'openrouter');
  assert.equal(c.model, 'test-model');
  assert.equal(c.baseUrl, 'https://openrouter.ai/api/v1');
});
test('Legacy OpenAI provider remains supported', () => {
  const c = modelGatewayFromEnv({ OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'gpt-test' });
  assert.equal(c.provider, 'openai');
  assert.equal(c.model, 'gpt-test');
  assert.equal(c.baseUrl, 'https://api.openai.com/v1');
});
test('Missing credentials do not claim a ready provider key', () => {
  const c = modelGatewayFromEnv({});
  assert.equal(c.provider, 'openai');
  assert.equal(c.apiKey, undefined);
});
