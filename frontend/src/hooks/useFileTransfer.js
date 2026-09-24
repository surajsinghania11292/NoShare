import { useState, useRef } from 'react';
import { formatBytes } from '../utils/format';

const CHUNK_SIZE = 256 * 1024; // 256KB high-throughput binary chunk size
const BUFFER_THRESHOLD = 16 * 1024 * 1024; // 16MB buffer ceiling for uninterrupted pipeline

export default function useFileTransfer({
  channelRef,
  addLog,
  setErrorMsg,
  cleanupWebRTC
}) {
  const [fileQueue, setFileQueue] = useState([]);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [transferringFile, setTransferringFile] = useState(null); // { name, size, mimeType }
  const [pendingIncomingFile, setPendingIncomingFile] = useState(null); // staged metadata waiting for user accept click
  const [transferProgress, setTransferProgress] = useState(0); // 0-100
  const [transferSpeed, setTransferSpeed] = useState('0.00'); // MB/s

  // State synchronization refs
  const fileQueueRef = useRef([]);
  const transferringFileRef = useRef(null);

  // Flow control refs
  const resolveBufferedAmountLow = useRef(null);
  const ackResolver = useRef(null);
  const readyResolver = useRef(null);
  const isTransferring = useRef(false);
  const isCancelled = useRef(false);

  // Speed sampling refs
  const lastSpeedSampleTime = useRef(0);
  const lastSpeedSampleBytes = useRef(0);

  // Receiver stream state refs
  const writableStreamRef = useRef(null);
  const fallbackBuffersRef = useRef([]);
  const receiverBytesTotal = useRef(0);
  const receiverBytesReceived = useRef(0);
  const receiverSpeedSampleTime = useRef(0);
  const receiverSpeedSampleBytes = useRef(0);

  const setTransferringFileWithRef = (val) => {
    setTransferringFile(val);
    transferringFileRef.current = val;
  };

  const addFilesToQueue = (files) => {
    setFileQueue((prev) => {
      const updated = [...prev, ...files];
      fileQueueRef.current = updated;
      addLog(`Added ${files.length} file(s) to queue. Total: ${updated.length}`, 'info');
      return updated;
    });
  };

  const resetTransferStates = () => {
    isTransferring.current = false;
    isCancelled.current = false;
    ackResolver.current = null;
    readyResolver.current = null;
    resolveBufferedAmountLow.current = null;
    setTransferringFileWithRef(null);
    setTransferProgress(0);
    setTransferSpeed('0.00');
    setFileQueue([]);
    fileQueueRef.current = [];
    fallbackBuffersRef.current = [];
  };

  const handleCancelTransfer = async () => {
    addLog('Initiating manual transfer cancellation...', 'warning');
    isCancelled.current = true;
    
    if (channelRef.current && channelRef.current.readyState === 'open') {
      channelRef.current.send(JSON.stringify({ type: 'cancel' }));
    }

    if (writableStreamRef.current) {
      try {
        await writableStreamRef.current.abort();
      } catch (e) {}
      writableStreamRef.current = null;
    }
    fallbackBuffersRef.current = [];

    if (readyResolver.current) {
      readyResolver.current.reject(new Error('Cancelled by user'));
      readyResolver.current = null;
    }
    if (resolveBufferedAmountLow.current) {
      resolveBufferedAmountLow.current();
      resolveBufferedAmountLow.current = null;
    }

    resetTransferStates();
  };

  const sendNextFileInQueue = async () => {
    if (isTransferring.current) return;
    isTransferring.current = true;
    isCancelled.current = false;

    const list = fileQueueRef.current;
    addLog(`Initiating high-speed transfer of ${list.length} file(s)...`, 'info');

    for (let i = 0; i < list.length; i++) {
      if (isCancelled.current) break;

      const file = list[i];
      setCurrentFileIndex(i);
      setTransferringFileWithRef({ name: file.name, size: file.size, mimeType: file.type });
      setTransferProgress(0);
      setTransferSpeed('0.00');

      addLog(`Sending file metadata for "${file.name}" (${formatBytes(file.size)})`, 'info');
      
      const metadata = {
        type: 'metadata',
        name: file.name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
      };
      
      if (!channelRef.current || channelRef.current.readyState !== 'open') {
        addLog('Aborted transfer: Data channel closed.', 'error');
        resetTransferStates();
        return;
      }
      channelRef.current.send(JSON.stringify(metadata));

      try {
        addLog('Awaiting Receiver file save setup & accept click...', 'info');
        await new Promise((resolve, reject) => {
          readyResolver.current = { resolve, reject };
        });
      } catch (err) {
        addLog(`Transfer aborted: ${err.message}`, 'error');
        resetTransferStates();
        return;
      }

      if (isCancelled.current) break;

      let bytesSent = 0;
      let offset = 0;
      lastSpeedSampleTime.current = Date.now();
      lastSpeedSampleBytes.current = 0;

      while (offset < file.size) {
        if (isCancelled.current) {
          addLog('Slicing loop halted: transfer cancelled.', 'warning');
          return;
        }

        if (!channelRef.current || channelRef.current.readyState !== 'open') {
          addLog('Aborted transfer: Data channel disconnected.', 'error');
          resetTransferStates();
          return;
        }

        // Throttle sender only when WebRTC buffer is completely saturated
        if (channelRef.current.bufferedAmount > BUFFER_THRESHOLD) {
          await new Promise((resolve) => {
            resolveBufferedAmountLow.current = resolve;
          });
        }

        const end = Math.min(offset + CHUNK_SIZE, file.size);
        try {
          // Native high-speed zero-overhead slicing
          const chunkBuffer = await file.slice(offset, end).arrayBuffer();
          
          // Prepend 8-byte offset header for positional disk writing
          const packet = new Uint8Array(8 + chunkBuffer.byteLength);
          const view = new DataView(packet.buffer);
          view.setBigUint64(0, BigInt(offset));
          packet.set(new Uint8Array(chunkBuffer), 8);

          channelRef.current.send(packet.buffer);
          bytesSent += (end - offset);
          offset = end;

          const percent = Math.floor((bytesSent / file.size) * 100);
          setTransferProgress(percent);

          // Windowed real-time instantaneous speed calculation
          const now = Date.now();
          const timeDelta = (now - lastSpeedSampleTime.current) / 1000;
          if (timeDelta >= 0.25) {
            const bytesDelta = bytesSent - lastSpeedSampleBytes.current;
            const speedMBs = (bytesDelta / (1024 * 1024)) / timeDelta;
            setTransferSpeed(speedMBs.toFixed(2));
            lastSpeedSampleTime.current = now;
            lastSpeedSampleBytes.current = bytesSent;
          }
        } catch (err) {
          addLog(`Error reading file segment: ${err.message}`, 'error');
          resetTransferStates();
          return;
        }
      }

      if (isCancelled.current) break;

      addLog(`Finished sending file bytes for "${file.name}". Emitting EOF...`, 'info');
      channelRef.current.send(JSON.stringify({ type: 'eof' }));

      addLog('Awaiting Receiver receipt acknowledgment...', 'info');
      await new Promise((resolve) => {
        ackResolver.current = resolve;
      });
      addLog(`Received ACK from Receiver for "${file.name}".`, 'success');
    }

    addLog('File transmission queue complete!', 'success');
    resetTransferStates();
  };

  const handleAcceptFile = async () => {
    if (!pendingIncomingFile) return;

    if (window.showSaveFilePicker) {
      try {
        addLog(`User accepted transfer. Prompting directory save dialog for "${pendingIncomingFile.name}"...`, 'info');
        const fileHandle = await window.showSaveFilePicker({
          suggestedName: pendingIncomingFile.name,
        });
        
        addLog('Save file handle resolved. Creating writable file stream...', 'info');
        const writable = await fileHandle.createWritable({ keepExistingData: false });
        writableStreamRef.current = writable;

        setTransferringFileWithRef({ 
          name: pendingIncomingFile.name, 
          size: pendingIncomingFile.size, 
          mimeType: pendingIncomingFile.mimeType 
        });
        setTransferProgress(0);
        setTransferSpeed('0.00');
        receiverBytesTotal.current = pendingIncomingFile.size;
        receiverBytesReceived.current = 0;
        receiverSpeedSampleTime.current = Date.now();
        receiverSpeedSampleBytes.current = 0;

        addLog('Write stream initialized. Sending ready handshake packet...', 'success');
        if (channelRef.current && channelRef.current.readyState === 'open') {
          channelRef.current.send(JSON.stringify({ type: 'ready' }));
        }
        setPendingIncomingFile(null);
      } catch (err) {
        if (err.name === 'AbortError') {
          addLog('User cancelled the file save picker dialog.', 'warning');
          if (channelRef.current && channelRef.current.readyState === 'open') {
            channelRef.current.send(JSON.stringify({ type: 'error', message: 'User aborted save' }));
          }
        } else {
          addLog(`Failed to initialize save file stream: ${err.message}`, 'error');
          if (channelRef.current && channelRef.current.readyState === 'open') {
            channelRef.current.send(JSON.stringify({ type: 'error', message: err.message }));
          }
        }
        resetTransferStates();
        setPendingIncomingFile(null);
      }
    } else {
      addLog(`User accepted legacy transfer. Legacy Mode buffering started for "${pendingIncomingFile.name}"`, 'warning');
      fallbackBuffersRef.current = [];

      setTransferringFileWithRef({ 
        name: pendingIncomingFile.name, 
        size: pendingIncomingFile.size, 
        mimeType: pendingIncomingFile.mimeType 
      });
      setTransferProgress(0);
      setTransferSpeed('0.00');
      receiverBytesTotal.current = pendingIncomingFile.size;
      receiverBytesReceived.current = 0;
      receiverSpeedSampleTime.current = Date.now();
      receiverSpeedSampleBytes.current = 0;

      if (channelRef.current && channelRef.current.readyState === 'open') {
        channelRef.current.send(JSON.stringify({ type: 'ready' }));
      }
      setPendingIncomingFile(null);
    }
  };

  const handleDeclineFile = () => {
    if (!pendingIncomingFile) return;
    addLog(`User declined incoming file: "${pendingIncomingFile.name}"`, 'warning');
    if (channelRef.current && channelRef.current.readyState === 'open') {
      channelRef.current.send(JSON.stringify({ type: 'error', message: 'User declined transfer' }));
    }
    setPendingIncomingFile(null);
  };

  const handleBufferedAmountLow = () => {
    if (resolveBufferedAmountLow.current) {
      resolveBufferedAmountLow.current();
      resolveBufferedAmountLow.current = null;
    }
  };

  const handleDataChannelMessage = async (event) => {
    if (typeof event.data === 'string') {
      try {
        const packet = JSON.parse(event.data);
        
        if (packet.type === 'ready') {
          if (readyResolver.current) {
            readyResolver.current.resolve();
            readyResolver.current = null;
          }
        } else if (packet.type === 'error') {
          addLog(`Peer reported error: ${packet.message}`, 'error');
          setErrorMsg?.(`Transfer aborted: ${packet.message}`);
          if (readyResolver.current) {
            readyResolver.current.reject(new Error(packet.message));
            readyResolver.current = null;
          }
          resetTransferStates();
        } else if (packet.type === 'cancel') {
          addLog('Transfer cancelled by peer.', 'warning');
          
          if (writableStreamRef.current) {
            try {
              await writableStreamRef.current.abort();
            } catch (e) {}
            writableStreamRef.current = null;
          }
          fallbackBuffersRef.current = [];

          if (readyResolver.current) {
            readyResolver.current.reject(new Error('Cancelled by peer'));
            readyResolver.current = null;
          }
          if (resolveBufferedAmountLow.current) {
            resolveBufferedAmountLow.current();
            resolveBufferedAmountLow.current = null;
          }
          resetTransferStates();
        } else if (packet.type === 'ack') {
          if (ackResolver.current) {
            ackResolver.current();
            ackResolver.current = null;
          }
        } else if (packet.type === 'metadata') {
          addLog(`Incoming file request: "${packet.name}" (${formatBytes(packet.size)})`, 'info');
          setPendingIncomingFile(packet);
        } else if (packet.type === 'eof') {
          if (window.showSaveFilePicker && writableStreamRef.current) {
            try {
              addLog('EOF received. Closing disk write stream...', 'info');
              await writableStreamRef.current.close();
              writableStreamRef.current = null;
              addLog('File saved successfully to hard drive. Sending ACK...', 'success');
              channelRef.current?.send(JSON.stringify({ type: 'ack' }));
              
              setTransferProgress(100);
              setTransferringFileWithRef(null);
            } catch (err) {
              addLog(`Error saving file stream: ${err.message}`, 'error');
              resetTransferStates();
            }
          } else if (!window.showSaveFilePicker) {
            try {
              addLog('EOF received. Sorting buffered slices into Blob...', 'info');
              fallbackBuffersRef.current.sort((a, b) => a.offset - b.offset);
              const orderedBuffers = fallbackBuffersRef.current.map(item => item.data);
              const blob = new Blob(orderedBuffers, {
                type: transferringFileRef.current?.mimeType || 'application/octet-stream',
              });
              
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = transferringFileRef.current?.name || 'downloaded-file';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
              
              addLog('Legacy download triggered. Sending ACK...', 'success');
              channelRef.current?.send(JSON.stringify({ type: 'ack' }));
              fallbackBuffersRef.current = [];
              
              setTransferProgress(100);
              setTransferringFileWithRef(null);
            } catch (err) {
              addLog(`Legacy compilation error: ${err.message}`, 'error');
              resetTransferStates();
            }
          }
        }
      } catch (e) {
        addLog(`String packet received: ${event.data}`, 'info');
      }
    } else {
      const buffer = event.data;
      if (!buffer || buffer.byteLength < 8) return;

      try {
        const dataView = new DataView(buffer);
        const chunkOffset = Number(dataView.getBigUint64(0));
        const chunkPayload = buffer.slice(8);

        if (window.showSaveFilePicker && writableStreamRef.current) {
          // Direct positional disk write — allows unordered high-speed transfers without file corruption
          await writableStreamRef.current.write({
            type: 'write',
            position: chunkOffset,
            data: chunkPayload
          });
        } else if (!window.showSaveFilePicker) {
          fallbackBuffersRef.current.push({ offset: chunkOffset, data: chunkPayload });
        } else {
          addLog('Warning: File stream is closed. Discarding incoming bytes.', 'warning');
          return;
        }

        receiverBytesReceived.current += chunkPayload.byteLength;
        const total = receiverBytesTotal.current;
        if (total > 0) {
          const percent = Math.floor((receiverBytesReceived.current / total) * 100);
          setTransferProgress(percent);

          // Real-time instantaneous speed windowing for receiver
          const now = Date.now();
          const timeDelta = (now - receiverSpeedSampleTime.current) / 1000;
          if (timeDelta >= 0.25) {
            const bytesDelta = receiverBytesReceived.current - receiverSpeedSampleBytes.current;
            const speedMBs = (bytesDelta / (1024 * 1024)) / timeDelta;
            setTransferSpeed(speedMBs.toFixed(2));
            receiverSpeedSampleTime.current = now;
            receiverSpeedSampleBytes.current = receiverBytesReceived.current;
          }
        }
      } catch (err) {
        addLog(`Error writing chunk: ${err.message}`, 'error');
        channelRef.current?.send(JSON.stringify({ type: 'error', message: 'Disk write failure' }));
        cleanupWebRTC?.();
      }
    }
  };

  return {
    fileQueue,
    currentFileIndex,
    transferringFile,
    pendingIncomingFile,
    transferProgress,
    transferSpeed,
    addFilesToQueue,
    resetTransferStates,
    handleCancelTransfer,
    sendNextFileInQueue,
    handleAcceptFile,
    handleDeclineFile,
    handleBufferedAmountLow,
    handleDataChannelMessage
  };
}
