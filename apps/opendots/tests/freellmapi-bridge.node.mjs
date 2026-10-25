import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {bridgeHandler} from '../../../deploy/freellmapi-bridge.mjs';
const oldFetch=globalThis.fetch;
after(()=>{globalThis.fetch=oldFetch;});
function makeRequest(path,method='GET',body='',headers={}){
  const req=Readable.from(body?[Buffer.from(body, 'utf8')]:[]);
  req.method=method;
  req.url=path;
  req.headers=headers;
  const response={
    statusCode:0,headers:{},body:'',
    writeHead(status,h){this.statusCode=status;this.headers=h;},
    end(x){this.body=x;},
  };
  return {req,response};
}
test('bridge never exposes desktop dashboard, key management, or arbitrary paths',async()=>{
  for(const url of ['/api/keys','/api/settings','/v1/models','/','/v1/chat/completions?debug=1']){
    const {req,response}=makeRequest(url);
    await bridgeHandler(req,response);
    assert.equal(response.statusCode,404,url);
  }
});
test('bridge refuses inference without FreeLLMAPI unified authorization',async()=>{
  const {req,response}=makeRequest('/v1/chat/completions','POST','{}',{
    'content-type':'application/json'});
  await bridgeHandler(req,response);
  assert.equal(response.statusCode,401);
});
test('bridge safely forwards authenticated non-streaming chat to local desktop only',async()=>{
  let calls=0;
  globalThis.fetch=async(url,options)=>{
    calls++;
    assert.equal(url,'http://127.0.0.1:31415/v1/chat/completions');
    assert.equal(options.headers.Authorization,'Bearer freellmapi-testkey123456');
    const payload=JSON.parse(options.body);
    assert.equal(payload.model,'auto');
    assert.equal(payload.stream,false);
    return new Response(JSON.stringify({choices:[{message:{content:'hello'}}]}),{
      status:200,headers:{'content-type':'application/json'}});
  };
  const text=JSON.stringify({model:'auto',messages:[{role:'user',content:'hi'}],stream:false});
  const {req,response}=makeRequest('/v1/chat/completions','POST',text,{
    authorization:'Bearer freellmapi-testkey123456','content-type':'application/json'});
  await bridgeHandler(req,response);
  assert.equal(response.statusCode,200);
  assert.equal(JSON.parse(response.body).choices[0].message.content,'hello');
  assert.equal(calls,1);
  assert.equal(response.headers['Cache-Control'],'no-store');
});
test('bridge forbids streaming mode in this serverless use',async()=>{
  const text=JSON.stringify({model:'auto',messages:[{role:'user',content:'hi'}],stream:true});
  const {req,response}=makeRequest('/v1/chat/completions','POST',text,{
    authorization:'Bearer freellmapi-testkey123456','content-type':'application/json'});
  await bridgeHandler(req,response);
  assert.equal(response.statusCode,400);
});
