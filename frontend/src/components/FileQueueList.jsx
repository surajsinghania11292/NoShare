import React from 'react';
import { formatBytes } from '../utils/format';

export default function FileQueueList({
  fileQueue,
  transferringFile,
  sendNextFileInQueue
}) {
  if (fileQueue.length === 0 || transferringFile) return null;

  return (
    <>
      <div className="queue-list-container">
        <div className="queue-title">Queue ({fileQueue.length} files)</div>
        {fileQueue.map((file, idx) => (
          <div key={idx} className="queue-item">
            <span className="queue-file-name" title={file.name}>{file.name}</span>
            <span className="queue-file-size">{formatBytes(file.size)}</span>
          </div>
        ))}
      </div>
      <button onClick={sendNextFileInQueue} className="btn-primary">
        Send Files
      </button>
    </>
  );
}
