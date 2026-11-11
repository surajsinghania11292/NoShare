import React, { useState, useEffect } from 'react';

export default function RoomJoinForm({
  onSubmit,
  roomCode,
  setRoomCode,
  status,
  errorMsg,
  isWakingUp,
  onClearError
}) {
  const [mode, setMode] = useState('send'); // 'send' or 'receive'

  const generateRandomCode = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
  };

  // Auto-detect room code from URL hash (e.g. #room=123456)
  useEffect(() => {
    const hash = window.location.hash;
    const match = hash.match(/room=(\d{6})/);
    if (match && match[1]) {
      setRoomCode(match[1]);
      setMode('receive');
    } else if (mode === 'send' && !roomCode) {
      setRoomCode(generateRandomCode());
    }
  }, []);

  const handleModeChange = (newMode) => {
    setMode(newMode);
    onClearError?.();
    if (newMode === 'send') {
      setRoomCode(generateRandomCode());
    } else {
      setRoomCode('');
    }
  };

  if (status !== 'disconnected' && status !== 'joining') return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const targetCode = roomCode || generateRandomCode();
    setRoomCode(targetCode);
    onSubmit(e, targetCode, mode);
  };

  return (
    <div className="room-form-wrapper">
      {/* Mode Selector */}
      <div className="mode-selector-tabs" role="tablist" aria-label="Transfer Mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'send'}
          className={`mode-tab-btn ${mode === 'send' ? 'active' : ''}`}
          onClick={() => handleModeChange('send')}
        >
          <svg className="mode-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          <span>Share Files</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={mode === 'receive'}
          className={`mode-tab-btn ${mode === 'receive' ? 'active' : ''}`}
          onClick={() => handleModeChange('receive')}
        >
          <svg className="mode-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span>Join / Receive</span>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="connection-form">
        {/* Server Cold-Start Warmup Banner */}
        {isWakingUp && !errorMsg && (
          <div className="info-alert" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', background: 'rgba(59, 130, 246, 0.08)', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.25)', marginBottom: '1rem', color: 'var(--color-primary)' }}>
            <span className="spinner-small" style={{ width: '16px', height: '16px', border: '2px solid rgba(59, 130, 246, 0.3)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', display: 'inline-block', animation: 'spin 1s linear infinite' }}></span>
            <span style={{ fontSize: '0.85rem' }}>Connecting to signaling server... (Free-tier backend takes ~30s if waking up)</span>
          </div>
        )}

        {errorMsg && (
          <div className="error-alert">
            <svg className="error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{errorMsg}</span>
          </div>
        )}

        {mode === 'send' ? (
          <div className="send-mode-details">
            <div className="room-code-preview-box">
              <span className="room-code-label">Your Private Room Code:</span>
              <div className="room-code-display-row">
                <span className="room-code-digits">{roomCode || '------'}</span>
                <button
                  type="button"
                  className="regenerate-code-btn"
                  onClick={() => setRoomCode(generateRandomCode())}
                  title="Generate New Code"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                  </svg>
                  <span>New</span>
                </button>
              </div>
            </div>

            <button type="submit" className="btn-primary create-room-btn" disabled={status === 'joining'}>
              {status === 'joining' ? (
                <span>Creating Room...</span>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  <span>Create Room</span>
                </>
              )}
            </button>
          </div>
        ) : (
          <div className="receive-mode-details">
            <div className="input-group">
              <input
                type="text"
                maxLength={6}
                placeholder="Enter 6-digit room code"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.replace(/\D/g, ''))}
                required
                autoFocus
                className="room-code-input"
              />
            </div>
            <button type="submit" className="btn-primary join-room-btn" disabled={status === 'joining' || roomCode.length !== 6}>
              {status === 'joining' ? (
                <span>Connecting...</span>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />
                  </svg>
                  <span>Join Room</span>
                </>
              )}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
