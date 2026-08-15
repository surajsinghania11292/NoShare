import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { getCorsOptions } from './config/cors.js';
import { registerSignalHandlers } from './sockets/signalHandler.js';

const app = express();
app.use(cors());

// Health check endpoint
app.get('/health', (req, res) => {
  res.send({ status: 'ok', service: 'NoShare Production Signaling' });
});

const httpServer = createServer(app);

// Strict CORS restriction for Production Readiness
const io = new Server(httpServer, {
  cors: getCorsOptions(),
});

// Register WebRTC signaling handlers
registerSignalHandlers(io);

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`Signaling server listening on port ${PORT}`);
});

