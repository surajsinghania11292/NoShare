import React, { useState } from 'react';
import { generateQrSvg } from '../utils/qrCode';

export default function ConnectionStatus({
  status,
  joinedRoom,
  roomCode,
  role,
  webrtcState,
  dataChannelStatus,
  connectionType
}) {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [showQr, setShowQr] = useState(false);

  if (status === 'disconnected' || status === 'joining') return null;

  const currentCode = joinedRoom || roomCode;
  const shareUrl = `${window.location.origin}${window.location.pathname}#room=${currentCode}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    });
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(currentCode).then(() => {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2500);
    });
  };

  const qrSvgMarkup = showQr ? generateQrSvg(shareUrl, 180) : '';

  return (
    <div className="active-connection">
      <div className="room-info">
        {/* Room Header & Fast Pairing Controls */}
        <div className="room-share-header">
          <div className="room-badge-group">
            <span className="room-label">Room Code:</span>
            <span className="room-badge-large">{currentCode}</span>
            <button
              type="button"
              className="copy-pill-btn"
              onClick={handleCopyCode}
              title="Copy Room Code"
            >
              {copiedCode ? '✓ Copied' : 'Copy'}
            </button>
          </div>

          <div className="share-actions-row">
            <button
              type="button"
              className="action-btn-pill"
              onClick={handleCopyLink}
              title="Copy Direct Pairing Link"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              <span>{copiedLink ? 'Link Copied!' : 'Copy Invite Link'}</span>
            </button>

            <button
              type="button"
              className="action-btn-pill"
              onClick={() => setShowQr(!showQr)}
              title="Scan QR Code with Phone"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
              <span>{showQr ? 'Hide QR' : 'QR Code'}</span>
            </button>
          </div>
        </div>

        {/* Dynamic QR Code Modal/Drawer */}
        {showQr && (
          <div className="qr-preview-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '1rem', background: 'var(--color-bg-card)', borderRadius: '16px', margin: '0.75rem 0', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(0,0,0,0.06)' }}>
            <div dangerouslySetInnerHTML={{ __html: qrSvgMarkup }} style={{ lineHeight: 0 }} />
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '0.5rem', textAlign: 'center' }}>
              Scan with phone camera to pair instantly
            </p>
          </div>
        )}

        {/* Connection Diagnostics Pill Bar */}
        <div className="info-grid">
          <div className="info-item">
            <span className="label">Status:</span>
            <span className={`status-dot webrtc-${webrtcState}`}></span>
            <span className="value capitalize font-bold">
              {dataChannelStatus === 'open' ? 'Connected & Ready' : webrtcState === 'connected' ? 'Securing Channel...' : 'Waiting for Peer'}
            </span>
          </div>

          {webrtcState === 'connected' && (
            <div className="info-item connection-type-item">
              <span className="label">Channel:</span>
              <span className="value font-bold connection-type-value">
                {connectionType} (End-to-End Encrypted)
              </span>
            </div>
          )}
        </div>
      </div>

      {status === 'joined-waiting' && (
        <div className="waiting-container">
          <div className="pulse-loader"></div>
          <p>Waiting for peer to scan QR or enter code...</p>
        </div>
      )}
    </div>
  );
}
