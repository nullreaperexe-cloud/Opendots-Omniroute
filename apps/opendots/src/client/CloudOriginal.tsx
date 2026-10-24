import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp, ArrowUpRight, BookOpen, Clock3, ExternalLink, Folder, Link2,
  Menu, MessageCircle, Monitor, MoreHorizontal, PanelLeft, Phone, PhoneOff,
  Plus, RefreshCw, Search, Settings2, Trash2, X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Mascot } from './Mascot';
import { CallView } from './CallView';
import { useVoice } from './useVoice';
import type { Dot } from '../shared/types';
import './cloud-original.css';

type Message = { role: 'user' | 'assistant'; content: string };
type Session = { id: string; title: string; updatedAt: number; messages: Message[] };
type PublicPage = { url: string; title: string; content: string; mode: string };
type Tab = 'chat' | 'activity' | 'memories' | 'settings';
const KEY = 'opendots:cloud-chat:personal:v1'; // Keep existing Cloud Chat history.
const DOT: Dot = {
  id: 'opendots-main',
  spaceId: 'personal',
  spaceIds: ['personal'],
  name: 'Dot',
  instructions: 'A personal AI companion, here to think things through with you.',
  researchAllowed: true, memoryAllowed: false, appsAllowed: false,
  composioToolkits: [], createdAt: 0,
};
function readSessions(): Session[] {
  try {
    const items: unknown = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(items)) return [];
    return items.filter((s): s is Session =>
      !!s && typeof s.id === 'string' && typeof s.title === 'string' &&
      typeof s.updatedAt === 'number' && Array.isArray(s.messages) &&
      s.messages.every((m: Message) =>
        !!m && (m.role === 'assistant' || m.role === 'user') &&
        typeof m.content === 'string')
    ).slice(0, 30);
  } catch { return []; }
}
const newId = () => crypto.randomUUID?.() ||
  Date.now().toString(36) + Math.random().toString(36).slice(2);

function CloudBrowserPane({ onClose, onSummarize }: {
  onClose: () => void;
  onSummarize: (page: PublicPage) => void;
}) {
  const [url, setUrl] = useState('https://en.wikipedia.org/wiki/Artificial_intelligence');
  const [page, setPage] = useState<PublicPage>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = async (target: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setPage(undefined);
    try {
      const result = await fetch('/api/cloud-browser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ url: target }),
      });
      const data: PublicPage & { error?: string } = await result.json();
      if (!result.ok || !data.content) throw new Error(data.error || 'Could not read public webpage.');
      setPage(data);
      setUrl(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Page could not open.');
    } finally { setBusy(false); }
  };
  return <aside className="result-pane cloud-browser-pane" aria-label="Cloud browser research">
    <div className="pane-header">
      <div className="pane-tabs"><button className="selected"><Monitor size={15}/> Cloud web research</button></div>
      <button className="icon-button" onClick={onClose} aria-label="Close computer"><X size={17}/></button>
    </div>
    <div className="cloud-browser-hint">Public webpage reader · Vercel hosted</div>
    <form className="cloud-address" onSubmit={e=>{e.preventDefault();void open(url);}}>
      <input aria-label="Website URL" type="url" value={url}
        onChange={e=>setUrl(e.target.value)} placeholder="https://example.com"
        required/>
      <button aria-label="Navigate to website" type="submit" disabled={busy}>
        {busy ? <RefreshCw size={16} className="cloud-spin"/> : <ArrowUpRight size={16}/>}
      </button>
    </form>
    {error && <div role="alert" className="cloud-browser-alert">{error}</div>}
    {page ? <section className="cloud-page">
      <div className="cloud-page-meta"><span>PUBLIC PAGE</span><a href={page.url}
        target="_blank" rel="noopener noreferrer" title="Open original in your browser">
        <ExternalLink size={15}/>
      </a></div>
      <h3>{page.title}</h3>
      <p className="cloud-page-domain">{new URL(page.url).hostname}</p>
      <button className="cloud-summarize" onClick={()=>onSummarize(page)}>✦ Summarize this page with Dot</button>
      <article>{page.content}</article>
    </section> : <div className="cloud-page-empty">
      <Monitor size={27}/>
      <h3>Explore a public webpage</h3>
      <p>Navigate to a public HTTPS address, inspect its readable content and ask Dot to summarize it.</p>
      <p>JavaScript-only pages, screenshots, clicks, logins and persistent computer control require a separately hosted browser runtime.</p>
      <button onClick={()=>void open(url)} disabled={busy}>Open sample webpage <ArrowUpRight size={14}/></button>
    </div>}
  </aside>;
}

export function CloudOriginal({ onFullWorkspace }: { onFullWorkspace: () => void }) {
  const [sessions, setSessions] = useState<Session[]>(readSessions);
  const [selected, setSelected] = useState(() => {
    try { return sessionStorage.getItem('opendots:cloud-chat:selected') || ''; }
    catch { return ''; }
  });
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [view, setView] = useState<Tab>('chat');
  const [lastModel, setLastModel] = useState('');
  const [browserPage, setBrowserPage] = useState<PublicPage>();
  const [settingsNote, setSettingsNote] = useState('');
  const last = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  const session = sessions.find(x=>x.id===selected);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  useEffect(()=>{
    try { localStorage.setItem(KEY, JSON.stringify(sessions.slice(0,30))); }
    catch { /* Private browsing may not permit persistent local storage. */ }
  },[sessions]);
  useEffect(()=>{
    try { sessionStorage.setItem('opendots:cloud-chat:selected',selected); }
    catch { /* optional */ }
  },[selected]);
  useEffect(()=>{
    last.current?.scrollIntoView({behavior:'smooth',block:'end'});
  },[session?.messages.length,busy]);

  const send = async (input: string): Promise<string> => {
    const text=input.trim().slice(0,2400);
    if(!text || sending.current) return '';
    sending.current=true;
    const sid=selected || newId();
    const old=sessionsRef.current.find(x=>x.id===sid);
    const next: Message[]=[...(old?.messages||[]),{role:'user',content:text}];
    const recent=next.slice(-17);
    const requestMessages=recent.reduce((n,m)=>n+m.content.length,0)>12500
      ? next.slice(-7):recent;
    setSelected(sid);
    setBusy(true);
    setError('');
    setPrompt('');
    setView('chat');
    setMobile(false);
    setSessions(curr=>{
      const base=curr.find(x=>x.id===sid);
      const updated:Session={
        id:sid,title:base?.title||text.slice(0,55),updatedAt:Date.now(),messages:next,
      };
      return [updated,...curr.filter(x=>x.id!==sid)].slice(0,30);
    });
    try {
      const reply=await fetch('/api/instant-chat',{
        method:'POST',cache:'no-store',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({messages:requestMessages}),
      });
      const payload: {reply?:string;error?:string;model?:string}=await reply.json();
      if(!reply.ok || !payload.reply?.trim()){
        throw new Error(payload.error || 'AI could not respond.');
      }
      setSessions(curr=>curr.map(s=>s.id===sid ? {
        ...s,updatedAt:Date.now(),
        messages:[...s.messages,{role:'assistant',content:payload.reply!}],
      }:s));
      setConnected(true);
      setLastModel(payload.model||'');
      return payload.reply;
    } catch(e){
      setConnected(false);
      setError(e instanceof Error ? e.message:'Message failed.');
      return '';
    } finally {
      sending.current=false;
      setBusy(false);
    }
  };
  const localTurn = useRef<(text:string)=>Promise<string>>(async()=> '');
  localTurn.current=send;
  // Existing original OpenDots voice hook, in local browser speech-recognition
  // mode. No OpenAI Realtime key, voice backend, or home Docker required.
  const voice=useVoice('cloud-'+(selected||'new'),()=>{},undefined,true,
    text=>localTurn.current(text));
  const recognitionSupported=typeof window!=='undefined' &&
    Boolean((window as Window & {SpeechRecognition?:unknown;webkitSpeechRecognition?:unknown})
      .SpeechRecognition ||
      (window as Window & {webkitSpeechRecognition?:unknown}).webkitSpeechRecognition) &&
    Boolean(window.speechSynthesis);
  const changeTab=(v:Tab)=>{setView(v);setMobile(false);};
  const newConversation=()=>{setSelected('');setPrompt('');setError('');changeTab('chat');};
  const summarize=(page:PublicPage)=>{
    setBrowserPage(page);
    void send('Summarize this public webpage (source: '+page.url+') in clear bullet points:\n'+page.content.slice(0,1700));
  };
  return <div className={'app template-app cloud-original' +(navCollapsed?' nav-collapsed':'') }>
    <nav className="icon-rail" aria-label="Workspace navigation">
      <button className="rail-brand" aria-label="OpenDots home" onClick={()=>changeTab('chat')}>o<span>·</span></button>
      <button aria-label="Toggle sidebar" onClick={()=>setNavCollapsed(!navCollapsed)}><PanelLeft size={18}/></button>
      <button aria-label="New chat" onClick={newConversation}><Plus size={19}/></button>
      <button aria-label="Open cloud browser" onClick={()=>setBrowserOpen(true)}><Monitor size={18}/></button>
      <button aria-label="Activity" onClick={()=>changeTab('activity')}><Clock3 size={18}/></button>
      <button className="rail-settings" aria-label="Settings" onClick={()=>changeTab('settings')}><Settings2 size={18}/></button>
    </nav>
    {mobile && <button className="nav-scrim" aria-label="Close navigation" onClick={()=>setMobile(false)}/>}
    <button className="mobile-menu icon-button" aria-label="Open navigation" onClick={()=>setMobile(true)}><Menu size={20}/></button>
    <aside id="workspace-sidebar" className={'sidebar'+(mobile?' open':'')}>
      <button className="wordmark" onClick={newConversation}>
        <span className="dotted-logo"><i/><i/><i/><i/></span>OpenDots<span className="wordmark-dot">•</span>
      </button>
      <button className="new-chat nav-item" onClick={newConversation}><Plus size={17}/><span>New chat</span></button>
      <div className="spaces-heading nav-label">DOTS <button className="icon-button"
        aria-label="New Dot" onClick={()=>setSettingsNote('Personal Dot mode is active. Additional Dots require the full workspace backend.')}><Plus size={14}/></button></div>
      <nav className="dots-nav" aria-label="Dots">
        <div className="dot-nav-row">
          <button className={'dot-nav'+(view==='chat'?' active':'')} onClick={()=>changeTab('chat')}>
            <Mascot identity={DOT.id} name={DOT.name} small decorative/><span>{DOT.name}</span>
          </button>
          <button className="icon-button dot-settings" aria-label="Dot settings" onClick={()=>changeTab('settings')}><MoreHorizontal size={15}/></button>
        </div>
      </nav>
      <div className="spaces-heading nav-label">SPACES<button className="icon-button" aria-label="Spaces information"
        onClick={()=>changeTab('settings')}><Plus size={14}/></button></div>
      <nav className="spaces-nav"><button className="space-title cloud-space"
        onClick={()=>changeTab('settings')}><Folder size={14}/> Personal</button></nav>
      <section className="thread-list">
        <div className="nav-label">RECENT CHATS <button className="icon-button" aria-label="New conversation" onClick={newConversation}><Plus size={14}/></button></div>
        {!sessions.length && <p className="sidebar-empty">Your first conversation will live here.</p>}
        {sessions.map(s=><div key={s.id} className="cloud-thread">
          <button className={'nav-item'+(selected===s.id&&view==='chat'?' active':'')}
            title={s.title}
            onClick={()=>{setSelected(s.id);changeTab('chat');setError('');}}>
            <MessageCircle size={15}/><span>{s.title}</span>
          </button>
          <button className="icon-button cloud-delete" aria-label={'Delete '+s.title}
            onClick={()=>{setSessions(items=>items.filter(x=>x.id!==s.id));if(selected===s.id)setSelected('');}}>
            <Trash2 size={13}/>
          </button>
        </div>)}
      </section>
      <div className="sidebar-bottom">
        <button className={'nav-item'+(view==='activity'?' active':'')} onClick={()=>changeTab('activity')}><Clock3 size={17}/><span>Scheduled & activity</span></button>
        <button className={'nav-item'+(view==='memories'?' active':'')} onClick={()=>changeTab('memories')}><BookOpen size={17}/><span>Memories</span></button>
        <button className="nav-item" onClick={()=>changeTab('settings')}><Settings2 size={17}/><span>Settings & setup</span></button>
        <div className="version">OPEN DOTS <span>CLOUD</span></div>
      </div>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <button className="desktop-nav-toggle document-icon" onClick={()=>setNavCollapsed(!navCollapsed)}
          aria-label="Toggle navigation"><PanelLeft size={18}/></button>
        <div className="breadcrumbs"><span>Dots</span><span>/</span><strong>{view==='chat'?DOT.name:view==='activity'?'Activity':view==='memories'?'Memories':'Settings'}</strong></div>
        <div className="top-actions">
          <span className="mode-badge">{connected?'GROQ CONNECTED':'GROQ CLOUD'}</span>
          <button className="icon-button" aria-label={browserOpen?'Hide computer':'Show computer'}
            aria-expanded={browserOpen} onClick={()=>setBrowserOpen(!browserOpen)}><Monitor size={18}/></button>
        </div>
      </header>
      {settingsNote && <div className="notice cloud-notice">{settingsNote}<button onClick={()=>setSettingsNote('')} aria-label="Dismiss"><X size={14}/></button></div>}
      {view==='chat'? <div className={'chat-workspace'+(browserOpen?' split':'')}>
        <div className="chat-column">
          {session?.messages.length? <div className="live-chat">
            <header className="chat-persona">
              <Mascot identity={DOT.id} name={DOT.name} small state={busy?'working':'idle'}/>
              <div><strong>{DOT.name}</strong><span>{busy?'Thinking…':'Here with you'}</span></div>
              <div className="chat-persona-actions">
                <button className="icon-button" title="Read a public webpage" aria-label="Read webpage" onClick={()=>setBrowserOpen(true)}><Link2 size={18}/></button>
                <button className="icon-button" title="Open cloud browser" aria-label="Open computer" onClick={()=>setBrowserOpen(true)}><Monitor size={18}/></button>
                <button className={'icon-button'+(voice.status!=='idle'?' on-call':'')}
                  aria-label={voice.status==='idle'?'Start voice call':'End voice call'}
                  title={recognitionSupported?'Talk with your Dot':'Voice calls need a browser with speech recognition and speech synthesis'}
                  onClick={()=>voice.status==='idle'?void voice.start():void voice.end()}>
                  {voice.status==='idle'?<Phone size={18}/>:<PhoneOff size={18}/>}
                </button>
              </div>
            </header>
            <div className="chat-transcript">
              {session.messages.map((m,i)=><div className={'chat-bubble '+m.role} key={session.id+'-'+i}>
                {m.role==='assistant'?<ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>:m.content}
              </div>)}
              {busy && <div className="thinking"><span/><span/><span/><span>Dot is thinking</div>}
              <div ref={last}/>
            </div>
            {(error||voice.error) && <div className="chat-error" role="alert">{error||voice.error}
              {error && <button onClick={()=>setError('')}>Dismiss</button>}</div>}
            <CallView dot={DOT} voice={voice}/>
            <form className="chat-composer" onSubmit={e=>{e.preventDefault();void send(prompt);}}>
              <textarea aria-label="Message Dot" placeholder="Message Dot…" value={prompt}
                maxLength={2400} onChange={e=>setPrompt(e.target.value)}
                onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send(prompt);}}}/>
              <div className="composer-bottom"><span><MessageCircle size={14}/> Text and calls, one continuing conversation</span>
                <button className="send-button" aria-label="Send message" disabled={busy||!prompt.trim()}><ArrowUp size={19}/></button>
              </div>
            </form>
          </div>:<div className="new-conversation">
            <div className="empty-chat-persona">
              <Mascot identity={DOT.id} name={DOT.name}/>
              <h2>{DOT.name}</h2><p>{DOT.instructions}</p>
            </div>
            <form className="composer" onSubmit={e=>{e.preventDefault();void send(prompt);}}>
              <textarea aria-label="Start a conversation" placeholder="Message Dot…" value={prompt}
                maxLength={2400} onChange={e=>setPrompt(e.target.value)}
                onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send(prompt);}}}/>
              <div className="composer-bottom"><span><MessageCircle size={14}/> Text and calls, one continuing conversation</span>
                <button className="send-button" aria-label="Start conversation" disabled={busy||!prompt.trim()}><ArrowUp size={19}/></button>
              </div>
            </form>
            {error && <div role="alert" className="chat-error">{error}</div>}
            <div className="starter-suggestions">
              {['Help me think this through','Research a public page','Make a plan I can follow'].map(text=>
                <button key={text} onClick={()=>{
                  if(text==='Research a public page')setBrowserOpen(true);
                  else setPrompt(text);
                }}>{text}<ArrowUpRight size={12}/></button>)}
            </div>
            <div className="connection-note">Groq cloud chat · PC and Docker not required
              <button className="text-button" onClick={()=>changeTab('settings')}>Setup details</button>
            </div>
            <button className="cloud-start-call" aria-label="Start voice call"
              onClick={()=>void voice.start()}><Phone size={16}/> Start voice call</button>
            <CallView dot={DOT} voice={voice}/>
          </div>}
        </div>
        {browserOpen&&<CloudBrowserPane onClose={()=>setBrowserOpen(false)} onSummarize={summarize}/>}
      </div> : <main className="main-content cloud-info-page">
        <div className="page-heading">
          <div><span className="eyebrow">YOUR WORKSPACE</span>
            <h1>{view==='activity'?'A little follow-through.':view==='memories'?'Memories':'Settings & setup'}</h1>
            <p>{view==='activity'?'Autonomous scheduled tasks need an always-on worker.':
              view==='memories'?'Chat history is saved only in this browser.':
              'Cloud chat runs on Vercel with Groq.'}</p>
          </div>
        </div>
        {view==='settings'?<section className="cloud-feature-details">
          <h3>Cloud features</h3>
          <p>AI chat: GroqCloud. Voice calls: browser speech recognition + speaker audio (Chrome recommended). Web research: public HTTPS page reader from Vercel.</p>
          <p>The full original OpenDots computer, Spaces, persistent Dots, and schedules still need a separately running backend.</p>
          <button className="primary" onClick={onFullWorkspace}>Open full original OpenDots workspace (requires backend)</button>
        </section>: <div className="large-empty">
          <Mascot identity={DOT.id}/><h2>{view==='activity'?'Scheduled agents are not running in Cloud Chat.':'Memory is local to your device.'}</h2>
          <p>{view==='activity'?'Use a hosted agent runtime to enable autonomous work with PC off.':
            'Recent conversations are kept in this browser, not synchronized across devices.'}</p>
        </div>}
      </main>}
    </div>
    {browserPage && <span className="cloud-sr-only">{browserPage.title}</span>}
  </div>;
}
