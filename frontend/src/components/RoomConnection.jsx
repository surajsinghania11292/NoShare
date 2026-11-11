import React, { useState, useCallback, useRef } from 'react';
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
  const [roomCode, setRoomCode] = useState('');
  const [status, setStatus] = useState('disconnected'); // disconnected, joining, joined-waiting, ready, full
  const [role, setRole] = useState(null); // 'host' or 'guest' (used for SDP negotiation only)
  const [joinedRoom, setJoinedRoom] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [dragActive, setDragActive] = useState(false);

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

  const addLog = useCallback((message, type = 'info') => {
    console.log(`[${type.toUpperCase()}] ${message}`);
  }, []);

  // Socket proxies
  const sendIceCandidate = (candidate) => socketRef.current?.sendIceCandidate(candidate);
  const sendOffer = (offer) => socketRef.current?.sendOffer(offer);
  const sendAnswer = (answer) => socketRef.current?.sendAnswer(answer);
  const joinRoom = (code) => socketRef.current?.joinRoom(code);
  const leaveRoom = () => socketRef.current?.leaveRoom();

  const handleDataChannelMessage = (event) => fileTransferRef.current?.handleDataChannelMessage(event);
  const resetTransferStates = () => fileTransferRef.current?.resetTransferStates();
  const handleBufferedAmountLow = () => fileTransferRef.current?.handleBufferedAmountLow();

  // Socket event callbacks
  const handleConnect = useCallback(() => {
    addLog('Connected to signaling server', 'success');
    setErrorMsg('');
    if (joinedRoomRef.current) {
      addLog(`Reconnecting to room ${joinedRoomRef.current}...`, 'info');
      socketRef.current?.joinRoom({ roomCode: joinedRoomRef.current, role: roleRef.current });
    }
  }, [addLog]);

  const handleConnectError = useCallback((error, attempts) => {
    addLog(`Signaling attempt ${attempts} waiting: ${error.message}`, 'warning');
    if (attempts >= 5) {
      setErrorMsg('Signaling server is taking longer than expected. If Render is waking up, it will connect shortly.');
    }
  }, [addLog]);

  const handleRoomJoined = useCallback(({ role: assignedRole, roomCode: assignedRoom }) => {
    setRoleAndRef(assignedRole);
    setJoinedRoomAndRef(assignedRoom);
    setStatus(assignedRole === 'host' ? 'joined-waiting' : 'ready');
    setErrorMsg('');
    addLog(`Room ${assignedRoom} joined successfully as ${assignedRole.toUpperCase()}.`, 'success');
  }, [addLog]);

  const handleReady = useCallback(async () => {
    setStatus('ready');
    setErrorMsg('');
    addLog('Both peers are active in the room. Starting WebRTC handshake...', 'success');

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
    addLog('SDP Offer received from peer. Creating answer...', 'success');
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
    addLog('SDP Answer received from peer. Setting remote description...', 'success');
    const pc = pcRef.current;
    if (!pc) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      await processPendingCandidates();
    } catch (err) {
      addLog(`Error setting Remote Description: ${err.message}`, 'error');
    }
  }, [addLog]);

  const handleIceCandidate = useCallback(async (candidate) => {
    const pc = pcRef.current;
    if (pc && pc.remoteDescription) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        addLog(`Error adding remote ICE candidate: ${err.message}`, 'error');
      }
    } else {
      pendingCandidates.current.push(candidate);
    }
  }, []);

  const handleRoomFull = useCallback(({ roomCode: fullRoom }) => {
    setStatus('full');
    setErrorMsg(`Room ${fullRoom} is currently full (maximum 2 devices per room).`);
    addLog(`Join rejected: Room ${fullRoom} is full.`, 'error');
  }, [addLog]);

  const handleServerErrorMsg = useCallback((msg) => {
    setErrorMsg(msg);
    addLog(`Server notice: ${msg}`, 'error');
    setStatus((cur) => (cur === 'joining' ? 'disconnected' : cur));
  }, [addLog]);

  const handlePeerDisconnected = useCallback(() => {
    cleanupWebRTC();
    setStatus('joined-waiting');
    addLog('Peer left the room. Waiting for a new peer...', 'warning');
  }, [addLog]);

  const handleDisconnect = useCallback(() => {
    cleanupWebRTC();
    addLog('Signaling connection closed.', 'warning');
  }, [addLog]);

  const handleRoomClosed = useCallback(() => {
    cleanupWebRTC();
    setStatus('disconnected');
    setErrorMsg('The room was closed by the host.');
    addLog('Room closed.', 'warning');
  }, [addLog]);

  // Instantiate Socket Hook
  const {
    isConnected,
    isWakingUp,
    joinRoom: socketJoinRoom,
    sendOffer: socketSendOffer,
    sendAnswer: socketSendAnswer,
    sendIceCandidate: socketSendIceCandidate,
    sendRenegotiate,
    leaveRoom: socketLeaveRoom
  } = useSocket({
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
    onRoomClosed: handleRoomClosed,
    onRenegotiate: () => {
      if (roleRef.current === 'host') {
        handleReady();
      }
    }
  });

  socketRef.current = {
    joinRoom: socketJoinRoom,
    sendOffer: socketSendOffer,
    sendAnswer: socketSendAnswer,
    sendIceCandidate: socketSendIceCandidate,
    sendRenegotiate,
    leaveRoom: socketLeaveRoom
  };

  // Instantiate WebRTC Hook
  const {
    webrtcState,
    dataChannelStatus,
    connectionType,
    pcRef,
    channelRef,
    pendingCandidates,
    initPeerConnection,
    cleanupWebRTC,
    processPendingCandidates,
    restartIce
  } = useWebRTC({
    role,
    sendIceCandidate,
    addLog,
    onDataChannelMessage: handleDataChannelMessage,
    onConnectionClosed: resetTransferStates,
    onBufferedAmountLow: handleBufferedAmountLow
  });

  // Instantiate File Transfer Hook
  const fileTransfer = useFileTransfer({
    channelRef,
    addLog,
    setErrorMsg,
    cleanupWebRTC
  });
  fileTransferRef.current = fileTransfer;

  const {
    fileQueue,
    transferringFile,
    pendingIncomingFile,
    transferProgress,
    transferSpeed,
    transferEta,
    isPaused,
    addFilesToQueue,
    removeFileFromQueue,
    clearQueue,
    handlePauseTransfer,
    handleResumeTransfer,
    handleCancelTransfer,
    sendNextFileInQueue,
    handleAcceptFile,
    handleDeclineFile
  } = fileTransfer;

  // Form submit
  const handleJoinSubmit = (e, codeToJoin) => {
    if (e && e.preventDefault) e.preventDefault();
    const target = codeToJoin || roomCode;
    if (!/^\d{6}$/.test(target)) {
      setErrorMsg('Please enter a valid 6-digit room code.');
      return;
    }
    setRoomCode(target);
    setErrorMsg('');
    setStatus('joining');
    joinRoom(target);
  };

  const handleLeaveRoom = () => {
    leaveRoom();
    cleanupWebRTC();
    resetTransferStates();
    setStatus('disconnected');
    setRoleAndRef(null);
    setJoinedRoomAndRef('');
    setRoomCode('');
    window.location.hash = '';
  };

  // Drag and drop handlers
  const handleDragEvents = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDropEvent = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        addFilesToQueue(Array.from(e.dataTransfer.files));
      }
    },
    [addFilesToQueue]
  );

  const handleFileSelectEvent = useCallback(
    (e) => {
      if (e.target.files && e.target.files.length > 0) {
        addFilesToQueue(Array.from(e.target.files));
      }
    },
    [addFilesToQueue]
  );

  return (
    <div className="connection-card">
      <div className="card-header">
        <h2>P2P Transfer Room</h2>
        <p className="subtitle">Zero-Storage • End-to-End Encrypted • Resumable</p>
      </div>

      <RoomJoinForm
        onSubmit={handleJoinSubmit}
        roomCode={roomCode}
        setRoomCode={setRoomCode}
        status={status}
        errorMsg={errorMsg}
        isWakingUp={isWakingUp && !isConnected}
        onClearError={() => setErrorMsg('')}
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
        <div className="p2p-transfer-panel" style={{ marginTop: '1.25rem' }}>
          {/* Incoming transfer prompt (Accept / Resume / Decline) */}
          <IncomingRequestCard
            pendingIncomingFile={pendingIncomingFile}
            handleAcceptFile={handleAcceptFile}
            handleDeclineFile={handleDeclineFile}
          />

          {/* Active progress status (both for sending & receiving) */}
          <TransferProgressCard
            transferringFile={transferringFile}
            transferProgress={transferProgress}
            transferSpeed={transferSpeed}
            transferEta={transferEta}
            isPaused={isPaused}
            handlePauseTransfer={handlePauseTransfer}
            handleResumeTransfer={handleResumeTransfer}
            handleCancelTransfer={handleCancelTransfer}
          />

          {/* Symmetric P2P Drop Zone: Active for BOTH peers */}
          <FileDropZone
            dragActive={dragActive}
            handleDrag={handleDragEvents}
            handleDrop={handleDropEvent}
            handleFileSelect={handleFileSelectEvent}
            transferringFile={transferringFile}
          />

          {/* Selected files ready to be sent */}
          <FileQueueList
            fileQueue={fileQueue}
            transferringFile={transferringFile}
            sendNextFileInQueue={sendNextFileInQueue}
            removeFileFromQueue={removeFileFromQueue}
            clearQueue={clearQueue}
          />
        </div>
      )}

      {(status === 'joined-waiting' || status === 'ready' || status === 'full') && (
        <button
          type="button"
          onClick={handleLeaveRoom}
          className="btn-secondary"
          style={{ marginTop: '1.5rem', width: '100%' }}
        >
          Leave Room
        </button>
      )}
    </div>
  );
}
