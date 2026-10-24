import test from 'node:test';
import assert from 'node:assert/strict';
import reader, {validateCloudUrl} from '../api/cloud-browser.js';
const mockResponse=()=>({
 code:0,body:null,headers:{},
 status(n){this.code=n;return this;},
 setHeader(k,v){this.headers[k]=v;return this;},
 json(x){this.body=x;return this;},
});
test('public https URL passes strict validation',()=>{
 assert.equal(validateCloudUrl('https://en.wikipedia.org/wiki/OpenAI').hostname,'en.wikipedia.org');
});
test('rejects local targets, IP literals, internal ports, plain HTTP and credentials',()=>{
 for(const u of [
  'http://wikipedia.org/','https://127.0.0.1/','https://localhost/',
  'https://169.254.169.254/','https://10.0.0.1/',
  'https://foo.local/','https://user:pass@example.org/',
  'https://example.org:444/',
 ]) assert.throws(()=>validateCloudUrl(u),undefined,u);
});
test('GET describes public-page reader without claiming full visual browser',async()=>{
 const r=mockResponse();
 await reader({method:'GET',headers:{}},r);
 assert.equal(r.code,200);
 assert.equal(r.body.available,true);
 assert.match(r.body.capability,/not a persistent visual browser/);
});
test('POST blocks malicious target before contacting any remote host',async()=>{
 const r=mockResponse();
 await reader({method:'POST',headers:{host:'opendots-omniroute.vercel.app',
  origin:'https://opendots-omniroute.vercel.app'},body:{url:'http://127.0.0.1:4310'}},r);
 assert.equal(r.code,400);
});
