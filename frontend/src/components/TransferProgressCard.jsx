import React from 'react';

export default function TransferProgressCard({
  transferringFile,
  role,
  currentFileIndex,
  fileQueueLength,
  transferProgress,
  transferSpeed,
  handleCancelTransfer
}) {
  if (!transferringFile) return null;

  return (
    <div className="progress-card">
      <div className="progress-header">
        <span className="progress-title" title={transferringFile.name}>
          {transferringFile.name}
        </span>
        <span className="progress-queue-badge">
          {role === 'host' 
            ? `Sending ${currentFileIndex + 1} of ${fileQueueLength}` 
            : 'Receiving...'}
        </span>
      </div>
      <div className="progress-bar-container">
        <div className="progress-bar-fill" style={{ width: `${transferProgress}%` }}></div>
      </div>
      <div className="progress-stats">
        <span className="stat-speed">{transferSpeed} MB/s</span>
        <span className="stat-percent">{transferProgress}%</span>
      </div>
      <button onClick={handleCancelTransfer} className="btn-secondary" style={{ marginTop: '0.5rem', color: 'var(--color-error)', borderColor: 'rgba(239, 68, 68, 0.2)' }}>
        Cancel Transfer
      </button>
    </div>
  );
}
