import React from 'react';

export default function FileDropZone({
  dragActive,
  handleDrag,
  handleDrop,
  handleFileSelect,
  transferringFile
}) {
  if (transferringFile) return null;

  return (
    <div 
      className={`file-drop-zone ${dragActive ? 'drag-active' : ''}`}
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
      onClick={() => document.getElementById('file-input').click()}
    >
      <svg className="upload-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
      </svg>
      <p className="drop-zone-text">Drag & drop files or click to choose</p>
      <p className="drop-zone-subtext">Direct streaming, zero server uploads</p>
      <input 
        id="file-input" 
        type="file" 
        multiple 
        className="file-input-hidden" 
        onChange={handleFileSelect} 
      />
    </div>
  );
}
