import { useState, useRef, useEffect } from 'react';

const PC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp'
      ],
      username: 'openrelay',
      credential: 'openrelay'
    }
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require'
};

const BUFFER_LOW_THRESHOLD = 256 * 1024; // 256KB safe low water-mark for reliable backpressure pacing

export default function useWebRTC({
  role,
  sendIceCandidate,
  addLog,
  onDataChannelMessage,
  onConnectionClosed,
  onBufferedAmountLow
}) {
  const [webrtcState, setWebrtcState] = useState('new');
  const [dataChannelStatus, setDataChannelStatus] = useState('closed');
  const [connectionType, setConnectionType] = useState('Determining...');

  const pcRef = useRef(null);
  const channelRef = useRef(null);
  const pendingCandidates = useRef([]);
  const statsIntervalRef = useRef(null);

  const cleanupWebRTC = () => {
    addLog('Cleaning up WebRTC connections...', 'info');
    
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }
    setConnectionType('Determining...');

    if (channelRef.current) {
      try {
        channelRef.current.close();
      } catch (e) {}
      channelRef.current = null;
    }
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch (e) {}
      pcRef.current = null;
    }
    setDataChannelStatus('closed');
    setWebrtcState('new');
    pendingCandidates.current = [];
    
    onConnectionClosed?.();
  };

  const processPendingCandidates = async () => {
    if (!pcRef.current) return;
    addLog(`Processing ${pendingCandidates.current.length} queued ICE candidates.`, 'info');
    for (const cand of pendingCandidates.current) {
      try {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(cand));
      } catch (err) {
        addLog(`Error adding queued ICE Candidate: ${err.message}`, 'error');
      }
    }
    pendingCandidates.current = [];
  };

  const startConnectionTypePoll = (pc) => {
    if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
    
    statsIntervalRef.current = setInterval(async () => {
      if (!pc || pc.connectionState !== 'connected') return;

      try {
        const stats = await pc.getStats();
        let activeCandidatePairId = null;

        stats.forEach((report) => {
          if (report.type === 'transport') {
            activeCandidatePairId = report.selectedCandidatePairId;
          }
        });

        if (!activeCandidatePairId) {
          stats.forEach((report) => {
            if (report.type === 'candidate-pair' && (report.state === 'succeeded' || report.nominated)) {
              activeCandidatePairId = report.id;
            }
          });
        }

        if (activeCandidatePairId) {
          const pairReport = stats.get(activeCandidatePairId);
          if (pairReport) {
            const remoteCandidateReport = stats.get(pairReport.remoteCandidateId);
            const localCandidateReport = stats.get(pairReport.localCandidateId);

            const isRelay = (localCandidateReport && localCandidateReport.candidateType === 'relay') ||
                            (remoteCandidateReport && remoteCandidateReport.candidateType === 'relay');

            setConnectionType(isRelay ? 'Relayed (TURN)' : 'Direct (STUN)');
          }
        }
      } catch (e) {
        console.warn('Failed to retrieve ICE stats:', e);
      }
    }, 3000);
  };

  const setupDataChannel = (channel) => {
    channelRef.current = channel;
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD;

    channel.onopen = () => {
      setDataChannelStatus('open');
      addLog('RTCDataChannel is OPEN and ready for transfer!', 'success');
    };

    channel.onclose = () => {
      setDataChannelStatus('closed');
      addLog('RTCDataChannel has been closed.', 'warning');
      cleanupWebRTC();
    };

    channel.onerror = (error) => {
      addLog(`RTCDataChannel error: ${error.message || 'unknown error'}`, 'error');
    };

    channel.onbufferedamountlow = () => {
      onBufferedAmountLow?.();
    };

    channel.onmessage = (event) => {
      onDataChannelMessage?.(event);
    };
  };

  const initPeerConnection = (currentRole) => {
    addLog('Initializing new RTCPeerConnection...', 'info');
    const pc = new RTCPeerConnection(PC_CONFIG);
    pcRef.current = pc;

    const iceGatheringTimeout = setTimeout(() => {
      if (pc.iceGatheringState !== 'complete') {
        addLog('ICE candidate gathering timeout reached. Handshake continuing.', 'warning');
      }
    }, 8000);

    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(iceGatheringTimeout);
        addLog('ICE candidate gathering complete.', 'success');
      }
    };

    pc.onicecandidateerror = (event) => {
      if (event.errorCode === 701) {
        addLog(`TURN server unreachable (Error 701: ${event.errorText})`, 'warning');
      }
    };

    pc.oniceconnectionstatechange = () => {
      addLog(`ICE Connection State: ${pc.iceConnectionState}`, 'info');
      if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
        addLog('ICE Connection dropped. Aborting transfer...', 'error');
        cleanupWebRTC();
      }
    };

    pc.onconnectionstatechange = () => {
      setWebrtcState(pc.connectionState);
      addLog(`WebRTC Connection State: ${pc.connectionState}`, 'info');
      if (pc.connectionState === 'connected') {
        startConnectionTypePoll(pc);
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        addLog('Connection disconnected. Aborting transfer...', 'error');
        cleanupWebRTC();
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendIceCandidate(event.candidate);
      }
    };

    if (currentRole === 'host') {
      const channel = pc.createDataChannel('noshare-channel', { ordered: true });
      setupDataChannel(channel);
    } else {
      pc.ondatachannel = (event) => {
        addLog('Inbound RTCDataChannel established with peer.', 'success');
        setupDataChannel(event.channel);
      };
    }

    return pc;
  };

  const restartIce = async () => {
    if (!pcRef.current) return;
    try {
      addLog('Initiating ICE restart to recover connection...', 'warning');
      const offer = await pcRef.current.createOffer({ iceRestart: true });
      await pcRef.current.setLocalDescription(offer);
      return offer;
    } catch (err) {
      addLog(`ICE restart failed: ${err.message}`, 'error');
    }
  };

  useEffect(() => {
    return () => {
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
    };
  }, []);

  return {
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
  };
}
