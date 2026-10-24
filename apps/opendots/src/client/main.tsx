import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { CloudOriginal } from './CloudOriginal';
import './style.css';
import './editor.css';
import { watchSystemTheme } from './theme';

watchSystemTheme();

function Website() {
  const [fullWorkspace, setFullWorkspace] = useState(
    () => window.location.hash === '#workspace',
  );
  useEffect(() => {
    const onHash = () => setFullWorkspace(window.location.hash === '#workspace');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  // The full original OpenDots app is preserved for its existing backend.
  // While the Windows PC is off, CloudOriginal retains the ORIGINAL layout,
  // with Groq chat, a browser speech-call fallback, and public web reading.
  if (fullWorkspace) return (
    <>
      <button className="cloud-return"
        onClick={() => { window.location.hash = ''; setFullWorkspace(false); }}>
        ✦ Cloud Dot (no PC needed)
      </button>
      <App />
    </>
  );
  return <CloudOriginal onFullWorkspace={() => {
    window.location.hash = 'workspace';
    setFullWorkspace(true);
  }}/>;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Website />
  </React.StrictMode>,
);
