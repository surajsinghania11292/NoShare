import React, { useState, useEffect } from 'react';

export default function RoomJoinForm({ onSubmit, roomCode, setRoomCode, status, errorMsg }) {
  const [mode, setMode] = useState('send'); // 'send' or 'receive'

  // Generate a random 6-digit room code if Send is selected and room code is empty
  const generateRandomCode = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
  };

  useEffect(() => {
    if (mode === 'send' && !roomCode) {
      setRoomCode(generateRandomCode());
    } else if (mode === 'receive' && roomCode && !/^[0-9]{6}$/.test(roomCode)) {
      // Keep or clear when switching
    }
  }, [mode]);

  const handleModeChange = (newMode) => {
    setMode(newMode);
    if (newMode === 'send') {
      setRoomCode(generateRandomCode());
    } else {
      setRoomCode('');
    }
  };

  if (status !== 'disconnected') return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (mode === 'send' && !roomCode) {
      const newCode = generateRandomCode();
      setRoomCode(newCode);
      onSubmit(e, newCode, 'send');
    } else {
      onSubmit(e, roomCode, mode);
    }
  };

  return (
    <div className="room-form-wrapper">
      {/* Send / Receive Mode Selector Switcher */}
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
          <span>Send</span>
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
          <span>Receive</span>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="connection-form">
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
              <span className="room-code-label">Room Code for Peer:</span>
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

            <button type="submit" className="btn-primary create-room-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span>Create Room</span>
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
            <button type="submit" className="btn-primary join-room-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />
              </svg>
              <span>Join Room</span>
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

