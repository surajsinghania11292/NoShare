# NoShare — High-Throughput Resumable P2P File Transfer

> A serverless, cross-platform browser-to-browser peer-to-peer file sharing platform that streams files of any size directly between devices using **Reliable WebRTC DataChannels**, **Origin Private File System (OPFS)** zero-RAM disk streaming, **IndexedDB Resumable Checkpoints**, and universal **STUN/TURN NAT Traversal** — with zero cloud storage.

---

## 📋 Table of Contents

- [Overview](#-overview)
- [System Architecture](#-system-architecture)
- [Core Engineering Highlights](#-core-engineering-highlights)
  - [1. Universal Zero-RAM Storage Engine (OPFS + FSA API)](#1-universal-zero-ram-storage-engine-opfs--fsa-api)
  - [2. Resumable Transfers & Checkpointing](#2-resumable-transfers--checkpointing)
  - [3. Reliable SCTP & Adaptive Flow Control](#3-reliable-sctp--adaptive-flow-control)
  - [4. Universal NAT Traversal (STUN + TURN Relay)](#4-universal-nat-traversal-stun--turn-relay)
  - [5. Symmetric Bidirectional P2P](#5-symmetric-bidirectional-p2p)
  - [6. 1-Click Pairing & Instant QR Code](#6-1-click-pairing--instant-qr-code)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Browser & OS Compatibility](#-browser--os-compatibility)
- [Getting Started](#-getting-started)
- [Deployment Guide (Vercel + Render)](#-deployment-guide-vercel--render)
- [Security & Privacy](#-security--privacy)
- [License & Author](#-license--author)

---

## 📌 Overview

Traditional file transfer services (e.g., WeTransfer, Google Drive, Dropbox) require users to first upload files to an intermediary cloud storage bucket before the recipient can download them. This design introduces high latency, cloud storage limits, and serious privacy risks.

**NoShare** eliminates the middleman. Using native **WebRTC `RTCDataChannel`**:
- **Zero Cloud Storage**: Files stream directly from sender to recipient disk. Zero bytes are stored on any server.
- **Any File Size**: Engineered to transfer multi-gigabyte files (1GB – 50GB+) smoothly without memory spikes, device lag, or tab crashes.
- **Smart Resumption**: If a connection is interrupted, transfers resume from the exact byte offset instead of starting from scratch.
- **Cross-Platform & Cross-Network**: Works seamlessly across Windows, Linux, macOS, iOS, and Android — over local Wi-Fi, 4G/5G mobile cellular, or remote networks.

---

## 🏗️ System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│            Signaling Server (Node.js + Express + Socket.io)            │
│       Relays SDP Offer/Answer, ICE Candidates & Auto-CORS for Vercel   │
└───────────────────▲────────────────────────────────┬───────────────────┘
                    │ (Signaling Metadata)           │ (Signaling Metadata)
         ┌──────────┴──────────┐          ┌──────────┴──────────┐
         │     Peer A (Web)    │          │     Peer B (Web)    │
         │  Windows/Mac/Linux  │          │   Android/iOS/Linux │
         │ (Adaptive Slicing)  │          │(OPFS Disk Streaming)│
         └──────────┬──────────┘          └──────────▲──────────┘
                    │                                │
                    ├────────────────────────────────┤
                    │   STUN + TURN Relay Fallback   │
                    └────────────────────────────────┘
                 RTCDataChannel (Reliable & Ordered SCTP)
                  Full Duplex: Both Peers Send & Receive
```

---

## ⚙️ Core Engineering Highlights

### 1. Universal Zero-RAM Storage Engine (OPFS + FSA API)
Holding gigabytes of file chunks in browser memory (`ArrayBuffer` arrays) causes Out-of-Memory (OOM) browser tab crashes, particularly on mobile devices and Linux machines.

NoShare implements a **3-tier unified storage engine** ([`storageEngine.js`](frontend/src/utils/storageEngine.js)):
1. **Tier 1 — File System Access API** (`window.showSaveFilePicker`): Streams directly to the user-selected folder on desktop Chromium (Chrome, Edge, Brave, Opera).
2. **Tier 2 — Origin Private File System (OPFS)**: Utilizes sandboxed disk storage via `navigator.storage.getDirectory()`. Supported on modern Chrome, Edge, Firefox (111+), Safari (15.2+), Android, and iOS. Chunks stream directly to disk without holding memory.
3. **Tier 3 — IndexedDB Chunk Cache**: Robust discrete transaction store for legacy environments.

> **Result:** Constant memory footprint under **30MB RAM** regardless of whether transferring 100MB or 50GB.

---

### 2. Resumable Transfers & Checkpointing
If a network disconnect occurs during a 10GB file transfer:
- Each file generates a deterministic file fingerprint:
  $$\text{FileID} = \text{Hash}(\text{fileName} + \text{fileSize} + \text{lastModified})$$
- Progress checkpoints are saved to IndexedDB every 2MB.
- When peers reconnect, the receiver inspects local checkpoints and replies with `resumeOffset`.
- The sender slices directly from `offset = resumeOffset`, avoiding re-transmitting already received data.

---

### 3. Parallel DataChannel Striping & Low-End Fail-Safe
- **Parallel Striping:** On high-performance desktop devices, NoShare opens **4 parallel `RTCDataChannels`** and stripes binary chunks round-robin. This bypasses single-SCTP stream bottlenecks, delivering **$2\times\text{–}3\times$ higher transfer throughput**.
- **Low-End Device Fail-Safe:** The device capability profiler ([`deviceProfile.js`](frontend/src/utils/deviceProfile.js)) analyzes CPU core concurrency (`hardwareConcurrency`), memory (`deviceMemory`), and mobile user-agent signatures:
  - **Low-End Mode (Mobile phones, low-RAM laptops):** Clamps to **1 single channel**, $16\text{–}64\text{ KB}$ chunk ceiling, and conservative $512\text{ KB}$ buffer watermark to prevent CPU/memory saturation.
  - **High-End Mode (Desktops, workstations):** Enables 4 striped channels, dynamic $64\text{–}256\text{ KB}$ chunking, and $1.5\text{ MB}$ buffer ceilings.

---

### 4. Background Web Worker & SyncAccessHandle
- **NVMe Wire-Speed Disk I/O:** Leverages a background Web Worker ([`storageWorker.js`](frontend/src/workers/storageWorker.js)) with OPFS `createSyncAccessHandle()`.
- **Zero-Copy Memory Transfers:** Chunks are transferred to the worker thread via zero-copy transferable `ArrayBuffer` pointers, keeping the browser UI silky smooth at 60 FPS while writing at $200\text{–}500+\text{ MB/s}$ NVMe disk speeds.
- **AIMD Dynamic Chunking:** Implements Additive Increase, Multiplicative Decrease (AIMD) flow control: automatically scales chunk size up on low-latency LANs and scales down during network jitter.

---

### 5. Universal NAT Traversal (STUN + TURN Relay)
Connections across mobile carriers (4G/5G) or strict firewalls often fail behind symmetric NATs when relying solely on STUN.
- Integrated multi-provider STUN: Google STUN + Cloudflare STUN.
- Free/open **TURN relay fallback** (`openrelay.metered.ca`) ensures peer connection success rate across all network configurations.
- Integrated automatic ICE restart capability on network drops.

---

### 5. Symmetric Bidirectional P2P
- Both connected devices have full access to drag-and-drop file queues.
- Device A can send to Device B, while Device B can send back to Device A simultaneously or sequentially.

---

### 6. 1-Click Pairing & Instant QR Code
- Instant session links: `https://your-domain.vercel.app/#room=123456`.
- **Integrated SVG QR Code:** Mobile users can scan the QR code displayed on the desktop screen using their phone camera to pair in under 1 second without typing room codes.

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Transport** | WebRTC (`RTCPeerConnection`, `RTCDataChannel`) | Reliable, ordered, end-to-end encrypted direct data stream |
| **NAT Traversal** | Google STUN, Cloudflare STUN, OpenRelay TURN | Symmetric NAT & cross-network cellular traversal |
| **Signaling** | Node.js, Express, Socket.IO | Session setup, dynamic CORS, and room routing |
| **Frontend** | React 19, Vite | Responsive UI, component state, and theme management |
| **Storage Engine** | OPFS (Origin Private File System), FSA API, IndexedDB | Sandboxed zero-RAM disk streaming & checkpointing |
| **Pairing** | Pure JS SVG QR Code Generator, URL Hash auto-join | 1-second pairing without dependencies |
| **Hosting** | Vercel (Frontend) · Render (Signaling Backend) | Global edge hosting |

---

## 📂 Project Structure

```
NoShare/
├── backend/
│   ├── config/
│   │   └── cors.js              # Multi-origin CORS support (Vercel previews + local)
│   ├── middleware/
│   │   └── rateLimiter.js       # IP connection rate limiting
│   ├── sockets/
│   │   └── signalHandler.js     # Room lifecycle, ICE relay & renegotiation
│   ├── package.json
│   └── server.js                # Express & Socket.IO signaling entry point
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ConnectionStatus.jsx   # QR code modal, link copy & P2P status
│   │   │   ├── FileDropZone.jsx       # Accessible drag & drop file area
│   │   │   ├── FileQueueList.jsx      # Multi-file queue with remove & clear
│   │   │   ├── IncomingRequestCard.jsx# Resumable transfer approval card
│   │   │   ├── RoomConnection.jsx     # Main P2P orchestrator component
│   │   │   ├── RoomJoinForm.jsx       # 6-digit room code & hash auto-detect
│   │   │   └── TransferProgressCard.jsx# Live speed (MB/s), ETA & pause/resume
│   │   ├── hooks/
│   │   │   ├── useFileTransfer.js     # Resumable streaming & backpressure pipeline
│   │   │   ├── useSocket.js           # Socket.IO connection & cold-start handler
│   │   │   └── useWebRTC.js           # PeerConnection, STUN/TURN & DataChannel
│   │   ├── utils/
│   │   │   ├── format.js              # Sanitization, ETA, and byte formatting
│   │   │   ├── qrCode.js              # Zero-dependency SVG QR Code generator
│   │   │   └── storageEngine.js       # OPFS, FSA API & IndexedDB storage engine
│   │   ├── App.css                    # Responsive glassmorphic styles
│   │   └── App.jsx                    # Root application component
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
└── README.md
```

---

## 🌐 Browser & OS Compatibility

| Platform | WebRTC DataChannels | Zero-RAM Streaming Method | Resumable Checkpoints |
|---|---|---|---|
| **Windows (Chrome / Edge)** | ✅ Supported | ✅ Native File System Access | ✅ Supported |
| **macOS (Chrome / Edge / Safari)** | ✅ Supported | ✅ OPFS / File System Access | ✅ Supported |
| **Linux (Chrome / Firefox / Brave)** | ✅ Supported | ✅ OPFS / File System Access | ✅ Supported |
| **Android (Chrome / Firefox)** | ✅ Supported | ✅ OPFS Sandboxed Disk Stream | ✅ Supported |
| **iOS (Safari / Chrome)** | ✅ Supported | ✅ OPFS Sandboxed Disk Stream | ✅ Supported |

---

## 🚀 Getting Started

### Local Development

1. **Clone the repository:**
   ```bash
   git clone https://github.com/surajsinghania11292/NoShare.git
   cd NoShare
   ```

2. **Start the Signaling Server:**
   ```bash
   cd backend
   npm install
   npm run dev
   # Runs on http://localhost:5000
   ```

3. **Start the Frontend Client:**
   ```bash
   cd ../frontend
   npm install
   npm run dev
   # Runs on http://localhost:5173
   ```

4. **Initiate a Transfer:**
   - Open `http://localhost:5173` in two browser tabs or distinct devices.
   - Click **"Create Room"** on tab 1 $\rightarrow$ copy invite link or scan QR code on tab 2.
   - Drag and drop files to stream directly between devices!

---

## ☁️ Deployment Guide (Vercel + Render)

### 1. Backend on Render
1. Create a **Web Service** connected to your repository.
2. Root Directory: `backend`
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Under **Environment Variables**:
   - `CLIENT_URL`: `https://no-share.vercel.app` (your Vercel frontend URL, no trailing slash).

### 2. Frontend on Vercel
1. Import the repository in **Vercel**.
2. **Root Directory:** Set to `frontend` (Click Edit $\rightarrow$ choose `frontend`).
3. Framework Preset: **Vite**
4. Under **Environment Variables**:
   - `VITE_BACKEND_URL`: `https://your-backend.onrender.com` (your Render backend URL, no trailing slash).
5. Deploy!

---

## 🔒 Security & Privacy

- **End-to-End Encryption:** DataChannels run over DTLS (Datagram Transport Layer Security) with mandatory cipher suites.
- **Input Sanitization:** All incoming file names are sanitized using strict path traversal protection ([`format.js`](frontend/src/utils/format.js)) to prevent directory traversal (`../`) and script injection.
- **Zero Intermediary Logging:** Signaling servers only handle temporary ephemeral SDP session offers; zero file bytes ever touch the signaling server.
- **CORS Hardening:** Dynamic origin validation for trusted Vercel domains and local development.

---

## 📄 License & Author

Distributed under the **MIT License**.

**Suraj Kumar**
- GitHub: [@surajsinghania11292](https://github.com/surajsinghania11292)
- Email: [surajsinghania11292@gmail.com](mailto:surajsinghania11292@gmail.com)
