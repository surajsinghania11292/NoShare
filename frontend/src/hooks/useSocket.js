import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

export default function useSocket({
  onConnect,
  onConnectError,
  onRoomJoined,
  onReady,
  onOffer,
  onAnswer,
  onIceCandidate,
  onRoomFull,
  onErrorMsg,
  onPeerDisconnected,
  onDisconnect,
  onRoomClosed,
  onRenegotiate
}) {
  const socketRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isWakingUp, setIsWakingUp] = useState(true);
  const connectAttempts = useRef(0);

  // Store callbacks in refs to prevent useEffect re-triggering
  const callbacks = useRef({});
  callbacks.current = {
    onConnect,
    onConnectError,
    onRoomJoined,
    onReady,
    onOffer,
    onAnswer,
    onIceCandidate,
    onRoomFull,
    onErrorMsg,
    onPeerDisconnected,
    onDisconnect,
    onRoomClosed,
    onRenegotiate
  };

  useEffect(() => {
    socketRef.current = io(BACKEND_URL, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      transports: ['websocket', 'polling']
    });

    const socket = socketRef.current;

    socket.on('connect', () => {
      setIsConnected(true);
      setIsWakingUp(false);
      connectAttempts.current = 0;
      callbacks.current.onConnect?.();
    });

    socket.on('connect_error', (error) => {
      connectAttempts.current += 1;
      setIsConnected(false);
      // After 2 failed attempts, indicate Render server might be waking up
      if (connectAttempts.current >= 2) {
        setIsWakingUp(true);
      }
      callbacks.current.onConnectError?.(error, connectAttempts.current);
    });

    socket.on('room-joined', (data) => callbacks.current.onRoomJoined?.(data));
    socket.on('ready', () => callbacks.current.onReady?.());
    socket.on('offer', (data) => callbacks.current.onOffer?.(data));
    socket.on('answer', (data) => callbacks.current.onAnswer?.(data));
    socket.on('ice-candidate', (data) => callbacks.current.onIceCandidate?.(data));
    socket.on('renegotiate', () => callbacks.current.onRenegotiate?.());
    socket.on('room-full', (data) => callbacks.current.onRoomFull?.(data));
    socket.on('error-msg', (msg) => callbacks.current.onErrorMsg?.(msg));
    socket.on('peer-disconnected', () => callbacks.current.onPeerDisconnected?.());
    socket.on('disconnect', (reason) => {
      setIsConnected(false);
      callbacks.current.onDisconnect?.(reason);
    });
    socket.on('room-closed', () => callbacks.current.onRoomClosed?.());

    return () => {
      socket.disconnect();
    };
  }, []);

  const joinRoom = (roomData) => {
    socketRef.current?.emit('join-room', roomData);
  };

  const sendOffer = (offer) => {
    socketRef.current?.emit('offer', offer);
  };

  const sendAnswer = (answer) => {
    socketRef.current?.emit('answer', answer);
  };

  const sendIceCandidate = (candidate) => {
    socketRef.current?.emit('ice-candidate', candidate);
  };

  const sendRenegotiate = () => {
    socketRef.current?.emit('renegotiate');
  };

  const leaveRoom = () => {
    socketRef.current?.emit('leave-room');
  };

  return {
    isConnected,
    isWakingUp,
    joinRoom,
    sendOffer,
    sendAnswer,
    sendIceCandidate,
    sendRenegotiate,
    leaveRoom
  };
}
