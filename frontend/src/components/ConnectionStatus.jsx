import React from 'react';

export default function ConnectionStatus({
  status,
  joinedRoom,
  roomCode,
  role,
  webrtcState,
  dataChannelStatus,
  connectionType
}) {
  if (status === 'disconnected' || status === 'joining') return null;

  return (
    <div className="active-connection">
      <div className="room-info">
        <div className="info-grid">
          <div className="info-item">
            <span className="label">Room:</span>
            <span className="value room-badge">{joinedRoom || roomCode}</span>
          </div>
          <div className="info-item">
            <span className="label">Role:</span>
            <span className={`value role-badge ${role === 'host' ? 'host' : 'guest'}`}>
              {role === 'host' ? 'SENDER (Host)' : 'RECEIVER (Guest)'}
            </span>
          </div>
          <div className="info-item">
            <span className="label">P2P Conn:</span>
            <span className={`status-dot webrtc-${webrtcState}`}></span>
            <span className="value capitalize font-bold">{webrtcState}</span>
          </div>
          <div className="info-item">
            <span className="label">Channel:</span>
            <span className={`status-dot channel-${dataChannelStatus}`}></span>
            <span className="value capitalize font-bold">{dataChannelStatus}</span>
          </div>
          {webrtcState === 'connected' && (
            <div className="info-item connection-type-item">
              <span className="label connection-type-label">Connection Type:</span>
              <span className="value font-bold connection-type-value">{connectionType}</span>
            </div>
          )}
        </div>
      </div>

      {status === 'joined-waiting' && (
        <div className="waiting-container">
          <div className="pulse-loader"></div>
          <p>Waiting for a peer to join...</p>
        </div>
      )}
    </div>
  );
}
