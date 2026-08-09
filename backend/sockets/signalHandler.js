import { checkJoinRateLimit } from '../middleware/rateLimiter.js';

const activeRooms = new Map(); // roomCode -> { hostId, guestId, cleanupTimeout }

export const registerSignalHandlers = (io) => {
  const closeRoomEntirely = (roomCode) => {
    const roomState = activeRooms.get(roomCode);
    if (roomState) {
      if (roomState.cleanupTimeout) {
        clearTimeout(roomState.cleanupTimeout);
      }
      io.to(roomCode).emit('room-closed');
      activeRooms.delete(roomCode);
      console.log(`[ROOM] Room ${roomCode} has been closed and cleaned up.`);
    }
  };

  io.on('connection', (socket) => {
    // Join Room handler (handles creation, new join, and re-connection)
    socket.on('join-room', (data) => {
      let roomCode, role;
      if (data && typeof data === 'object') {
        roomCode = data.roomCode;
        role = data.role;
      } else {
        roomCode = data;
      }

      const clientIp = socket.handshake.address || socket.conn.remoteAddress || 'unknown-ip';
      
      if (!checkJoinRateLimit(clientIp)) {
        console.error(`Rate limit exceeded for join-room attempts from IP: ${clientIp}`);
        socket.emit('error-msg', 'Too many room connection attempts. Please wait one minute.');
        return;
      }

      // Validate 6-digit room code
      if (!/^\d{6}$/.test(roomCode)) {
        socket.emit('error-msg', 'Room code must be a 6-digit number.');
        return;
      }

      socket.roomCode = roomCode;
      let roomState = activeRooms.get(roomCode);

      if (!roomState) {
        // Create new room if it doesn't exist
        socket.join(roomCode);
        socket.isHost = true;
        
        activeRooms.set(roomCode, {
          hostId: socket.id,
          guestId: null,
          cleanupTimeout: null
        });
        
        socket.emit('room-joined', { role: 'host', roomCode });
        console.log(`[ROOM] Room ${roomCode} created by host ${socket.id}`);
      } else {
        // Room exists! Reconnection or Guest Join
        if (role === 'host') {
          // Host rejoining
          socket.join(roomCode);
          socket.isHost = true;
          roomState.hostId = socket.id;
          
          if (roomState.cleanupTimeout) {
            clearTimeout(roomState.cleanupTimeout);
            roomState.cleanupTimeout = null;
            console.log(`[ROOM] Host reconnected to room ${roomCode}. Cleanup timer cancelled.`);
          }
          
          socket.emit('room-joined', { role: 'host', roomCode });
          
          // Re-trigger ready if the guest is still present to re-establish WebRTC
          if (roomState.guestId) {
            io.to(roomCode).emit('ready');
          }
        } else if (role === 'guest' || (!roomState.guestId && !role)) {
          // Guest joining or rejoining
          socket.join(roomCode);
          socket.isHost = false;
          roomState.guestId = socket.id;
          
          socket.emit('room-joined', { role: 'guest', roomCode });
          io.to(roomCode).emit('ready');
          console.log(`[ROOM] Guest ${socket.id} joined room ${roomCode}`);
        } else {
          // Room is full
          socket.emit('room-full', { roomCode });
        }
      }
    });

    // WebRTC Signaling Pass-through: Offer
    socket.on('offer', (data) => {
      const roomCode = socket.roomCode;
      if (roomCode) {
        socket.to(roomCode).emit('offer', data);
      }
    });

    // WebRTC Signaling Pass-through: Answer
    socket.on('answer', (data) => {
      const roomCode = socket.roomCode;
      if (roomCode) {
        socket.to(roomCode).emit('answer', data);
      }
    });

    // WebRTC Signaling Pass-through: ICE Candidates
    socket.on('ice-candidate', (data) => {
      const roomCode = socket.roomCode;
      if (roomCode) {
        socket.to(roomCode).emit('ice-candidate', data);
      }
    });

    // Explicit leave handler (e.g. Tab close or click leave room button)
    socket.on('leave-room', () => {
      const roomCode = socket.roomCode;
      if (roomCode) {
        const roomState = activeRooms.get(roomCode);
        if (roomState) {
          if (socket.isHost || roomState.hostId === socket.id) {
            console.log(`[ROOM] Host explicitly left room ${roomCode}. Closing room.`);
            closeRoomEntirely(roomCode);
          } else if (roomState.guestId === socket.id) {
            console.log(`[ROOM] Guest explicitly left room ${roomCode}.`);
            roomState.guestId = null;
            socket.to(roomCode).emit('peer-disconnected');
            socket.leave(roomCode);
          }
        }
      }
    });

    // Disconnection handler (silent disconnect like network drop or lock screen)
    socket.on('disconnect', () => {
      const roomCode = socket.roomCode;
      if (roomCode) {
        const roomState = activeRooms.get(roomCode);
        if (roomState) {
          if (socket.isHost || roomState.hostId === socket.id) {
            roomState.hostId = null;
            console.log(`[ROOM] Host disconnected silently from room ${roomCode}. Starting 1-hour cleanup timer.`);
            
            if (roomState.cleanupTimeout) {
              clearTimeout(roomState.cleanupTimeout);
            }
            roomState.cleanupTimeout = setTimeout(() => {
              console.log(`[ROOM] 1-hour inactivity reached for room ${roomCode}. Closing room.`);
              closeRoomEntirely(roomCode);
            }, 60 * 60 * 1000); // 1 hour
          } else if (roomState.guestId === socket.id) {
            roomState.guestId = null;
            console.log(`[ROOM] Guest disconnected silently from room ${roomCode}.`);
            socket.to(roomCode).emit('peer-disconnected');
          }
        }
      }
    });
  });
};
