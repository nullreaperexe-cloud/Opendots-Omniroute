import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import handler, { classifyGroqFailure } from '../api/instant-chat.js';

const originalFetch = globalThis.fetch;
const existingKey = process.env.GROQ_API_KEY;
const existingModel = process.env.GROQ_MODEL;
// Unit tests must never use, display, or send real credentials from Vercel.
before(() => { delete process.env.GROQ_API_KEY; delete process.env.GROQ_MODEL; });
after(() => {
  globalThis.fetch = originalFetch;
  if (existingKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = existingKey;
  if (existingModel === undefined) delete process.env.GROQ_MODEL;
  else process.env.GROQ_MODEL = existingModel;
});

const mockResponse = () => ({
  statusCode: 0, headers: {}, body: null,
  status(n) { this.statusCode = n; return this; },
  setHeader(k,v) { this.headers[k] = v; return this; },
  json(v) { this.body = v; return this; },
});
const req = (messages, overrides = {}) => ({
  method: 'POST',
  headers: { host: 'opendots-omniroute.vercel.app', origin: 'https://opendots-omniroute.vercel.app' },
  body: { messages },
  ...overrides,
});

test('status endpoint truthfully advertises Groq and no running local backend', async () => {
  const out = mockResponse();
  await handler({ method: 'GET', headers: {} }, out);
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.provider, 'groq');
  assert.equal(out.body.cloudBrowser, false);
  assert.equal(out.body.configured, false);
  assert.ok(!JSON.stringify(out.body).includes('Bearer'));
});
test('cannot use old Vercel AI Gateway key in place of a Groq key', async () => {
  process.env.AI_GATEWAY_API_KEY = 'old-key-unit-test';
  const out = mockResponse();
  await handler(req([{role:'user',content:'hello'}]),out);
  assert.equal(out.statusCode,503);
  assert.equal(out.body.reason,'groq_key_missing');
  delete process.env.AI_GATEWAY_API_KEY;
});
test('missing key produces clear activation instructions without network calls', async () => {
  delete process.env.GROQ_API_KEY;
  globalThis.fetch = async () => { throw new Error('Should not call network'); };
  const out = mockResponse();
  await handler(req([{role:'user',content:'hi'}]),out);
  assert.equal(out.statusCode,503);
  assert.match(out.body.error,/GROQ_API_KEY/);
  assert.equal(out.body.reason,'groq_key_missing');
});
test('blocks cross-origin browser requests', async () => {
  const out = mockResponse();
  await handler(req([{role:'user',content:'hello'}],{
    headers:{host:'opendots-omniroute.vercel.app',origin:'https://evil.example'}
  }),out);
  assert.equal(out.statusCode,403);
});
test('blocks oversized and invalid history', async () => {
  const out = mockResponse();
  await handler(req([{role:'user',content:'a'.repeat(2500)}]),out);
  assert.equal(out.statusCode,400);
});

test('Groq completion returns user-visible AI answer and never sends key to browser', async () => {
  process.env.GROQ_API_KEY = 'gsk_fictional-test-key';
  delete process.env.GROQ_MODEL;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(options.headers.Authorization,'Bearer gsk_fictional-test-key');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'openai/gpt-oss-120b');
    assert.equal(body.messages.at(-1).content, 'Hello');
    return new Response(JSON.stringify({
      choices: [{message:{content:'Hello from GroqCloud'}}],
    }),{status:200});
  };
  const out=mockResponse();
  await handler(req([{role:'user',content:'Hello'}]),out);
  assert.equal(out.statusCode,200);
  assert.equal(out.body.reply,'Hello from GroqCloud');
  assert.equal(out.body.model,'openai/gpt-oss-120b');
  assert.equal(out.body.provider,'groq');
  assert.equal(calls,1);
  assert.ok(!JSON.stringify(out.body).includes('gsk_fictional-test-key'));
  assert.equal(out.headers['Cache-Control'],'no-store, private');
});
test('falls back to another Groq model on model-specific 429', async () => {
  process.env.GROQ_API_KEY = 'gsk_fictional-test-key';
  const calls=[];
  globalThis.fetch = async (url, options) => {
    const {model}=JSON.parse(options.body);
    calls.push(model);
    if(calls.length===1)return new Response(JSON.stringify({error:{code:'rate_limit_exceeded'}}),{status:429});
    return new Response(JSON.stringify({choices:[{message:{content:'Fallback okay'}}]}),{status:200});
  };
  const out=mockResponse();
  await handler(req([{role:'user',content:'try fallback'}]),out);
  assert.equal(out.statusCode,200);
  assert.equal(out.body.reply,'Fallback okay');
  assert.deepEqual(calls,['openai/gpt-oss-120b','openai/gpt-oss-20b']);
});
test('Groq authentication failure never leaks the API key or retries', async () => {
  process.env.GROQ_API_KEY = 'gsk_fictional-test-key';
  let calls=0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({error:{code:'invalid_api_key'}}),{status:401});
  };
  const out=mockResponse();
  await handler(req([{role:'user',content:'hi'}]),out);
  assert.equal(out.statusCode,503);
  assert.equal(out.body.reason,'groq_invalid_key');
  assert.equal(calls,1);
  assert.ok(!JSON.stringify(out.body).includes('gsk_fictional-test-key'));
});
test('model override is restricted to supported model IDs', async () => {
  process.env.GROQ_API_KEY='gsk_fictional-test-key';
  process.env.GROQ_MODEL='unrecognized/paid-model';
  let selected='';
  globalThis.fetch = async (url, options) => {
    selected=JSON.parse(options.body).model;
    return new Response(JSON.stringify({choices:[{message:{content:'ok'}}]}),{status:200});
  };
  const out=mockResponse();
  await handler(req([{role:'user',content:'hi'}]),out);
  assert.equal(out.statusCode,200);
  assert.equal(selected,'openai/gpt-oss-120b');
});
test('Groq rate limits and invalid API key errors are actionable', () => {
  assert.equal(classifyGroqFailure(429).reason,'groq_rate_limited');
  assert.equal(classifyGroqFailure(429).retry,true);
  assert.equal(classifyGroqFailure(401).reason,'groq_invalid_key');
  assert.equal(classifyGroqFailure(401).retry,false);
  assert.equal(classifyGroqFailure(403).reason,'groq_access_denied');
  assert.equal(classifyGroqFailure(403).retry,false);
});
