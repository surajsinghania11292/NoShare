import React from 'react';
import { formatBytes } from '../utils/format';

export default function IncomingRequestCard({
  pendingIncomingFile,
  handleAcceptFile,
  handleDeclineFile
}) {
  if (!pendingIncomingFile) return null;

  return (
    <div className="progress-card incoming-request-card" style={{ borderColor: 'var(--color-primary)', background: 'rgba(59, 130, 246, 0.05)' }}>
      <div className="progress-header">
        <span className="progress-title" style={{ color: 'var(--color-primary)' }}>Incoming File Request</span>
      </div>
      <div style={{ margin: '0.5rem 0', fontSize: '0.9rem' }}>
        <strong>Name:</strong> {pendingIncomingFile.name} <br />
        <strong>Size:</strong> {formatBytes(pendingIncomingFile.size)}
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
        <button onClick={handleAcceptFile} className="btn-primary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
          Accept & Save
        </button>
        <button onClick={handleDeclineFile} className="btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', color: 'var(--color-error)' }}>
          Decline
        </button>
      </div>
    </div>
  );
}
