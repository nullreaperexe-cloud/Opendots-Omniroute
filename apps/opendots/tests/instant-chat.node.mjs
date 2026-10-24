import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/instant-chat.js';

const savedFetch = globalThis.fetch;
const savedOidc = process.env.VERCEL_OIDC_TOKEN;
after(() => {
  globalThis.fetch = savedFetch;
  if (savedOidc === undefined) delete process.env.VERCEL_OIDC_TOKEN;
  else process.env.VERCEL_OIDC_TOKEN = savedOidc;
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
test('health endpoint does not send inference or expose credentials', async () => {
  const out = mockResponse();
  await handler({ method: 'GET', headers: {} }, out);
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.mode, 'free-model-only');
  assert.ok(!JSON.stringify(out.body).includes('Bearer'));
});
test('rejects cross-origin prompts', async () => {
  const out = mockResponse();
  await handler(req([{role:'user',content:'hello'}], {headers:{host:'opendots-omniroute.vercel.app',origin:'https://evil.example'}}), out);
  assert.equal(out.statusCode, 403);
});
test('rejects overlong prompts before sending inference', async () => {
  const out = mockResponse();
  await handler(req([{role:'user',content:'a'.repeat(2500)}]), out);
  assert.equal(out.statusCode, 400);
});
test('filters out paid models, sends free-only chat with OIDC, and returns reply', async () => {
  process.env.VERCEL_OIDC_TOKEN = 'test-oidc-never-real';
  const seen = [];
  globalThis.fetch = async (url, options) => {
    seen.push({url,options});
    if (url.endsWith('/models')) return new Response(JSON.stringify({data:[
      {id:'paid/test',type:'language',modalities:{input:['text'],output:['text']},pricing:{input:'0.0001',output:'0.1'}},
      {id:'free/test',type:'language',modalities:{input:['text'],output:['text']},pricing:{input:'0',output:'0'}},
    ]}), {status:200,headers:{'content-type':'application/json'}});
    const body = JSON.parse(options.body);
    assert.equal(body.model,'free/test');
    assert.equal(options.headers.Authorization,'Bearer test-oidc-never-real');
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Hello from free model' } }] }), {status:200,headers:{'content-type':'application/json'}});
  };
  const out = mockResponse();
  await handler(req([{role:'user',content:'hello'}]),out);
  assert.equal(out.statusCode,200);
  assert.equal(out.body.reply,'Hello from free model');
  assert.equal(out.body.model,'free/test');
  assert.equal(seen.length,2);
  assert.equal(out.headers['Cache-Control'],'no-store, private');
});

test('free model routing retries after model-specific 403 without selecting paid models', async () => {
  process.env.VERCEL_OIDC_TOKEN = 'test-oidc-never-real';
  const { default: freshHandler } = await import('../api/instant-chat.js?fallback-403-test');
  const attempts = [];
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/models')) return new Response(JSON.stringify({data: [
      {id:'free/denied',type:'language',context_window:9000,modalities:{input:['text'],output:['text']},pricing:{input:'0',output:'0'}},
      {id:'free/available',type:'language',context_window:3000,modalities:{input:['text'],output:['text']},pricing:{input:'0',output:'0'}},
      {id:'paid/never',type:'language',context_window:100000,modalities:{input:['text'],output:['text']},pricing:{input:'0.1',output:'0.1'}},
    ]}),{status:200});
    const body=JSON.parse(options.body);
    attempts.push(body.model);
    if (body.model === 'free/denied') return new Response('forbidden',{status:403});
    return new Response(JSON.stringify({choices:[{message:{content:'Fallback worked'}}]}),{status:200});
  };
  const out=mockResponse();
  await freshHandler(req([{role:'user',content:'test fallback'}]),out);
  assert.equal(out.statusCode,200);
  assert.equal(out.body.reply,'Fallback worked');
  assert.deepEqual(attempts,['free/denied','free/available']);
});
