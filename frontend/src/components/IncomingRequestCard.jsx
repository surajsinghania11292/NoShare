import React from 'react';
import { formatBytes } from '../utils/format';

export default function IncomingRequestCard({
  pendingIncomingFile,
  handleAcceptFile,
  handleDeclineFile
}) {
  if (!pendingIncomingFile) return null;

  const isResume = !!pendingIncomingFile.isResume;
  const resumePercent =
    pendingIncomingFile.size > 0 && pendingIncomingFile.resumeOffset
      ? Math.floor((pendingIncomingFile.resumeOffset / pendingIncomingFile.size) * 100)
      : 0;

  return (
    <div
      className="progress-card incoming-request-card"
      style={{
        borderColor: 'var(--color-primary)',
        background: 'rgba(59, 130, 246, 0.04)',
        borderWidth: '1.5px',
        animation: 'pulseBorder 2s infinite'
      }}
    >
      <div className="progress-header" style={{ marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1.2rem' }}>📥</span>
          <span className="progress-title" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
            {isResume ? 'Resumable File Request' : 'Incoming File Offer'}
          </span>
        </div>
        {isResume && (
          <span
            className="progress-queue-badge"
            style={{ background: 'rgba(16, 185, 129, 0.15)', color: 'var(--color-success)' }}
          >
            Checkpoint Found ({resumePercent}%)
          </span>
        )}
      </div>

      <div style={{ margin: '0.5rem 0 1rem 0', fontSize: '0.9rem', lineHeight: '1.5' }}>
        <div><strong>Name:</strong> <span style={{ wordBreak: 'break-all' }}>{pendingIncomingFile.name}</span></div>
        <div><strong>Size:</strong> {formatBytes(pendingIncomingFile.size)}</div>
        {isResume && (
          <div style={{ color: 'var(--color-success)', marginTop: '0.35rem', fontSize: '0.85rem' }}>
            ✓ Will resume from byte {formatBytes(pendingIncomingFile.resumeOffset)} without starting over!
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => handleAcceptFile(false)}
          className="btn-primary"
          style={{ flex: 1, minWidth: '130px', padding: '0.5rem 0.8rem', fontSize: '0.85rem' }}
        >
          {isResume ? `Resume (${resumePercent}%)` : 'Accept & Download'}
        </button>

        {window.showSaveFilePicker && (
          <button
            type="button"
            onClick={() => handleAcceptFile(true)}
            className="btn-secondary"
            style={{ padding: '0.5rem 0.8rem', fontSize: '0.85rem' }}
            title="Choose folder location on disk"
          >
            Choose Folder...
          </button>
        )}

        <button
          type="button"
          onClick={handleDeclineFile}
          className="btn-secondary"
          style={{ padding: '0.5rem 0.8rem', fontSize: '0.85rem', color: 'var(--color-error)' }}
        >
          Decline
        </button>
      </div>
    </div>
  );
}
