import React, { useState, useEffect } from 'react';
import RoomConnection from './components/RoomConnection';
import './App.css';

// Low-profile SVG Icons for the Theme toggle button
const SunIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </svg>
);

const MoonIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </svg>
);

const MonitorIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="20" height="14" x="2" y="3" rx="2" />
    <line x1="8" x2="16" y1="21" y2="21" />
    <line x1="12" x2="12" y1="17" y2="21" />
  </svg>
);

function App() {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('noshare-theme') || 'system';
  });
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  // Apply Theme Toggle logic globally
  useEffect(() => {
    const root = window.document.documentElement;
    
    const applyTheme = (t) => {
      root.classList.remove('light', 'dark');
      if (t === 'dark') {
        root.classList.add('dark');
      } else if (t === 'light') {
        root.classList.add('light');
      } else {
        // system theme fallback
        const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.classList.add(systemDark ? 'dark' : 'light');
      }
    };

    applyTheme(theme);
    localStorage.setItem('noshare-theme', theme);

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = (e) => {
        root.classList.remove('light', 'dark');
        root.classList.add(e.matches ? 'dark' : 'light');
      };
      mediaQuery.addEventListener('change', listener);
      return () => mediaQuery.removeEventListener('change', listener);
    }
  }, [theme]);

  // Global mousemove listener to feed coordinate variables to the CSS spotlights
  useEffect(() => {
    let frameId = null;
    const handleMouseMove = (e) => {
      if (frameId) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        document.documentElement.style.setProperty('--mx', `${e.clientX}px`);
        document.documentElement.style.setProperty('--my', `${e.clientY}px`);
      });
    };
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, []);

  return (
    <div className="app-container">
      {/* Ambient Spotlight Backdrop */}
      <div className="ambient-backdrop" aria-hidden="true">
        <div className="bloom bloom-1"></div>
        <div className="bloom bloom-2"></div>
        <div className="spotlight-follow"></div>
      </div>

      <header className="app-header">
        <div className="logo-container">
          <svg className="logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          <span className="logo-text">No<span className="accent">Share</span></span>
        </div>

        <div className="header-right-group">
          {/* Custom Theme toggle pill */}
          <div className="theme-toggle-pill">
            <button 
              onClick={() => setTheme('light')}
              className={`theme-toggle-btn ${theme === 'light' ? 'active' : ''}`}
              title="Light Mode"
              type="button"
            >
              <SunIcon />
            </button>
            <button 
              onClick={() => setTheme('dark')}
              className={`theme-toggle-btn ${theme === 'dark' ? 'active' : ''}`}
              title="Dark Mode"
              type="button"
            >
              <MoonIcon />
            </button>
            <button 
              onClick={() => setTheme('system')}
              className={`theme-toggle-btn ${theme === 'system' ? 'active' : ''}`}
              title="System Theme"
              type="button"
            >
              <MonitorIcon />
            </button>
          </div>

          <div className="badge">Zero-Storage P2P</div>
        </div>
      </header>

      <main className="app-main">
        <div className="hero-section">
          <h1>
            <span>Zero-Storage Direct</span><br />
            <span>P2P <em>File Sharing</em></span>
          </h1>
          <p className="hero-subtitle">
            Instantly stream files directly between devices in your browser. No middleman. No cloud storage limits. Pure privacy.
          </p>

          <button className="info-trigger-btn" onClick={() => setIsGuideOpen(!isGuideOpen)} type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '4px' }}>
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 16v-4"/>
              <path d="M12 8h.01"/>
            </svg>
            <span style={{ verticalAlign: 'middle' }}>How it works & Data Usage</span>
          </button>

          {isGuideOpen && (
            <div className="info-drawer">
              <div className="info-drawer-title">
                <span>How NoShare P2P Transfer Works</span>
              </div>
              <div className="info-drawer-grid">
                <div className="info-drawer-card">
                  <div className="info-card-header">
                    <span className="info-badge-free">Zero RAM Limits</span>
                    <span>OPFS Disk Streaming</span>
                  </div>
                  <p className="info-card-desc">
                    Files stream directly to sandboxed disk storage using Origin Private File System. Works smoothly on Linux, Windows, Mac, iOS, and Android without browser crashes.
                  </p>
                </div>

                <div className="info-drawer-card">
                  <div className="info-card-header">
                    <span className="info-badge-free">Cross-Network</span>
                    <span>Universal NAT Traversal</span>
                  </div>
                  <p className="info-card-desc">
                    Connect across local Wi-Fi, 4G/5G mobile cellular, or remote networks with automatic STUN and encrypted TURN relay fallbacks.
                  </p>
                </div>

                <div className="info-drawer-card">
                  <div className="info-card-header">
                    <span className="info-badge-free">Smart Resume</span>
                    <span>Zero Data Loss</span>
                  </div>
                  <p className="info-card-desc">
                    If your connection drops, transfers pause and resume from the exact byte offset without having to start over from 0%.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <RoomConnection />
      </main>

      <footer className="app-footer">
        <p>NoShare &copy; {new Date().getFullYear()}. Direct & Secure P2P File Sharing.</p>
      </footer>
    </div>
  );
}

export default App;
