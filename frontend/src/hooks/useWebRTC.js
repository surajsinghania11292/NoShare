import { useState, useRef, useEffect } from 'react';
import { getDeviceProfile } from '../utils/deviceProfile';

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
  const [activeChannelCount, setActiveChannelCount] = useState(0);

  const pcRef = useRef(null);
  const channelRef = useRef(null); // primary control channel
  const channelsRef = useRef([]); // striped channel pool
  const pendingCandidates = useRef([]);
  const statsIntervalRef = useRef(null);

  const deviceProfile = getDeviceProfile();

  const cleanupWebRTC = () => {
    addLog('Cleaning up WebRTC connections...', 'info');

    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }
    setConnectionType('Determining...');

    channelsRef.current.forEach((ch) => {
      try {
        ch.close();
      } catch {}
    });
    channelsRef.current = [];
    channelRef.current = null;
    setActiveChannelCount(0);

    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {}
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

            const isRelay =
              (localCandidateReport && localCandidateReport.candidateType === 'relay') ||
              (remoteCandidateReport && remoteCandidateReport.candidateType === 'relay');

            setConnectionType(isRelay ? 'Relayed (Encrypted Relay)' : 'Direct P2P (High-Speed)');
          }
        }
      } catch (e) {
        console.warn('Failed to retrieve ICE stats:', e);
      }
    }, 3000);
  };

  const setupDataChannel = (channel) => {
    if (!channelsRef.current.includes(channel)) {
      channelsRef.current.push(channel);
    }
    if (!channelRef.current || channel.label === 'noshare-ch-0') {
      channelRef.current = channel;
    }

    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = deviceProfile.lowBufferThreshold;

    channel.onopen = () => {
      const openCount = channelsRef.current.filter((c) => c.readyState === 'open').length;
      setActiveChannelCount(openCount);
      setDataChannelStatus('open');
      addLog(
        `RTCDataChannel [${channel.label}] OPEN (${openCount} channel${openCount > 1 ? 's striped' : ''}).`,
        'success'
      );
    };

    channel.onclose = () => {
      channelsRef.current = channelsRef.current.filter((c) => c !== channel);
      const openCount = channelsRef.current.filter((c) => c.readyState === 'open').length;
      setActiveChannelCount(openCount);
      if (openCount === 0) {
        setDataChannelStatus('closed');
        channelRef.current = null;
        cleanupWebRTC();
      }
    };

    channel.onerror = (error) => {
      addLog(`RTCDataChannel [${channel.label}] error: ${error.message || 'unknown error'}`, 'error');
    };

    channel.onbufferedamountlow = () => {
      onBufferedAmountLow?.(channel);
    };

    channel.onmessage = (event) => {
      onDataChannelMessage?.(event, channel);
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
        addLog('ICE Connection dropped. Attempting recovery...', 'error');
        cleanupWebRTC();
      }
    };

    pc.onconnectionstatechange = () => {
      setWebrtcState(pc.connectionState);
      addLog(`WebRTC Connection State: ${pc.connectionState}`, 'info');
      if (pc.connectionState === 'connected') {
        startConnectionTypePoll(pc);
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        addLog('Connection disconnected.', 'error');
        cleanupWebRTC();
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendIceCandidate(event.candidate);
      }
    };

    if (currentRole === 'host') {
      const count = deviceProfile.channelCount;
      addLog(
        `Configuring ${count} DataChannel(s) [Mode: ${
          deviceProfile.isLowEnd ? 'Mobile Fail-Safe' : 'High-Throughput Striped'
        }]...`,
        'info'
      );
      for (let i = 0; i < count; i++) {
        const channel = pc.createDataChannel(`noshare-ch-${i}`, { ordered: true });
        setupDataChannel(channel);
      }
    } else {
      pc.ondatachannel = (event) => {
        addLog(`Inbound DataChannel [${event.channel.label}] received from peer.`, 'success');
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
    activeChannelCount,
    pcRef,
    channelRef,
    channelsRef,
    pendingCandidates,
    initPeerConnection,
    cleanupWebRTC,
    processPendingCandidates,
    restartIce
  };
}
