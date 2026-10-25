/**
 * OpenDots lightweight cloud chat, using the user's FreeLLMAPI unified router.
 *
 * The unified key authenticates a separately RUNNING FreeLLMAPI service.
 * It is not a hosted model-provider key. A desktop 127.0.0.1 URL cannot be
 * reached by Vercel; use a securely hosted/tunneled public HTTPS endpoint.
 * Full autonomous browser and WebRTC calling are separate capabilities.
 */
const DEFAULT_MODEL = 'auto';
function send(response,status,payload){
  return response.status(status)
    .setHeader('Cache-Control','no-store, private')
    .setHeader('X-Content-Type-Options','nosniff')
    .json(payload);
}
function sameOrigin(request){
  if(request.headers?.['sec-fetch-site']==='cross-site')return false;
  const origin=request.headers?.origin;
  if(!origin)return true;
  try{return new URL(origin).origin === 'https://'+request.headers.host;}
  catch{return false;}
}
function validMessages(body){
  if(!body || !Array.isArray(body.messages) ||
     body.messages.length<1 || body.messages.length>18)return null;
  let total=0;
  const result=[];
  for(const message of body.messages){
    if(!message || !['user','assistant'].includes(message.role) ||
       typeof message.content!=='string' || !message.content.trim() ||
       message.content.length>2400)return null;
    total+=message.content.length;
    if(total>13000)return null;
    result.push({role:message.role,content:message.content});
  }
  return result.at(-1)?.role==='user'?result:null;
}
/** Reject local/LAN/ambiguous endpoint configuration in public Vercel functions. */
export function validateFreeLLMAPIBaseUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('FREELLMAPI_BASE_URL is not configured.');
  }
  let url;
  try { url=new URL(raw.trim()); }
  catch { throw new Error('FREELLMAPI_BASE_URL must be a valid HTTPS URL ending in /v1.'); }
  const host=url.hostname.toLowerCase();
  if(url.protocol!=='https:' || url.username || url.password || url.hash ||
     !host.includes('.') || host==='localhost' ||
     host.endsWith('.localhost') || host.endsWith('.local') ||
     host.endsWith('.internal') || host.endsWith('.test') ||
     host.endsWith('.invalid') || host.includes('..') ||
     /^\[?[0-9a-f:.]+\]?$/i.test(host) ||
     url.search || (url.port && url.port!=='443')) {
    throw new Error('FreeLLMAPI must have a public HTTPS hostname (not localhost, an IP address, or LAN URL).');
  }
  const path=url.pathname.replace(/\/+$/,'');
  if(path!=='/v1' && !(/^\/[a-zA-Z0-9_-]{1,80}\/v1$/).test(path))
    throw new Error('FREELLMAPI_BASE_URL must end in /v1 (optionally below one safe proxy path).');
  return url.origin+path;
}
export function classifyFreeLLMAPIFailure(status, errorCode=''){
  const code=String(errorCode).toLowerCase();
  if(status===401 || status===403)return {reason:'freellmapi_auth_denied',
    error:'FreeLLMAPI rejected the unified API key or denied access. Check FREELLMAPI_API_KEY and router permissions.'};
  if(status===429)return {reason:'freellmapi_rate_limited',
    error:'FreeLLMAPI or its upstream AI providers reached a rate/token limit. Check the router Keys and Quota signals.'};
  if(status===404)return {reason:'freellmapi_not_found',
    error:'FreeLLMAPI endpoint or selected model was not found. Check Base URL and FREELLMAPI_MODEL.'};
  if(status===400 && /model/.test(code))return {reason:'freellmapi_model_unavailable',
    error:'FreeLLMAPI could not route to the requested model. Try FREELLMAPI_MODEL=auto.'};
  if(status>=500)return {reason:'freellmapi_router_unavailable',
    error:'FreeLLMAPI or an upstream provider is unavailable. Verify your router is running and has usable provider keys.'};
  return {reason:'freellmapi_request_rejected',
    error:'FreeLLMAPI rejected the request. Check the router dashboard and provider credentials.'};
}
function configuration(){
  const apiKey=process.env.FREELLMAPI_API_KEY?.trim();
  const rawUrl=process.env.FREELLMAPI_BASE_URL?.trim();
  if(!apiKey || !rawUrl)return {configured:false,apiKey,rawUrl};
  try{
    const baseUrl=validateFreeLLMAPIBaseUrl(rawUrl);
    return {configured:true,apiKey,baseUrl};
  }catch{
    return {configured:false,apiKey,rawUrl,invalidUrl:true};
  }
}
export default async function handler(request,response){
  const config=configuration();
  if(request.method==='GET')return send(response,200,{
    service:'OpenDots cloud chat',
    provider:'freellmapi',
    mode:'serverless-client-of-external-router',
    configured:config.configured,
    keyConfigured:Boolean(config.apiKey),
    endpointConfigured:Boolean(config.rawUrl),
    endpointValid:Boolean(config.baseUrl),
    routerOnline:'not_checked',
    cloudBrowser:false,
  });
  if(request.method!=='POST')return send(response,405,{error:'Method not allowed.'});
  if(!sameOrigin(request))return send(response,403,{error:'Cross-origin chat requests are disabled.'});
  if(Number(request.headers?.['content-length']||0)>20000)
    return send(response,413,{error:'Message exceeds the request size limit.'});
  let body;
  try{body=typeof request.body==='string'?JSON.parse(request.body):request.body;}
  catch{return send(response,400,{error:'Invalid JSON chat request.'});}
  const messages=validMessages(body);
  if(!messages)return send(response,400,{
    error:'Send 1–18 valid chat messages (max 13,000 characters total).',
  });
  if(!config.apiKey)return send(response,503,{
    reason:'freellmapi_key_missing',
    error:'Set FREELLMAPI_API_KEY to your Unified API Key in Vercel → OpenDots → Environment Variables (Production), then redeploy.',
  });
  if(!config.baseUrl)return send(response,503,{
    reason:config.invalidUrl?'freellmapi_invalid_url':'freellmapi_url_missing',
    error:'Set FREELLMAPI_BASE_URL to a reachable public HTTPS FreeLLMAPI router URL ending in /v1. The screenshot address 127.0.0.1:31415 is local to your laptop and cannot be used by Vercel.',
  });
  const model=process.env.FREELLMAPI_MODEL?.trim()||DEFAULT_MODEL;
  if(model.length>110 || !/^[\w.:-]+(?:\/[\w.:-]+)*$/.test(model))
    return send(response,503,{
      reason:'freellmapi_invalid_model',
      error:'FREELLMAPI_MODEL is invalid; use auto or an available model from your router.',
    });
  try{
    const upstream=await fetch(config.baseUrl+'/chat/completions',{
      method:'POST',
      headers:{
        'Authorization':'Bearer '+config.apiKey,
        'Content-Type':'application/json',
        'Accept':'application/json',
      },
      body:JSON.stringify({
        model,
        messages:[
          {role:'system',content:"You are OpenDots, a helpful AI companion. Reply in the user's preferred language, including natural Hindi and Hinglish. You do not have real computer-automation, ongoing task, external web browsing or other tools inside this basic chat endpoint; do not claim otherwise."},
          ...messages,
        ],
        max_tokens:800,
        stream:false,
      }),
      signal:AbortSignal.timeout(25000),
      redirect:'error',
    });
    if(!upstream.ok){
      let upstreamCode='';
      try{
        const error=await upstream.json();
        upstreamCode=typeof error?.error?.code==='string'?error.error.code:'';
      }catch{}
      const failure=classifyFreeLLMAPIFailure(upstream.status,upstreamCode);
      console.warn('[OpenDots FreeLLMAPI chat] request rejected',{
        upstreamStatus:upstream.status, reason:failure.reason,
      });
      return send(response,503,{...failure,upstreamStatus:upstream.status});
    }
    const result=await upstream.json();
    const reply=result?.choices?.[0]?.message?.content;
    if(typeof reply!=='string'||!reply.trim())return send(response,502,{
      reason:'freellmapi_empty_reply',
      error:'FreeLLMAPI returned no text. Check the router model/provider configuration.',
    });
    return send(response,200,{reply:reply.trim(),model:result?.model||model,provider:'freellmapi'});
  }catch(error){
    console.warn('[OpenDots FreeLLMAPI chat] router connection failed',{
      kind:error?.name==='TimeoutError'?'timeout':'network_or_router_offline',
    });
    return send(response,503,{
      reason:'freellmapi_router_unreachable',
      error:'Cannot reach FreeLLMAPI from Vercel. Confirm your HTTPS router endpoint is accessible and the computer/host running FreeLLMAPI is ON. A unified key alone does not host the proxy.',
    });
  }
}
