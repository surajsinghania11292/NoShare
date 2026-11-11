import React from 'react';
import { formatBytes } from '../utils/format';

export default function TransferProgressCard({
  transferringFile,
  transferProgress,
  transferSpeed,
  transferEta,
  isPaused,
  handlePauseTransfer,
  handleResumeTransfer,
  handleCancelTransfer
}) {
  if (!transferringFile) return null;

  const isSending = transferringFile.direction === 'sending';

  return (
    <div className="progress-card">
      <div className="progress-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', overflow: 'hidden' }}>
          <span className="file-type-icon" style={{ display: 'inline-flex', padding: '6px', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.1)', color: 'var(--color-primary)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </span>
          <div style={{ overflow: 'hidden' }}>
            <span className="progress-title" title={transferringFile.name} style={{ display: 'block', fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
              {transferringFile.name}
            </span>
            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              {formatBytes(transferringFile.size)} • {isSending ? 'Sending to peer' : 'Receiving from peer'}
            </span>
          </div>
        </div>

        <span className="progress-queue-badge" style={{ background: isPaused ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)', color: isPaused ? 'var(--color-warning)' : 'var(--color-success)' }}>
          {isPaused ? 'Paused' : isSending ? 'Streaming' : 'Downloading'}
        </span>
      </div>

      <div className="progress-bar-container" style={{ margin: '1rem 0 0.5rem 0', height: '8px', background: 'var(--color-border)', borderRadius: '4px', overflow: 'hidden' }}>
        <div
          className="progress-bar-fill"
          style={{
            width: `${transferProgress}%`,
            height: '100%',
            background: isPaused ? 'var(--color-warning)' : 'linear-gradient(90deg, #3b82f6, #10b981)',
            transition: 'width 0.15s ease-out'
          }}
        ></div>
      </div>

      <div className="progress-stats" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
        <span>Speed: <strong style={{ color: 'var(--color-text)' }}>{transferSpeed} MB/s</strong></span>
        <span>Remaining: <strong style={{ color: 'var(--color-text)' }}>{transferEta}</strong></span>
        <span>Progress: <strong style={{ color: 'var(--color-text)' }}>{transferProgress}%</strong></span>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {isPaused ? (
          <button
            type="button"
            onClick={handleResumeTransfer}
            className="btn-primary"
            style={{ flex: 1, padding: '0.45rem', fontSize: '0.85rem' }}
          >
            Resume
          </button>
        ) : (
          <button
            type="button"
            onClick={handlePauseTransfer}
            className="btn-secondary"
            style={{ flex: 1, padding: '0.45rem', fontSize: '0.85rem' }}
          >
            Pause
          </button>
        )}
        <button
          type="button"
          onClick={handleCancelTransfer}
          className="btn-secondary"
          style={{ flex: 1, padding: '0.45rem', fontSize: '0.85rem', color: 'var(--color-error)', borderColor: 'rgba(239, 68, 68, 0.25)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
