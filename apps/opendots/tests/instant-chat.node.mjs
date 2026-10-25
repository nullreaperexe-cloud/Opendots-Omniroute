import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import handler,{validateFreeLLMAPIBaseUrl,classifyFreeLLMAPIFailure}
  from '../api/instant-chat.js';

const saved={
  key:process.env.FREELLMAPI_API_KEY,
  url:process.env.FREELLMAPI_BASE_URL,
  model:process.env.FREELLMAPI_MODEL,
  groq:process.env.GROQ_API_KEY,
};
const originalFetch=globalThis.fetch;
before(()=>{
  delete process.env.FREELLMAPI_API_KEY;
  delete process.env.FREELLMAPI_BASE_URL;
  delete process.env.FREELLMAPI_MODEL;
});
after(()=>{
  globalThis.fetch=originalFetch;
  const vals={FREELLMAPI_API_KEY:saved.key,FREELLMAPI_BASE_URL:saved.url,FREELLMAPI_MODEL:saved.model};
  for(const [k,v]of Object.entries(vals))if(v===undefined)delete process.env[k];else process.env[k]=v;
});
const res=()=>({
  statusCode:0,headers:{},body:null,
  status(n){this.statusCode=n;return this;},
  setHeader(k,v){this.headers[k]=v;return this;},
  json(o){this.body=o;return this;},
});
const req=(messages,other={})=>({
  method:'POST',
  headers:{host:'opendots-omniroute.vercel.app',
    origin:'https://opendots-omniroute.vercel.app'},
  body:{messages},...other,
});
test('health endpoint identifies FreeLLMAPI rather than Groq and never returns a key',async()=>{
  const out=res();
  await handler({method:'GET',headers:{}},out);
  assert.equal(out.statusCode,200);
  assert.equal(out.body.provider,'freellmapi');
  assert.equal(out.body.configured,false);
  assert.equal(out.body.keyConfigured,false);
  assert.equal(out.body.endpointConfigured,false);
  assert.equal(out.body.routerOnline,'not_checked');
  assert.ok(!JSON.stringify(out.body).includes('Bearer'));
});
test('local addresses, HTTP, private IPs, bad paths or credentials are rejected',()=>{
  for(const url of [
    'http://127.0.0.1:31415/v1',
    'https://localhost:31415/v1',
    'https://127.0.0.1/v1',
    'https://192.168.1.2/v1',
    'https://[::1]/v1',
    'http://freellmapi.example.com/v1',
    'https://user:pass@router.example.net/v1',
    'https://router.example.net/admin',
    'https://router.example.net/v1?api_key=secret',
  ])assert.throws(()=>validateFreeLLMAPIBaseUrl(url),undefined,url);
  assert.equal(validateFreeLLMAPIBaseUrl('https://router.example.net/v1/'),
    'https://router.example.net/v1');
});
test('Groq and old AI gateway keys do not count as FreeLLMAPI credentials',async()=>{
  process.env.GROQ_API_KEY='gsk_test';
  process.env.AI_GATEWAY_API_KEY='test_old';
  const out=res();
  await handler(req([{role:'user',content:'Hello'}]),out);
  assert.equal(out.statusCode,503);
  assert.equal(out.body.reason,'freellmapi_key_missing');
  delete process.env.GROQ_API_KEY;
  delete process.env.AI_GATEWAY_API_KEY;
});
test('missing unified key produces actionable error without external requests',async()=>{
  globalThis.fetch=()=>{throw new Error('unexpected provider call');};
  const out=res();
  await handler(req([{role:'user',content:'hi'}]),out);
  assert.equal(out.statusCode,503);
  assert.match(out.body.error,/FREELLMAPI_API_KEY/);
  assert.equal(out.body.reason,'freellmapi_key_missing');
});
test('key alone does not connect to local 127.0.0.1 router from Vercel',async()=>{
  process.env.FREELLMAPI_API_KEY='freellmapi-fake-key';
  process.env.FREELLMAPI_BASE_URL='http://127.0.0.1:31415/v1';
  const out=res();
  await handler(req([{role:'user',content:'hi'}]),out);
  assert.equal(out.statusCode,503);
  assert.equal(out.body.reason,'freellmapi_invalid_url');
  assert.match(out.body.error,/127\.0\.0\.1/);
});
test('blocks cross-site requests before contacting the router',async()=>{
  const out=res();
  await handler(req([{role:'user',content:'test'}],{
    headers:{host:'opendots-omniroute.vercel.app',origin:'https://other.example.net'},
  }),out);
  assert.equal(out.statusCode,403);
});
test('validates chat history and refuses unbounded messages',async()=>{
  const out=res();
  await handler(req([{role:'user',content:'x'.repeat(2401)}]),out);
  assert.equal(out.statusCode,400);
});
test('calls only configured FreeLLMAPI host with unified bearer secret',async()=>{
  process.env.FREELLMAPI_API_KEY='freellmapi-fake-test-secret';
  process.env.FREELLMAPI_BASE_URL='https://router.example.net/v1';
  process.env.FREELLMAPI_MODEL='auto';
  let count=0;
  globalThis.fetch=async(url,options)=>{
    count++;
    assert.equal(url,'https://router.example.net/v1/chat/completions');
    assert.equal(options.headers.Authorization,'Bearer freellmapi-fake-test-secret');
    const payload=JSON.parse(options.body);
    assert.equal(payload.model,'auto');
    assert.equal(payload.messages.at(-1).content,'Hello');
    return new Response(JSON.stringify({model:'model-served',choices:[{message:{content:'Namaste'}}]}),{status:200});
  };
  const out=res();
  await handler(req([{role:'user',content:'Hello'}]),out);
  assert.equal(out.statusCode,200);
  assert.equal(out.body.reply,'Namaste');
  assert.equal(out.body.model,'model-served');
  assert.equal(out.body.provider,'freellmapi');
  assert.equal(count,1);
  assert.equal(out.headers['Cache-Control'],'no-store, private');
  assert.ok(!JSON.stringify(out.body).includes('freellmapi-fake-test-secret'));
});
test('unified key invalid error never exposes secrets',async()=>{
  process.env.FREELLMAPI_API_KEY='freellmapi-fake-test-secret';
  process.env.FREELLMAPI_BASE_URL='https://router.example.net/v1';
  globalThis.fetch=async()=>new Response(JSON.stringify({error:{message:'Invalid key'}}),{status:401});
  const out=res();
  await handler(req([{role:'user',content:'Hello'}]),out);
  assert.equal(out.statusCode,503);
  assert.equal(out.body.reason,'freellmapi_auth_denied');
  assert.ok(!JSON.stringify(out.body).includes('freellmapi-fake-test-secret'));
});
test('unreachable proxy gives honest network status',async()=>{
  process.env.FREELLMAPI_API_KEY='freellmapi-fake-test-secret';
  process.env.FREELLMAPI_BASE_URL='https://router.example.net/v1';
  globalThis.fetch=async()=>{throw new Error('ECONNREFUSED');};
  const out=res();
  await handler(req([{role:'user',content:'Hello'}]),out);
  assert.equal(out.statusCode,503);
  assert.equal(out.body.reason,'freellmapi_router_unreachable');
});
test('invalid FreeLLMAPI model name rejects arbitrary payload',async()=>{
  process.env.FREELLMAPI_API_KEY='freellmapi-fake-test-secret';
  process.env.FREELLMAPI_BASE_URL='https://router.example.net/v1';
  process.env.FREELLMAPI_MODEL='auto\nAuthorization:malicious';
  const out=res();
  await handler(req([{role:'user',content:'Hello'}]),out);
  assert.equal(out.statusCode,503);
  assert.equal(out.body.reason,'freellmapi_invalid_model');
});
test('specific provider failure reasons stay actionable',()=>{
  assert.equal(classifyFreeLLMAPIFailure(401).reason,'freellmapi_auth_denied');
  assert.equal(classifyFreeLLMAPIFailure(429).reason,'freellmapi_rate_limited');
  assert.equal(classifyFreeLLMAPIFailure(404).reason,'freellmapi_not_found');
});
