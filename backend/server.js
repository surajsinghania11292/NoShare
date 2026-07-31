const express = require('express');
const http = require('http');
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

app.get('/health', (req, res) => res.json({ status: 'ok' }));
server.listen(PORT, () => console.log('Signaling server running on port', PORT));
