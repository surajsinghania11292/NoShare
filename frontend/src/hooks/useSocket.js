import { useEffect, useRef } from 'react';
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
  onRoomClosed
}) {
  const socketRef = useRef(null);

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
    onRoomClosed
  };

  useEffect(() => {
    socketRef.current = io(BACKEND_URL, {
      autoConnect: true,
      reconnectionAttempts: Infinity,
    });

    const socket = socketRef.current;

    socket.on('connect', () => callbacks.current.onConnect?.());
    socket.on('connect_error', (error) => callbacks.current.onConnectError?.(error));
    socket.on('room-joined', (data) => callbacks.current.onRoomJoined?.(data));
    socket.on('ready', () => callbacks.current.onReady?.());
    socket.on('offer', (data) => callbacks.current.onOffer?.(data));
    socket.on('answer', (data) => callbacks.current.onAnswer?.(data));
    socket.on('ice-candidate', (data) => callbacks.current.onIceCandidate?.(data));
    socket.on('room-full', (data) => callbacks.current.onRoomFull?.(data));
    socket.on('error-msg', (msg) => callbacks.current.onErrorMsg?.(msg));
    socket.on('peer-disconnected', () => callbacks.current.onPeerDisconnected?.());
    socket.on('disconnect', () => callbacks.current.onDisconnect?.());
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

  const leaveRoom = () => {
    socketRef.current?.emit('leave-room');
  };

  return {
    joinRoom,
    sendOffer,
    sendAnswer,
    sendIceCandidate,
    leaveRoom
  };
}

