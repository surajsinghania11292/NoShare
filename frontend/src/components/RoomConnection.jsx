import React, { useState, useCallback, useRef, useEffect } from 'react';
import useSocket from '../hooks/useSocket';
import useWebRTC from '../hooks/useWebRTC';
import useFileTransfer from '../hooks/useFileTransfer';

import RoomJoinForm from './RoomJoinForm';
import ConnectionStatus from './ConnectionStatus';
import IncomingRequestCard from './IncomingRequestCard';
import TransferProgressCard from './TransferProgressCard';
import FileDropZone from './FileDropZone';
import FileQueueList from './FileQueueList';

export default function RoomConnection() {
  // UI and connection state
  const [roomCode, setRoomCode] = useState('');
  const [status, setStatus] = useState('disconnected'); // disconnected, joining, joined-waiting, ready, full
  const [role, setRole] = useState(null); // 'host' (sender) or 'guest' (receiver)
  const [joinedRoom, setJoinedRoom] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [isLegacyMode] = useState(!window.showSaveFilePicker);

  const roleRef = useRef(null);
  const joinedRoomRef = useRef('');
  const socketRef = useRef(null);
  const fileTransferRef = useRef(null);

  const setRoleAndRef = (val) => {
    setRole(val);
    roleRef.current = val;
  };

  const setJoinedRoomAndRef = (val) => {
    setJoinedRoom(val);
    joinedRoomRef.current = val;
  };

  // Helper to log signaling and flow messages
  const addLog = useCallback((message, type = 'info') => {
    console.log(`[${type.toUpperCase()}] ${message}`);
  }, []);

  // Proxy actions that delegate to the hooks
  const sendIceCandidate = (candidate) => socketRef.current?.sendIceCandidate(candidate);
  const sendOffer = (offer) => socketRef.current?.sendOffer(offer);
  const sendAnswer = (answer) => socketRef.current?.sendAnswer(answer);
  const joinRoom = (roomCode) => socketRef.current?.joinRoom(roomCode);
  const leaveRoom = () => socketRef.current?.leaveRoom();

  const handleDataChannelMessage = (event) => fileTransferRef.current?.handleDataChannelMessage(event);
  const resetTransferStates = () => fileTransferRef.current?.resetTransferStates();
  const handleBufferedAmountLow = () => fileTransferRef.current?.handleBufferedAmountLow();

  // Socket event handlers
  const handleConnect = useCallback(() => {
    addLog(`Connected to signaling server`, 'success');
    if (joinedRoomRef.current) {
      addLog(`Reconnecting to room ${joinedRoomRef.current} as ${roleRef.current}...`, 'info');
      socketRef.current?.joinRoom({ roomCode: joinedRoomRef.current, role: roleRef.current });
    }
  }, [addLog]);

  const handleConnectError = useCallback((error) => {
    addLog(`Connection error: ${error.message}`, 'error');
    setErrorMsg('Failed to connect to signaling server.');
    setStatus('disconnected');
  }, [addLog]);

  const handleRoomJoined = useCallback(({ role, roomCode }) => {
    setRoleAndRef(role);
    setJoinedRoomAndRef(roomCode);
    setStatus(role === 'host' ? 'joined-waiting' : 'ready');
    setErrorMsg('');
    addLog(`Joined room ${roomCode} as ${role.toUpperCase()}`, 'success');
  }, [addLog]);

  const handleReady = useCallback(async () => {
    setStatus('ready');
    setErrorMsg('');
    addLog('Both peers are connected to the room. Initiating WebRTC Handshake.', 'success');
    
    if (roleRef.current === 'host') {
      const pc = initPeerConnection(roleRef.current);
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendOffer(offer);
      } catch (err) {
        addLog(`Error creating SDP Offer: ${err.message}`, 'error');
      }
    }
  }, [addLog]);

  const handleOffer = useCallback(async (offer) => {
    setErrorMsg('');
    addLog('SDP Offer received from peer.', 'success');
    const pc = initPeerConnection(roleRef.current);
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      await processPendingCandidates();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendAnswer(answer);
    } catch (err) {
      addLog(`Error handling SDP Offer: ${err.message}`, 'error');
    }
  }, [addLog]);

  const handleAnswer = useCallback(async (answer) => {
    addLog('SDP Answer received from peer.', 'success');
    const pc = pcRef.current;
    if (!pc) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      await processPendingCandidates();
    } catch (err) {
      addLog(`Error setting Remote Description (Answer): ${err.message}`, 'error');
    }
  }, [addLog]);

  const handleIceCandidate = useCallback(async (candidate) => {
    const pc = pcRef.current;
    if (pc && pc.remoteDescription) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        addLog(`Error adding remote ICE Candidate: ${err.message}`, 'error');
      }
    } else {
      pendingCandidates.current.push(candidate);
    }
  }, []);

  const handleRoomFull = useCallback(({ roomCode }) => {
    setStatus('full');
    setErrorMsg(`Room ${roomCode} is full (max 2 users).`);
    addLog(`Failed to join: Room ${roomCode} is full.`, 'error');
  }, [addLog]);

  const handleServerErrorMsg = useCallback((msg) => {
    setErrorMsg(msg);
    addLog(`Server error: ${msg}`, 'error');
    setStatus((currentStatus) => {
      if (currentStatus === 'joining') return 'disconnected';
      return currentStatus;
    });
  }, [addLog]);

  const handlePeerDisconnected = useCallback(() => {
    cleanupWebRTC();
    setStatus('joined-waiting');
    addLog('Peer disconnected from room. Re-waiting for a new peer...', 'warning');
  }, [addLog]);

  const handleDisconnect = useCallback(() => {
    cleanupWebRTC();
    addLog('Disconnected from signaling server.', 'warning');
    setStatus('disconnected');
  }, [addLog]);

  const handleRoomClosed = useCallback(() => {
    cleanupWebRTC();
    setStatus('disconnected');
    setErrorMsg('The host has disconnected. Room closed.');
    addLog('The host disconnected. Room closed.', 'warning');
  }, [addLog]);

  // Instantiate Socket Signaling Hook
  const socket = useSocket({
    onConnect: handleConnect,
    onConnectError: handleConnectError,
    onRoomJoined: handleRoomJoined,
    onReady: handleReady,
    onOffer: handleOffer,
    onAnswer: handleAnswer,
    onIceCandidate: handleIceCandidate,
    onRoomFull: handleRoomFull,
    onErrorMsg: handleServerErrorMsg,
    onPeerDisconnected: handlePeerDisconnected,
    onDisconnect: handleDisconnect,
    onRoomClosed: handleRoomClosed
  });
  socketRef.current = socket;

  // Instantiate WebRTC connection manager Hook
  const {
    webrtcState,
    dataChannelStatus,
    connectionType,
    pcRef,
    channelRef,
    pendingCandidates,
    initPeerConnection,
    cleanupWebRTC,
    processPendingCandidates
  } = useWebRTC({
    role,
    sendIceCandidate,
    addLog,
    onDataChannelMessage: handleDataChannelMessage,
    onConnectionClosed: resetTransferStates,
    onBufferedAmountLow: handleBufferedAmountLow
  });

  // Instantiate File Transfer manager Hook
  const fileTransfer = useFileTransfer({
    channelRef,
    addLog,
    setErrorMsg,
    cleanupWebRTC
  });
  fileTransferRef.current = fileTransfer;

  const {
    fileQueue,
    currentFileIndex,
    transferringFile,
    pendingIncomingFile,
    transferProgress,
    transferSpeed,
    addFilesToQueue,
    handleCancelTransfer,
    sendNextFileInQueue,
    handleAcceptFile,
    handleDeclineFile
  } = fileTransfer;

  // UI Event Handlers
  const handleJoinSubmit = (e, codeToJoin) => {
    if (e && e.preventDefault) e.preventDefault();
    const targetCode = codeToJoin || roomCode;
    if (!/^\d{6}$/.test(targetCode)) {
      setErrorMsg('Please enter a valid 6-digit room code.');
      return;
    }
    setRoomCode(targetCode);
    setErrorMsg('');
    setStatus('joining');
    joinRoom(targetCode);
  };

  const handleLeaveRoom = () => {
    leaveRoom();
    window.location.reload();
  };

  const handleDragEvents = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDropEvent = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      addFilesToQueue(Array.from(e.dataTransfer.files));
    }
  }, [addFilesToQueue]);

  const handleFileSelectEvent = useCallback((e) => {
    if (e.target.files && e.target.files[0]) {
      addFilesToQueue(Array.from(e.target.files));
    }
  }, [addFilesToQueue]);

  return (
    <div className="connection-card">
      <div className="card-header">
        <h2>Connection Settings</h2>
        <p className="subtitle">Security & NAT Traversal</p>
      </div>

      {isLegacyMode && status === 'ready' && (
        <div className="error-alert warning-alert" style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)', color: 'var(--color-warning)' }}>
          <svg className="error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>Legacy mode active: Large files may cause memory limits.</span>
        </div>
      )}

      <RoomJoinForm 
        onSubmit={handleJoinSubmit}
        roomCode={roomCode}
        setRoomCode={setRoomCode}
        status={status}
        errorMsg={errorMsg}
      />

      <ConnectionStatus
        status={status}
        joinedRoom={joinedRoom}
        roomCode={roomCode}
        role={role}
        webrtcState={webrtcState}
        dataChannelStatus={dataChannelStatus}
        connectionType={connectionType}
      />

      {dataChannelStatus === 'open' && (
        <div className="p2p-transfer-panel">
          <h3>P2P File Transfer</h3>

          <IncomingRequestCard
            pendingIncomingFile={pendingIncomingFile}
            handleAcceptFile={handleAcceptFile}
            handleDeclineFile={handleDeclineFile}
          />

          <TransferProgressCard
            transferringFile={transferringFile}
            role={role}
            currentFileIndex={currentFileIndex}
            fileQueueLength={fileQueue.length}
            transferProgress={transferProgress}
            transferSpeed={transferSpeed}
            handleCancelTransfer={handleCancelTransfer}
          />

          {role === 'host' ? (
            <>
              <FileDropZone
                dragActive={dragActive}
                handleDrag={handleDragEvents}
                handleDrop={handleDropEvent}
                handleFileSelect={handleFileSelectEvent}
                transferringFile={transferringFile}
              />

              <FileQueueList
                fileQueue={fileQueue}
                transferringFile={transferringFile}
                sendNextFileInQueue={sendNextFileInQueue}
              />
            </>
          ) : (
            !transferringFile && !pendingIncomingFile && (
              <div className="receiver-waiting-card">
                <div className="receiver-waiting-pulse"></div>
                <p>Ready to receive files directly from peer...</p>
              </div>
            )
          )}
        </div>
      )}

      {(status === 'joined-waiting' || status === 'ready' || status === 'full') && (
        <button onClick={handleLeaveRoom} className="btn-secondary" style={{ marginTop: '1rem' }}>
          Leave Room
        </button>
      )}
    </div>
  );
}
