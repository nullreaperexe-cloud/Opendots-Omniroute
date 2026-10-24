import { useEffect, useRef, useState } from 'react';
import { ArrowUp, CircleHelp, Menu, MessageCircle, PanelLeftClose, Plus, Sparkles, Trash2, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './instant-chat.css';

type Role = 'user' | 'assistant';
type Message = { role: Role; content: string };
type Session = { id: string; title: string; updatedAt: number; messages: Message[] };
const STORAGE_KEY = 'opendots:cloud-chat:personal:v1';

function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 30).filter((item): item is Session =>
      item && typeof item.id === 'string' && typeof item.title === 'string' &&
      typeof item.updatedAt === 'number' && Array.isArray(item.messages) &&
      item.messages.every((m: Message) =>
        m && (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string')
    );
  } catch { return []; }
}
const newId = () => globalThis.crypto?.randomUUID?.() ??
  Date.now().toString(36) + Math.random().toString(36).slice(2);

export function InstantChat({ onFullWorkspace }: { onFullWorkspace: () => void }) {
  const [sessions, setSessions] = useState<Session[]>(loadSessions);
  const [id, setId] = useState(() => {
    try { return sessionStorage.getItem('opendots:cloud-chat:selected') || ''; }
    catch { return ''; }
  });
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [errorReason, setErrorReason] = useState('');
  const [aiReady, setAiReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [lastModel, setLastModel] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  const session = sessions.find(s => s.id === id);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, 30))); }
    catch { /* Storage is optional; private browsing may block it. */ }
  }, [sessions]);
  useEffect(() => {
    try { sessionStorage.setItem('opendots:cloud-chat:selected', id); }
    catch { /* optional */ }
  }, [id]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [session?.messages.length, busy]);

  const createSession = () => {
    setId('');
    setDraft('');
    setError('');
    setErrorReason('');
    setMobile(false);
    setLastModel('');
    setAiReady(false);
  };
  const deleteSession = (which: string) => {
    setSessions(prev => prev.filter(x => x.id !== which));
    if (id === which) setId('');
  };
  const send = async (text: string) => {
    const content = text.trim().slice(0, 2400);
    if (!content || busy) return;
    const targetId = session?.id || newId();
    const history = session?.messages || [];
    const next: Message[] = [...history, { role: 'user', content }];
    const clipped = next.slice(-17);
    const total = clipped.reduce((sum, m) => sum + m.content.length, 0);
    const toSend = total > 12500 ? next.slice(-7) : clipped;

    setBusy(true);
    setError('');
    setErrorReason('');
    setDraft('');
    setId(targetId);
    setSessions(prev => {
      const old = prev.find(s => s.id === targetId);
      const current: Session = {
        id: targetId,
        title: old?.title || content.slice(0, 55),
        updatedAt: Date.now(),
        messages: next,
      };
      return [current, ...prev.filter(s => s.id !== targetId)].slice(0, 30);
    });
    try {
      const response = await fetch('/api/instant-chat', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: toSend }),
      });
      const data: { reply?: unknown; model?: unknown; error?: unknown; reason?: unknown } = await response.json();
      if (!response.ok || typeof data.reply !== 'string' || !data.reply.trim()) {
        setErrorReason(typeof data.reason === 'string' ? data.reason : '');
        throw new Error(typeof data.error === 'string' ? data.error : 'Cloud chat could not respond.');
      }
      setSessions(prev => prev.map(s => s.id === targetId
        ? { ...s, updatedAt: Date.now(), messages: [...s.messages, { role: 'assistant', content: data.reply as string }] }
        : s));
      setLastModel(typeof data.model === 'string' ? data.model : '');
      setAiReady(true);
    } catch (e) {
      setAiReady(false);
      setError(e instanceof Error ? e.message : 'Could not send. Try again.');
    } finally { setBusy(false); }
  };
  const suggestions = [
    'Explain how AI agents work in Hinglish',
    'Help me plan my next coding project',
    'Write an elegant email for me',
    'Explain a difficult concept simply',
  ];

  return (
    <div className={'instant-root' + (collapsed ? ' instant-collapsed' : '')}>
      {mobile && <button className="instant-scrim" onClick={() => setMobile(false)} aria-label="Close sidebar" />}
      <aside className={'instant-side' + (mobile ? ' instant-side-open' : '')} aria-label="Recent cloud chats">
        <div className="instant-brand"><span className="instant-mark">✦</span><span>OpenDots</span><button onClick={() => setMobile(false)} className="instant-side-close" aria-label="Close menu"><X size={18}/></button></div>
        <button className="instant-new" onClick={createSession}><Plus size={17}/> New conversation <span>＋</span></button>
        <div className="instant-nav-label">RECENT CONVERSATIONS</div>
        <div className="instant-history">
          {!sessions.length && <p className="instant-no-history">Your conversations will appear here.</p>}
          {sessions.map(s => (
            <div className={'instant-history-row' + (id === s.id ? ' current' : '')} key={s.id}>
              <button className="instant-history-open" onClick={() => {setId(s.id);setError('');setMobile(false);}} title={s.title}><MessageCircle size={15}/><span>{s.title}</span></button>
              <button className="instant-delete" title="Delete conversation" aria-label={'Delete ' + s.title} onClick={() => deleteSession(s.id)}><Trash2 size={14}/></button>
            </div>
          ))}
        </div>
        <div className="instant-side-bottom">
          <button className="instant-workspace" onClick={onFullWorkspace}><PanelLeftClose size={17}/> Full OpenDots workspace</button>
          <div className="instant-side-caption">Your chat history stays in this browser. Full workspace features need the original backend.</div>
        </div>
      </aside>
      <main className="instant-main">
        <header className="instant-header">
          <div className="instant-header-left">
            <button className="instant-icon" title="Toggle navigation" aria-label="Toggle navigation" onClick={() => {if(window.innerWidth < 780) setMobile(true); else setCollapsed(v=>!v);}}><Menu size={20}/></button>
            <span className="instant-header-word">OpenDots <span>/ Cloud Chat</span></span>
          </div>
          <span className={'instant-cloud-label' + (error ? ' instant-cloud-error' : aiReady ? ' instant-cloud-ready' : ' instant-cloud-unknown')}><span/>{error ? 'Groq connection issue' : aiReady ? 'Groq connected' : 'Groq cloud chat'}</span>
        </header>
        <section className="instant-conversation" aria-label="Chat messages">
          {!session?.messages.length ? (
            <div className="instant-welcome">
              <div className="instant-spark"><Sparkles size={28} strokeWidth={1.6}/></div>
              <h1>What’s on your mind?</h1>
              <p>Ask anything. No CMD, Docker or desktop server needed for this lightweight cloud chat.</p>
              <div className="instant-suggestions">{suggestions.map(x=><button key={x} onClick={()=>void send(x)} disabled={busy}>{x}<ArrowUp size={14}/></button>)}</div>
            </div>
          ) : (
            <div className="instant-messages">
              {session.messages.map((m,i)=>(
                <div className={'instant-message instant-'+m.role} key={session.id+'-'+i}>
                  {m.role === 'assistant' && <span className="instant-avatar">✦</span>}
                  <div className="instant-msg-content">
                    {m.role === 'assistant' ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown> : m.content}
                  </div>
                </div>
              ))}
              {busy && <div className="instant-thinking"><span className="instant-avatar">✦</span><span>Thinking<span className="instant-dots">…</span></span></div>}
              <div ref={endRef}/>
            </div>
          )}
        </section>
        <div className="instant-compose-wrap">
          {error && <div role="alert" className="instant-error">
            <CircleHelp size={16}/>
            <span>{error}
              {['groq_key_missing','groq_invalid_key','groq_access_denied'].includes(errorReason) &&
                <><a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">GroqCloud API Keys ↗</a><a href="https://vercel.com/dashboard" target="_blank" rel="noopener noreferrer">Vercel Environment Variables ↗</a></>}
            </span>
            <button onClick={()=>setError('')} aria-label="Dismiss"><X size={15}/></button>
          </div>}
          <form className="instant-form" onSubmit={e=>{e.preventDefault();void send(draft);}}>
            <textarea autoFocus aria-label="Message OpenDots cloud chat" value={draft}
              placeholder="Message OpenDots…"
              rows={2} maxLength={2400}
              onChange={e=>setDraft(e.target.value)}
              onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send(draft);}}}/>
            <div className="instant-compose-foot"><span>Hinglish-friendly · browser-only chat</span>
              <button disabled={busy||!draft.trim()} type="submit" aria-label="Send message"><ArrowUp size={18}/></button>
            </div>
          </form>
          <p className="instant-footnote">Groq free-tier limits apply. This cloud chat has no autonomous browser, tools, or background work. {lastModel && <span>Last model: {lastModel}</span>}</p>
        </div>
      </main>
    </div>
  );
}
