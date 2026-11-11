import React from 'react';
import { formatBytes } from '../utils/format';

export default function FileQueueList({
  fileQueue,
  transferringFile,
  sendNextFileInQueue,
  removeFileFromQueue,
  clearQueue
}) {
  if (!fileQueue || fileQueue.length === 0 || transferringFile) return null;

  return (
    <div className="queue-list-container" style={{ marginTop: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <span className="queue-title" style={{ fontWeight: 600 }}>Queue ({fileQueue.length} {fileQueue.length === 1 ? 'file' : 'files'})</span>
        <button
          type="button"
          onClick={clearQueue}
          className="btn-text"
          style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          Clear All
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '180px', overflowY: 'auto', marginBottom: '0.75rem' }}>
        {fileQueue.map((file, idx) => (
          <div
            key={idx}
            className="queue-item"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0.5rem 0.75rem',
              background: 'var(--color-bg)',
              borderRadius: '8px',
              border: '1px solid var(--color-border)',
              fontSize: '0.85rem'
            }}
          >
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
              <span className="queue-file-name" title={file.name} style={{ fontWeight: 500 }}>
                {file.name}
              </span>
              <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                {formatBytes(file.size)}
              </span>
            </div>

            <button
              type="button"
              onClick={() => removeFileFromQueue(idx)}
              style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '4px' }}
              title="Remove file"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={sendNextFileInQueue}
        className="btn-primary"
        style={{ width: '100%', padding: '0.65rem' }}
      >
        Send {fileQueue.length} {fileQueue.length === 1 ? 'File' : 'Files'} Now
      </button>
    </div>
  );
}
