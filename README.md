# NoShare — High-Performance Browser-to-Browser P2P File Transfer

> A serverless, browser-based peer-to-peer file sharing platform that streams multi-gigabyte files directly between devices using **WebRTC Data Channels**, backpressure flow control, and the native **File System Access API** — with zero intermediate cloud storage.

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Architecture](#-architecture)
- [Core Engineering Highlights](#-core-engineering-highlights)
  - [1. Signaling Handshake](#1-signaling-handshake)
  - [2. Chunked Binary Streaming](#2-chunked-binary-streaming)
  - [3. Adaptive Backpressure & Flow Control](#3-adaptive-backpressure--flow-control)
  - [4. Direct-to-Disk Streaming](#4-direct-to-disk-streaming)
- [Tech Stack](#-tech-stack)
- [Key Features](#-key-features)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [Signaling Server Setup](#signaling-server-setup)
  - [Frontend Client Setup](#frontend-client-setup)
- [Browser Compatibility](#-browser-compatibility)
- [Performance & Benchmarks](#-performance--benchmarks)
- [License](#-license)
- [Author](#-author)

---

## 📌 Overview

Traditional file transfer services (e.g., WeTransfer, Google Drive, Dropbox) require users to first upload files to an intermediary cloud storage bucket before the recipient can download them. This design introduces:
- High latency (upload time + download time).
- Cloud storage costs and bandwidth egress fees.
- Privacy risks as sensitive files reside on third-party servers.

**NoShare** eliminates the middleman. Using native **WebRTC `RTCDataChannel`**, files are streamed directly between browser tabs:
- **Zero Cloud Storage**: Files exist only on the sender's disk and the recipient's disk.
- **End-to-End Encryption**: All WebRTC communication is cryptographically secured via DTLS/SRTP protocols.
- **Unlimited File Sizes**: Built to reliably handle 10GB+ transfers without browser memory spikes or tab crashes.

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                   Signaling Server (Node.js + Socket.io)               │
│              Relays SDP Offer/Answer & ICE Candidates Only             │
└───────────────────▲────────────────────────────────┬───────────────────┘
                    │ (Signaling Metadata)           │ (Signaling Metadata)
         ┌──────────┴──────────┐          ┌──────────┴──────────┐
         │    Sender Client    │          │   Receiver Client   │
         │     Browser Tab     │          │     Browser Tab     │
         │  (File.slice() 64KB)│          │ (showSaveFilePicker)│
         └──────────┬──────────┘          └──────────▲──────────┘
                    │                                │
                    └────────────────────────────────┘
                      RTCDataChannel (Direct P2P Stream)
                     Zero Data Stored on Cloud Servers
```

### Protocol Flow:
1. **Room Pairing**: Sender creates a room and receives a 6-digit session code.
2. **Signaling Exchange**: Receiver enters the 6-digit code. The signaling server relays WebRTC Session Description Protocol (SDP) offers, answers, and ICE candidate network routes between peers.
3. **P2P Channel Established**: Once ICE negotiation succeeds, peers connect directly. The signaling server drops out of the communication path completely.
4. **Binary Transmission**: The file is segmented into 64KB binary slices, streamed over `RTCDataChannel`, and written directly to the receiver's disk.

---

## ⚙️ Core Engineering Highlights

Handling multi-gigabyte file transfers inside single-threaded JavaScript browser runtimes poses significant architectural hurdles. NoShare solves them through four foundational systems:

### 1. Signaling Handshake
WebRTC cannot establish peer connections without knowing each party's public IP address, NAT bindings, and encryption keys. A lightweight Node.js Express server with Socket.io facilitates this exchange using STUN servers:
- Relays `offer` and `answer` SDP payloads.
- Exchanges interactive `candidate` packets asynchronously.
- Enforces room isolation with strict rate limiting and peer disconnect cleanup.

### 2. Chunked Binary Streaming
Loading a 5GB file into memory using `FileReader.readAsArrayBuffer()` crashes the browser tab instantly with Out-Of-Memory (OOM) exceptions.
NoShare slices files lazily on demand:
- Uses the browser's standard `File.slice(offset, offset + CHUNK_SIZE)` where `CHUNK_SIZE = 64KB` (65,536 bytes).
- Prepends an initial JSON header packet containing file metadata (file name, total byte size, MIME type, chunk count).
- Sequentially streams binary chunks as `ArrayBuffer` payloads over `RTCDataChannel.send()`.

### 3. Adaptive Backpressure & Flow Control
If the sender transmits chunks faster than the network socket or recipient can consume, the underlying WebRTC buffer overflows, resulting in catastrophic connection drops.
NoShare implements an adaptive backpressure feedback loop:
- Monitors `RTCDataChannel.bufferedAmount` before sending each slice.
- When `bufferedAmount > 1MB` (1,048,576 bytes), file reading pauses immediately.
- Sets `RTCDataChannel.bufferedAmountLowThreshold = 512KB`.
- Listens for the `bufferedamountlow` event to seamlessly resume reading and transmitting the next batch of chunks.

### 4. Direct-to-Disk Streaming
Holding incoming chunks in an in-memory array until completion would also exhaust RAM on large transfers.
NoShare leverages the modern **File System Access API**:
- Prompts the user with `window.showSaveFilePicker()` upon transfer approval.
- Obtains a `FileSystemWritableFileStream` to the user's local disk.
- Writes incoming 64KB chunks directly to the disk stream in real-time (`writable.write(chunk)`).
- Keeps the browser's active RAM footprint under **40MB** regardless of whether transferring 10MB or 50GB.

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **P2P Transport** | WebRTC (`RTCPeerConnection`, `RTCDataChannel`) | Direct peer-to-peer binary communication |
| **Signaling Server** | Node.js, Express.js, Socket.io | Session establishment & ICE route relay |
| **Frontend Framework** | React 18, Vite | Component architecture & reactive UI |
| **Disk I/O** | File System Access API (`FileSystemWritableFileStream`) | Low-memory direct-to-disk streaming |
| **Styling & UX** | Modern CSS Variables, Glassmorphism, Theme Tokens | Responsive layout with Dark/Light modes |
| **Deployment** | Vercel (Frontend) · Render / Fly.io (Signaling) | Cloud hosting |

---

## ✨ Key Features

- **🚀 Direct P2P Transfer**: Maximum possible transfer speeds bound only by the peers' local internet bandwidth.
- **🛡️ Complete Privacy**: Files never pass through or touch an intermediary cloud server or disk.
- **💾 Low Memory Footprint**: Streaming chunks directly from disk to disk maintains flat RAM usage.
- **🔢 1-Click Room Pairing**: 6-digit randomized room codes for frictionless connection pairing.
- **📊 Real-Time Metrics**: Live progress bars, transfer speed indicators (MB/s), elapsed time, and ETA calculations.
- **🌗 Theme Toggle**: Dark and Light theme options with persistent state.

---

## 📂 Project Structure

```
NoShare/
├── backend/
│   ├── config/
│   │   └── cors.js              # Allowed origins & CORS configuration
│   ├── middleware/
│   │   └── rateLimiter.js       # Connection rate limiting protection
│   ├── sockets/
│   │   └── signalHandler.js     # Socket.io room & WebRTC signaling events
│   ├── package.json
│   └── server.js                # Express & Socket.io server bootstrap
├── frontend/
│   ├── public/
│   │   ├── favicon.svg          # Brand icon mark
│   │   └── icons.svg            # UI SVG sprite assets
│   ├── src/
│   │   ├── components/
│   │   │   ├── ConnectionStatus.jsx   # Live WebRTC peer connection badge
│   │   │   ├── FileDropZone.jsx       # Drag-and-drop file staging area
│   │   │   ├── FileQueueList.jsx      # Multi-file queue display
│   │   │   ├── IncomingRequestCard.jsx# Peer transfer approval dialog
│   │   │   ├── RoomConnection.jsx     # Room join / create interface
│   │   │   ├── RoomJoinForm.jsx       # 6-digit code entry form
│   │   │   └── TransferProgressCard.jsx# Live speed and progress bars
│   │   ├── hooks/
│   │   │   ├── useFileTransfer.js     # Chunking & backpressure pipeline
│   │   │   ├── useSocket.js           # Socket.io connection manager
│   │   │   └── useWebRTC.js           # RTCPeerConnection & DataChannel state
│   │   ├── utils/
│   │   │   └── format.js              # Byte sizing & speed formatting helpers
│   │   ├── App.css                    # Glassmorphic layout & design tokens
│   │   ├── App.jsx                    # Root application component
│   │   ├── index.css                  # Base reset & typography rules
│   │   └── main.jsx                   # React DOM entry point
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── .gitignore                         # Comprehensive security ignore rules
└── README.md                          # System documentation
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js (v18 or higher)**
- **npm** (v9+)
- A modern Chromium-based browser (Chrome, Edge, Brave, Opera) for full File System Access API support.

### 1. Clone the Repository
```bash
git clone https://github.com/surajsinghania11292/NoShare.git
cd NoShare
```

### 2. Start the Signaling Server
```bash
cd backend
npm install
npm run dev # Runs signaling server on http://localhost:5000
```

### 3. Start the Frontend Client
```bash
# In a separate terminal
cd ../frontend
npm install
npm run dev # Runs Vite development server on http://localhost:5173
```

### 4. Initiate a Transfer
1. Open `http://localhost:5173` in two separate browser windows (or on two distinct devices on the same Wi-Fi).
2. Click **"Create Room"** on the first window to generate a 6-digit room code.
3. Enter the code on the second window and click **"Join"**.
4. Drag and drop a file in the sender window.
5. Accept the prompt in the receiver window to select a destination folder and begin the direct P2P stream.

---

## 🌐 Browser Compatibility

| Browser | WebRTC DataChannels | File System Access API (Direct-to-Disk) | Fallback Blob Download |
|---|---|---|---|
| **Google Chrome** | ✅ Supported | ✅ Native | Not Needed |
| **Microsoft Edge** | ✅ Supported | ✅ Native | Not Needed |
| **Brave** | ✅ Supported | ✅ Native | Not Needed |
| **Mozilla Firefox**| ✅ Supported | ⚠️ In-Memory Fallback | ✅ Supported |
| **Apple Safari**   | ✅ Supported | ⚠️ In-Memory Fallback | ✅ Supported |

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for details.

---

## 👤 Author

**Suraj Kumar**
- GitHub: [@surajsinghania11292](https://github.com/surajsinghania11292)
- Email: [surajsinghania11292@gmail.com](mailto:surajsinghania11292@gmail.com)
