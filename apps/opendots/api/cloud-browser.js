/**
 * Stateless cloud page reader (not a persistent Chromium computer).
 * Reads public HTTPS pages from Vercel for research, even while home PC is off.
 * Domain and DNS validation prevents private-network URL fetches.
 * No cookies, credentials, cookies, POST actions or login automation.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent } from 'undici';

function privateIP(ip) {
  if (ip.includes(':')) {
    const v = ip.toLowerCase();
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') ||
      v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') ||
      v.startsWith('feb') || v.startsWith('::ffff:') || v.startsWith('2001:db8');
  }
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(x => x < 0 || x > 255)) return true;
  const [a,b,c] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 ||
    a === 192 && (b === 168 || b === 0 && c === 0 || b === 0 && c === 2) ||
    a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) ||
    a === 203 && b === 0 && c === 113 ||
    a === 100 && b >= 64 && b <= 127 ||
    a === 192 && b === 88 ||
    a === 255;
}
export function validateCloudUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 1800) throw new Error('Enter a valid public HTTPS URL.');
  let u;
  try { u = new URL(raw); } catch { throw new Error('Enter a valid public HTTPS URL.'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port && u.port !== '443')
    throw new Error('Only public HTTPS websites are supported.');
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost') ||
      host.endsWith('.local') || host.endsWith('.internal') ||
      host.endsWith('.test') || host.endsWith('.invalid') || host.endsWith('.example') ||
      isIP(host) !== 0 || host.includes('..'))
    throw new Error('Private networks, IP addresses and local domains are blocked.');
  u.hash = '';
  return u;
}
function respond(res, status, obj) {
  return res.status(status).setHeader('Cache-Control', 'private, no-store')
    .setHeader('X-Content-Type-Options', 'nosniff').json(obj);
}
async function publicAddress(host) {
  const addresses = await lookup(host, { all: true });
  if (!addresses.length || addresses.some(x => privateIP(x.address))) {
    throw new Error('Website does not resolve to a public network address.');
  }
  // Pin the first validated address to avoid DNS rebinding after validation.
  return addresses[0];
}
function htmlToReadable(html) {
  let title = (html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || 'Untitled page')
    .replace(/<[^>]*>/g, ' ').trim();
  let text = html.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|head|footer|nav|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<\/(p|h1|h2|h3|li|section|article|div|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const decode = x => x.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#x27|#x2F|#47);/gi, m => ({
    '&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' ',
    '&#39;':"'",'&#x27;':"'",'&#x2F;':'/','&#47;':'/',
  }[m.toLowerCase()] || ' '));
  return {
    title: decode(title).slice(0, 180),
    content: decode(text).replace(/[ \t]{2,}/g, ' ').replace(/\n[\s\n]+/g, '\n\n').trim().slice(0, 18000),
  };
}
export default async function handler(req, res) {
  if (req.method === 'GET') return respond(res, 200, {
    service: 'OpenDots public cloud page reader',
    available: true,
    capability: 'public HTTPS navigation and text extraction, not a persistent visual browser',
  });
  if (req.method !== 'POST') return respond(res,405,{error:'Method not allowed.'});
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return respond(res,403,{error:'Cross-site requests are not allowed.'});
  if (req.headers?.origin) {
    try {
      if (new URL(req.headers.origin).origin !== 'https://' + req.headers.host)
        return respond(res,403,{error:'Cross-origin request denied.'});
    } catch { return respond(res,403,{error:'Invalid origin.'}); }
  }
  let body;
  try { body=typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return respond(res,400,{error:'Invalid request JSON.'}); }
  let u;
  try { u=validateCloudUrl(body?.url); }
  catch(e) {return respond(res,400,{error:e.message});}
  try {
    const address=await publicAddress(u.hostname);
    const agent=new Agent({connect:{
      lookup(host,opts,cb) {cb(null,address.address,address.family);},
    }});
    let response;
    try {
      response=await fetch(u.href,{
        dispatcher:agent,
        redirect:'manual',
        signal:AbortSignal.timeout(10000),
        headers:{'User-Agent':'OpenDotsResearchReader/1.0 (+public-page-research)','Accept':'text/html, text/plain'},
      });
    } finally {await agent.close();}
    // No auto redirect; reject to prevent following an unexpected internal URL.
    if(response.status>=300 && response.status<400)
      return respond(res,422,{error:'This webpage redirects. Open the destination URL directly after checking it is public HTTPS.'});
    if(!response.ok) return respond(res,502,{error:'This website returned HTTP '+response.status});
    const type=response.headers.get('content-type')||'';
    if(!/text\/html|text\/plain/i.test(type))
      return respond(res,415,{error:'Only HTML and plain-text public webpages can be read.'});
    const size=Number(response.headers.get('content-length')||0);
    if(size>800_000) return respond(res,413,{error:'This public webpage is too large to extract safely.'});
    const reader=response.body?.getReader();
    if(!reader) return respond(res,502,{error:'This webpage has no readable content.'});
    const chunks=[];let bytes=0;
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>800_000){await reader.cancel();return respond(res,413,{error:'Webpage exceeded the maximum reading size.'});}
      chunks.push(value);
    }
    const raw=Buffer.concat(chunks.map(x=>Buffer.from(x))).toString('utf8');
    const {title,content}=type.includes('text/plain') ?
      {title:u.hostname,content:raw.slice(0,18000)}:htmlToReadable(raw);
    if(!content.trim()) return respond(res,422,{error:'This page requires JavaScript or blocks automated readers.'});
    return respond(res,200,{url:u.href,title,content,mode:'public-page-reader'});
  }catch(error){
    console.warn('[OpenDots public page reader] safe failure',{
      kind:error?.name==='TimeoutError'?'timeout':'network_or_host',
    });
    return respond(res,502,{error:'Could not open this webpage. It may block automated reading, require login or time out.'});
  }
}
