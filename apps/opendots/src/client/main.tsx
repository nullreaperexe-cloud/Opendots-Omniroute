import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { InstantChat } from './InstantChat';
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

  if (fullWorkspace) return (
    <>
      <button className="cloud-return" onClick={() => { window.location.hash = ''; setFullWorkspace(false); }}>
        ✦ Cloud chat (no PC needed)
      </button>
      <App />
    </>
  );
  return <InstantChat onFullWorkspace={() => { window.location.hash = 'workspace'; setFullWorkspace(true); }} />;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Website />
  </React.StrictMode>,
);
