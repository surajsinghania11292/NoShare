import { useState, useRef, useCallback } from 'react';
import { formatBytes, formatEta, sanitizeFileName } from '../utils/format';
import {
  StorageReceiverEngine,
  generateFileId,
  getCheckpoint,
  removeCheckpoint
} from '../utils/storageEngine';
import { getDeviceProfile } from '../utils/deviceProfile';

export default function useFileTransfer({
  channelRef,
  channelsRef,
  addLog,
  setErrorMsg,
  cleanupWebRTC
}) {
  const [fileQueue, setFileQueue] = useState([]);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [transferringFile, setTransferringFile] = useState(null); // { fileId, name, size, mimeType, direction }
  const [pendingIncomingFile, setPendingIncomingFile] = useState(null); // staged metadata waiting for user accept click
  const [transferProgress, setTransferProgress] = useState(0); // 0-100
  const [transferSpeed, setTransferSpeed] = useState('0.00'); // MB/s
  const [transferEta, setTransferEta] = useState('--'); // human readable remaining time
  const [isPaused, setIsPaused] = useState(false);

  // State synchronization refs
  const fileQueueRef = useRef([]);
  const transferringFileRef = useRef(null);
  const isPausedRef = useRef(false);
  const pauseResolverRef = useRef(null);

  // Flow control refs
  const resolveBufferedAmountLow = useRef(null);
  const ackResolver = useRef(null);
  const readyResolver = useRef(null);
  const isTransferring = useRef(false);
  const isCancelled = useRef(false);

  // Speed & ETA sampling refs
  const lastSpeedSampleTime = useRef(0);
  const lastSpeedSampleBytes = useRef(0);

  // Receiver stream state refs
  const storageEngineRef = useRef(null);
  const receiverBytesTotal = useRef(0);
  const receiverBytesReceived = useRef(0);
  const receiverSpeedSampleTime = useRef(0);
  const receiverSpeedSampleBytes = useRef(0);

  const deviceProfile = getDeviceProfile();

  const setTransferringFileWithRef = (val) => {
    setTransferringFile(val);
    transferringFileRef.current = val;
  };

  const addFilesToQueue = useCallback((files) => {
    setFileQueue((prev) => {
      const updated = [...prev, ...files];
      fileQueueRef.current = updated;
      addLog(`Added ${files.length} file(s) to queue. Total: ${updated.length}`, 'info');
      return updated;
    });
  }, [addLog]);

  const removeFileFromQueue = useCallback((index) => {
    setFileQueue((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      fileQueueRef.current = updated;
      return updated;
    });
  }, []);

  const clearQueue = useCallback(() => {
    setFileQueue([]);
    fileQueueRef.current = [];
  }, []);

  const resetTransferStates = useCallback(() => {
    isTransferring.current = false;
    isCancelled.current = false;
    isPausedRef.current = false;
    setIsPaused(false);
    ackResolver.current = null;
    readyResolver.current = null;
    resolveBufferedAmountLow.current = null;
    if (pauseResolverRef.current) {
      pauseResolverRef.current();
      pauseResolverRef.current = null;
    }
    setTransferringFileWithRef(null);
    setTransferProgress(0);
    setTransferSpeed('0.00');
    setTransferEta('--');
    if (storageEngineRef.current) {
      storageEngineRef.current.abort().catch(() => {});
      storageEngineRef.current = null;
    }
  }, []);

  const handlePauseTransfer = useCallback(() => {
    if (!isTransferring.current && !transferringFileRef.current) return;
    addLog('Pausing file transfer...', 'info');
    isPausedRef.current = true;
    setIsPaused(true);
    const primary = channelRef.current;
    if (primary && primary.readyState === 'open') {
      primary.send(JSON.stringify({ type: 'pause' }));
    }
  }, [addLog, channelRef]);

  const handleResumeTransfer = useCallback(() => {
    if (!isPausedRef.current) return;
    addLog('Resuming file transfer...', 'info');
    isPausedRef.current = false;
    setIsPaused(false);
    const primary = channelRef.current;
    if (primary && primary.readyState === 'open') {
      primary.send(JSON.stringify({ type: 'resume' }));
    }
    if (pauseResolverRef.current) {
      pauseResolverRef.current();
      pauseResolverRef.current = null;
    }
  }, [addLog, channelRef]);

  const handleCancelTransfer = useCallback(async () => {
    addLog('Cancelling active file transfer...', 'warning');
    isCancelled.current = true;

    const primary = channelRef.current;
    if (primary && primary.readyState === 'open') {
      primary.send(JSON.stringify({ type: 'cancel' }));
    }

    if (storageEngineRef.current) {
      try {
        await storageEngineRef.current.abort();
      } catch {}
      storageEngineRef.current = null;
    }

    if (readyResolver.current) {
      readyResolver.current.reject(new Error('Cancelled by user'));
      readyResolver.current = null;
    }
    if (resolveBufferedAmountLow.current) {
      resolveBufferedAmountLow.current();
      resolveBufferedAmountLow.current = null;
    }
    if (pauseResolverRef.current) {
      pauseResolverRef.current();
      pauseResolverRef.current = null;
    }

    resetTransferStates();
  }, [addLog, channelRef, resetTransferStates]);

  const sendNextFileInQueue = async () => {
    if (isTransferring.current) return;
    const list = fileQueueRef.current;
    if (!list || list.length === 0) return;

    isTransferring.current = true;
    isCancelled.current = false;
    isPausedRef.current = false;
    setIsPaused(false);

    addLog(`Initiating high-throughput transfer of ${list.length} file(s)...`, 'info');

    for (let i = 0; i < list.length; i++) {
      if (isCancelled.current) break;

      const file = list[i];
      const safeName = sanitizeFileName(file.name);
      const fileId = generateFileId(safeName, file.size, file.lastModified);

      setCurrentFileIndex(i);
      setTransferringFileWithRef({
        fileId,
        name: safeName,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        direction: 'sending'
      });
      setTransferProgress(0);
      setTransferSpeed('0.00');
      setTransferEta('--');

      addLog(`Broadcasting metadata for "${safeName}" (${formatBytes(file.size)})`, 'info');

      const metadata = {
        type: 'metadata',
        fileId,
        name: safeName,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        lastModified: file.lastModified || 0
      };

      const primaryChannel = channelRef.current;
      if (!primaryChannel || primaryChannel.readyState !== 'open') {
        addLog('Aborted transfer: Primary DataChannel not connected.', 'error');
        resetTransferStates();
        return;
      }
      primaryChannel.send(JSON.stringify(metadata));

      let resumeOffset = 0;
      try {
        addLog('Waiting for peer confirmation...', 'info');
        const readyPacket = await new Promise((resolve, reject) => {
          readyResolver.current = { resolve, reject };
        });
        if (readyPacket && readyPacket.resumeOffset) {
          resumeOffset = readyPacket.resumeOffset;
          addLog(`Resuming transfer of "${safeName}" from ${formatBytes(resumeOffset)}!`, 'success');
        }
      } catch (err) {
        addLog(`Transfer aborted: ${err.message}`, 'error');
        resetTransferStates();
        return;
      }

      if (isCancelled.current) break;

      let bytesSent = resumeOffset;
      let offset = resumeOffset;
      lastSpeedSampleTime.current = Date.now();
      lastSpeedSampleBytes.current = resumeOffset;

      const initialPercent = file.size > 0 ? Math.floor((bytesSent / file.size) * 100) : 0;
      setTransferProgress(initialPercent);

      // Adaptive Dynamic Sizing (AIMD) & Channel Striping
      let currentChunkSize = deviceProfile.initialChunkSize;
      let chunkCounter = 0;

      while (offset < file.size) {
        if (isCancelled.current) {
          addLog('Transfer cancelled during streaming.', 'warning');
          return;
        }

        // Pause check
        if (isPausedRef.current) {
          await new Promise((resolve) => {
            pauseResolverRef.current = resolve;
          });
        }

        // Retrieve available striped channels
        const availableChannels =
          channelsRef?.current?.filter((c) => c.readyState === 'open') ||
          [channelRef.current].filter(Boolean);

        if (availableChannels.length === 0) {
          addLog('Aborted: All DataChannels disconnected.', 'error');
          resetTransferStates();
          return;
        }

        // Pick next striped channel
        const targetChannel = availableChannels[chunkCounter % availableChannels.length];
        chunkCounter++;

        // Backpressure monitoring with AIMD dynamic chunk tuning
        if (targetChannel.bufferedAmount > deviceProfile.highBufferThreshold) {
          // Multiplicative decrease (scale down chunk size)
          currentChunkSize = Math.max(
            deviceProfile.minChunkSize,
            Math.floor(currentChunkSize * 0.75)
          );
          await new Promise((resolve) => {
            resolveBufferedAmountLow.current = resolve;
          });
        } else if (targetChannel.bufferedAmount < deviceProfile.lowBufferThreshold) {
          // Additive increase (scale up chunk size)
          currentChunkSize = Math.min(
            deviceProfile.maxChunkSize,
            currentChunkSize + 4 * 1024
          );
        }

        const end = Math.min(offset + currentChunkSize, file.size);

        try {
          const chunkBuffer = await file.slice(offset, end).arrayBuffer();

          // 8-byte BigInt64 offset + payload
          const packet = new Uint8Array(8 + chunkBuffer.byteLength);
          const view = new DataView(packet.buffer);
          view.setBigUint64(0, BigInt(offset));
          packet.set(new Uint8Array(chunkBuffer), 8);

          targetChannel.send(packet.buffer);
          bytesSent += (end - offset);
          offset = end;

          const percent = Math.floor((bytesSent / file.size) * 100);
          setTransferProgress(percent);

          // Real-time speed and ETA sampling
          const now = Date.now();
          const timeDelta = (now - lastSpeedSampleTime.current) / 1000;
          if (timeDelta >= 0.25) {
            const bytesDelta = bytesSent - lastSpeedSampleBytes.current;
            const bytesPerSec = bytesDelta / timeDelta;
            const speedMBs = (bytesPerSec / (1024 * 1024)).toFixed(2);
            setTransferSpeed(speedMBs);

            const remainingBytes = file.size - bytesSent;
            const etaSeconds = bytesPerSec > 0 ? remainingBytes / bytesPerSec : 0;
            setTransferEta(formatEta(etaSeconds));

            lastSpeedSampleTime.current = now;
            lastSpeedSampleBytes.current = bytesSent;
          }

          // Yield execution to preserve 60fps UI
          await new Promise((r) => setTimeout(r, 0));
        } catch (err) {
          addLog(`Error slicing file segment: ${err.message}`, 'error');
          resetTransferStates();
          return;
        }
      }

      if (isCancelled.current) break;

      addLog(`File "${safeName}" fully streamed. Emitting EOF to primary channel...`, 'info');
      primaryChannel.send(JSON.stringify({ type: 'eof', fileId }));

      await new Promise((resolve) => {
        ackResolver.current = resolve;
      });
      addLog(`Transfer completed successfully for "${safeName}"!`, 'success');
      await removeCheckpoint(fileId);
    }

    addLog('All files in queue transferred successfully!', 'success');
    resetTransferStates();
    setFileQueue([]);
    fileQueueRef.current = [];
  };

  const handleAcceptFile = async (forceSavePicker = false) => {
    if (!pendingIncomingFile) return;

    const fileMeta = pendingIncomingFile;
    const resumeOffset = fileMeta.resumeOffset || 0;

    try {
      addLog(`Preparing zero-RAM storage engine for "${fileMeta.name}"...`, 'info');
      const engine = new StorageReceiverEngine(fileMeta, addLog);
      storageEngineRef.current = engine;

      const initResult = await engine.init(resumeOffset, forceSavePicker);
      const actualResumeOffset = initResult.resumeOffset || 0;

      setTransferringFileWithRef({
        fileId: fileMeta.fileId,
        name: fileMeta.name,
        size: fileMeta.size,
        mimeType: fileMeta.mimeType,
        direction: 'receiving'
      });
      setTransferProgress(
        fileMeta.size > 0 ? Math.floor((actualResumeOffset / fileMeta.size) * 100) : 0
      );
      setTransferSpeed('0.00');
      setTransferEta('--');

      receiverBytesTotal.current = fileMeta.size;
      receiverBytesReceived.current = actualResumeOffset;
      receiverSpeedSampleTime.current = Date.now();
      receiverSpeedSampleBytes.current = actualResumeOffset;

      const primary = channelRef.current;
      if (primary && primary.readyState === 'open') {
        primary.send(
          JSON.stringify({
            type: 'ready',
            fileId: fileMeta.fileId,
            resumeOffset: actualResumeOffset
          })
        );
      }
      setPendingIncomingFile(null);
    } catch (err) {
      if (err.name === 'AbortError') {
        addLog('User cancelled save directory selection.', 'warning');
        const primary = channelRef.current;
        if (primary && primary.readyState === 'open') {
          primary.send(JSON.stringify({ type: 'error', message: 'User aborted save' }));
        }
      } else {
        addLog(`Storage engine initialization failed: ${err.message}`, 'error');
        const primary = channelRef.current;
        if (primary && primary.readyState === 'open') {
          primary.send(JSON.stringify({ type: 'error', message: err.message }));
        }
      }
      resetTransferStates();
      setPendingIncomingFile(null);
    }
  };

  const handleDeclineFile = () => {
    if (!pendingIncomingFile) return;
    addLog(`User declined incoming file: "${pendingIncomingFile.name}"`, 'warning');
    const primary = channelRef.current;
    if (primary && primary.readyState === 'open') {
      primary.send(JSON.stringify({ type: 'error', message: 'User declined transfer' }));
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
            readyResolver.current.resolve(packet);
            readyResolver.current = null;
          }
        } else if (packet.type === 'pause') {
          addLog('Peer paused the file transfer.', 'info');
          isPausedRef.current = true;
          setIsPaused(true);
        } else if (packet.type === 'resume') {
          addLog('Peer resumed the file transfer.', 'info');
          isPausedRef.current = false;
          setIsPaused(false);
          if (pauseResolverRef.current) {
            pauseResolverRef.current();
            pauseResolverRef.current = null;
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
          addLog('Transfer was cancelled by peer.', 'warning');
          if (storageEngineRef.current) {
            try {
              await storageEngineRef.current.abort();
            } catch {}
            storageEngineRef.current = null;
          }
          if (readyResolver.current) {
            readyResolver.current.reject(new Error('Cancelled by peer'));
            readyResolver.current = null;
          }
          if (resolveBufferedAmountLow.current) {
            resolveBufferedAmountLow.current();
            resolveBufferedAmountLow.current = null;
          }
          if (pauseResolverRef.current) {
            pauseResolverRef.current();
            pauseResolverRef.current = null;
          }
          resetTransferStates();
        } else if (packet.type === 'ack') {
          if (ackResolver.current) {
            ackResolver.current();
            ackResolver.current = null;
          }
        } else if (packet.type === 'metadata') {
          const safeName = sanitizeFileName(packet.name);
          const fileId =
            packet.fileId || generateFileId(safeName, packet.size, packet.lastModified);
          const meta = {
            ...packet,
            name: safeName,
            fileId
          };

          addLog(`Incoming file request: "${safeName}" (${formatBytes(packet.size)})`, 'info');

          // Check for existing partial checkpoint
          const checkpoint = await getCheckpoint(fileId);
          if (checkpoint && checkpoint.bytesReceived > 0 && checkpoint.bytesReceived < packet.size) {
            meta.resumeOffset = checkpoint.bytesReceived;
            meta.isResume = true;
            addLog(
              `Found previous partial transfer! Can resume from ${formatBytes(
                checkpoint.bytesReceived
              )}.`,
              'success'
            );
          }

          setPendingIncomingFile(meta);
        } else if (packet.type === 'eof') {
          if (storageEngineRef.current) {
            try {
              addLog('EOF received. Finalizing file download...', 'info');
              await storageEngineRef.current.finalize();
              const primary = channelRef.current;
              primary?.send(JSON.stringify({ type: 'ack', fileId: packet.fileId }));
              setTransferProgress(100);
              setTransferringFileWithRef(null);
              storageEngineRef.current = null;
            } catch (err) {
              addLog(`Error finalizing file: ${err.message}`, 'error');
              resetTransferStates();
            }
          }
        }
      } catch (e) {
        addLog(`Malformed packet received: ${event.data}`, 'warning');
      }
    } else {
      // Binary chunk packet (can arrive on ANY striped channel!)
      const buffer = event.data;
      if (!buffer || buffer.byteLength < 8) return;

      try {
        const dataView = new DataView(buffer);
        const chunkOffset = Number(dataView.getBigUint64(0));
        const chunkPayload = buffer.slice(8);

        if (storageEngineRef.current) {
          await storageEngineRef.current.writeChunk(chunkOffset, chunkPayload);
        } else {
          return;
        }

        receiverBytesReceived.current += chunkPayload.byteLength;
        const total = receiverBytesTotal.current;
        if (total > 0) {
          const percent = Math.floor((receiverBytesReceived.current / total) * 100);
          setTransferProgress(percent);

          // Receiver instantaneous speed and ETA calculation
          const now = Date.now();
          const timeDelta = (now - receiverSpeedSampleTime.current) / 1000;
          if (timeDelta >= 0.25) {
            const bytesDelta = receiverBytesReceived.current - receiverSpeedSampleBytes.current;
            const bytesPerSec = bytesDelta / timeDelta;
            const speedMBs = (bytesPerSec / (1024 * 1024)).toFixed(2);
            setTransferSpeed(speedMBs);

            const remainingBytes = total - receiverBytesReceived.current;
            const etaSeconds = bytesPerSec > 0 ? remainingBytes / bytesPerSec : 0;
            setTransferEta(formatEta(etaSeconds));

            receiverSpeedSampleTime.current = now;
            receiverSpeedSampleBytes.current = receiverBytesReceived.current;
          }
        }
      } catch (err) {
        addLog(`Disk write error: ${err.message}`, 'error');
        channelRef.current?.send(
          JSON.stringify({ type: 'error', message: 'Storage write failed' })
        );
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
    transferEta,
    isPaused,
    addFilesToQueue,
    removeFileFromQueue,
    clearQueue,
    resetTransferStates,
    handlePauseTransfer,
    handleResumeTransfer,
    handleCancelTransfer,
    sendNextFileInQueue,
    handleAcceptFile,
    handleDeclineFile,
    handleBufferedAmountLow,
    handleDataChannelMessage
  };
}
