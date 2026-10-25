/**
 * OpenDots FreeLLMAPI Windows bridge (NO Docker).
 *
 * Listens ONLY on Windows loopback :31416. A Tailscale Funnel mount at
 * /freellmapi forwards ONLY /v1/chat/completions to this bridge.
 * Absolutely never forward the local FreeLLMAPI dashboard/admin endpoints.
 * FreeLLMAPI authenticates the unified API key on every inference call.
 */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const LISTEN_HOST='127.0.0.1';
const LISTEN_PORT=31416;
const LOCAL_ROUTER_ORIGIN=process.env.FREELLMAPI_DESKTOP_ORIGIN ||
  'http://127.0.0.1:31415';

function respond(res,status,payload){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
    'Access-Control-Allow-Origin':'none'});
  res.end(JSON.stringify(payload));
}

export async function bridgeHandler(req,res){
  const pathname=(req.url||'').split('?')[0];
  if(req.method==='GET'&&pathname==='/health'){
    try {
      const check=await fetch(LOCAL_ROUTER_ORIGIN+'/v1/models',{
        signal:AbortSignal.timeout(3000),
        redirect:'manual',
      });
      return respond(res,200,{service:'OpenDots FreeLLMAPI restricted chat bridge',
        desktopOnline:check.status>0,bridgeOnline:true});
    } catch {
      return respond(res,503,{service:'OpenDots FreeLLMAPI restricted chat bridge',
        desktopOnline:false,bridgeOnline:true});
    }
  }
  // No MCP, dashboard, admin, models listing, filesystem, remote computer,
  // dynamic URLs, GET chat, redirects or arbitrary proxy targets.
  if(pathname!=='/v1/chat/completions'||req.method!=='POST')
    return respond(res,404,{error:'Chat completion endpoint only.'});

  const bearer=req.headers.authorization;
  if(typeof bearer!=='string'|| !/^Bearer freellmapi-[A-Za-z0-9_-]{8,}$/.test(bearer))
    return respond(res,401,{error:'Valid FreeLLMAPI unified bearer key required.'});
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))
    return respond(res,415,{error:'Expected JSON chat body.'});
  if(Number(req.headers['content-length']||0)>22000)
    return respond(res,413,{error:'Chat payload too large.'});
  let size=0;
  const chunks=[];
  try{
    for await(const chunk of req){
      size+=chunk.length;
      if(size>22000)return respond(res,413,{error:'Chat payload too large.'});
      chunks.push(chunk);
    }
    const raw=Buffer.concat(chunks).toString('utf8');
    const data=JSON.parse(raw);
    if(!data||!Array.isArray(data.messages)||data.messages.length<1||
       data.messages.length>20||typeof data.model!=='string'||!data.model||
       data.stream!==false)
      return respond(res,400,{error:'Expected a valid non-streaming OpenAI chat request.'});

    const upstream=await fetch(LOCAL_ROUTER_ORIGIN+'/v1/chat/completions',{
      method:'POST',
      headers:{Authorization:bearer,'Content-Type':'application/json'},
      body:raw,
      signal:AbortSignal.timeout(35000),
      redirect:'error',
    });
    const responseType=upstream.headers.get('content-type')||'';
    if(!responseType.includes('application/json'))
      return respond(res,502,{error:'Local FreeLLMAPI returned unexpected content.'});
    const text=await upstream.text();
    if(text.length>120000)
      return respond(res,502,{error:'FreeLLMAPI reply too large.'});
    let body;
    try{body=JSON.parse(text);}
    catch{return respond(res,502,{error:'Invalid JSON from FreeLLMAPI.'});}
    return respond(res,upstream.status,body);
  }catch(error){
    console.warn('[FreeLLMAPI bridge] request failed',{
      kind:error?.name==='TimeoutError'?'timeout':'local_router_error'});
    return respond(res,503,{error:'FreeLLMAPI desktop app is not responding on localhost.'});
  }
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const server=createServer(bridgeHandler);
  server.listen(LISTEN_PORT,LISTEN_HOST,()=>{
    console.log('OpenDots protected FreeLLMAPI chat bridge listening on localhost:'+LISTEN_PORT);
  });
  server.on('error',error=>{
    console.error('OpenDots bridge could not start: '+(error?.code||'unknown'));
    process.exitCode=1;
  });
}
