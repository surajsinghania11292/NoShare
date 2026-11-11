import { sanitizeFileName } from './format';

const DB_NAME = 'noshare_cache_v2';
const DB_VERSION = 1;

/**
 * Open or upgrade the local IndexedDB database for checkpoint tracking.
 */
function openCheckpointDB() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      return resolve(null);
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('checkpoints')) {
          db.createObjectStore('checkpoints', { keyPath: 'fileId' });
        }
        if (!db.objectStoreNames.contains('chunks')) {
          db.createObjectStore('chunks', { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Deterministically hash file metadata into a unique file transfer ID.
 */
export function generateFileId(name, size, lastModified) {
  const cleanName = sanitizeFileName(name);
  const rawKey = `${cleanName}_${size}_${lastModified || 0}`;
  let hash = 0;
  for (let i = 0; i < rawKey.length; i++) {
    hash = (hash << 5) - hash + rawKey.charCodeAt(i);
    hash |= 0;
  }
  return `f_${Math.abs(hash).toString(36)}_${size.toString(36)}`;
}

/**
 * Retrieve saved checkpoint offset for resumable transfers.
 */
export async function getCheckpoint(fileId) {
  const db = await openCheckpointDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('checkpoints', 'readonly');
      const store = tx.objectStore('checkpoints');
      const req = store.get(fileId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Save current transfer progress checkpoint.
 */
export async function saveCheckpoint(fileId, meta, bytesReceived) {
  const db = await openCheckpointDB();
  if (!db) return;
  try {
    const tx = db.transaction('checkpoints', 'readwrite');
    const store = tx.objectStore('checkpoints');
    store.put({
      fileId,
      name: sanitizeFileName(meta.name),
      size: meta.size,
      mimeType: meta.mimeType || 'application/octet-stream',
      bytesReceived,
      updatedAt: Date.now()
    });
  } catch {}
}

/**
 * Delete completed or discarded checkpoint.
 */
export async function removeCheckpoint(fileId) {
  const db = await openCheckpointDB();
  if (!db) return;
  try {
    const tx = db.transaction(['checkpoints', 'chunks'], 'readwrite');
    tx.objectStore('checkpoints').delete(fileId);
    const chunkStore = tx.objectStore('chunks');
    const range = IDBKeyRange.bound(`${fileId}_0`, `${fileId}_\uffff`);
    chunkStore.delete(range);
  } catch {}
}

/**
 * Unified Zero-RAM Storage Engine.
 * Supports:
 *  Tier 1A: Background Web Worker OPFS (createSyncAccessHandle NVMe speed)
 *  Tier 1B: Desktop Chromium File System Access API (window.showSaveFilePicker)
 *  Tier 2: Main-thread OPFS (Origin Private File System)
 *  Tier 3: IndexedDB chunk storage with zero RAM retention
 */
export class StorageReceiverEngine {
  constructor(metadata, addLog) {
    this.metadata = metadata;
    this.addLog = addLog || console.log;
    this.safeName = sanitizeFileName(metadata.name);
    this.fileId = metadata.fileId || generateFileId(metadata.name, metadata.size, metadata.lastModified);
    this.mode = 'uninitialized';
    this.writable = null;
    this.opfsFileHandle = null;
    this.opfsRoot = null;
    this.bytesWritten = 0;
    this.idbDb = null;
    this.worker = null;
  }

  async init(resumeOffset = 0, forcePicker = false) {
    this.bytesWritten = resumeOffset;

    // TIER 1: Desktop File System Access API
    if (forcePicker && window.showSaveFilePicker) {
      try {
        this.addLog(`Prompting destination save dialog for "${this.safeName}"...`, 'info');
        const fileHandle = await window.showSaveFilePicker({
          suggestedName: this.safeName
        });
        this.writable = await fileHandle.createWritable({
          keepExistingData: resumeOffset > 0
        });
        if (resumeOffset > 0) {
          await this.writable.seek(resumeOffset);
        }
        this.mode = 'fs-access';
        this.addLog(`Direct disk streaming initialized via File System Access API.`, 'success');
        return { mode: this.mode, resumeOffset: this.bytesWritten };
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        this.addLog(`Save picker declined: ${err.message}. Trying OPFS...`, 'warning');
      }
    }

    // TIER 2A: High-Speed Background Web Worker with OPFS SyncAccessHandle
    if (typeof Worker !== 'undefined' && typeof navigator?.storage?.getDirectory === 'function') {
      try {
        const worker = new Worker(new URL('../workers/storageWorker.js', import.meta.url), {
          type: 'module'
        });

        const initResult = await new Promise((resolve) => {
          const timeout = setTimeout(() => resolve({ status: 'timeout' }), 2500);
          worker.onmessage = (e) => {
            clearTimeout(timeout);
            resolve(e.data);
          };
          worker.postMessage({ action: 'init', fileId: this.fileId, resumeOffset });
        });

        if (initResult && initResult.status === 'ready') {
          this.worker = worker;
          this.mode = 'worker-opfs';
          this.addLog(
            `High-speed background Web Worker OPFS (${initResult.mode}) active!`,
            'success'
          );
          return { mode: this.mode, resumeOffset: this.bytesWritten };
        } else {
          worker.terminate();
        }
      } catch (workerErr) {
        this.addLog(`Worker OPFS initialization skipped: ${workerErr.message}`, 'info');
      }
    }

    // TIER 2B: Main-thread OPFS
    if (typeof navigator?.storage?.getDirectory === 'function') {
      try {
        this.opfsRoot = await navigator.storage.getDirectory();
        const tempName = `noshare_temp_${this.fileId}`;
        this.opfsFileHandle = await this.opfsRoot.getFileHandle(tempName, { create: true });

        if (typeof this.opfsFileHandle.createWritable === 'function') {
          this.writable = await this.opfsFileHandle.createWritable({
            keepExistingData: resumeOffset > 0
          });
          if (resumeOffset > 0) {
            await this.writable.seek(resumeOffset);
          }
          this.mode = 'opfs';
          this.addLog(`Zero-RAM main-thread OPFS streaming initialized.`, 'success');
          return { mode: this.mode, resumeOffset: this.bytesWritten };
        }
      } catch (opfsErr) {
        this.addLog(`OPFS unavailable: ${opfsErr.message}. Falling back to chunk cache...`, 'warning');
      }
    }

    // TIER 3: IndexedDB chunk storage fallback (Universal Fail-Safe)
    this.idbDb = await openCheckpointDB();
    this.mode = 'indexeddb';
    this.addLog(`Streaming through sandboxed IndexedDB chunk storage.`, 'info');
    return { mode: this.mode, resumeOffset: this.bytesWritten };
  }

  async writeChunk(offset, data) {
    if (this.mode === 'worker-opfs') {
      if (!this.worker) throw new Error('Worker stream not ready');
      this.worker.postMessage({ action: 'write', offset, data }, [data]);
      this.bytesWritten = Math.max(this.bytesWritten, offset + data.byteLength);
    } else if (this.mode === 'fs-access' || this.mode === 'opfs') {
      if (!this.writable) throw new Error('Writable stream not ready');
      await this.writable.write({
        type: 'write',
        position: offset,
        data: data
      });
      this.bytesWritten = Math.max(this.bytesWritten, offset + data.byteLength);
    } else if (this.mode === 'indexeddb') {
      if (!this.idbDb) throw new Error('IndexedDB storage not ready');
      const chunkId = `${this.fileId}_${String(offset).padStart(16, '0')}`;
      await new Promise((resolve, reject) => {
        try {
          const tx = this.idbDb.transaction('chunks', 'readwrite');
          const store = tx.objectStore('chunks');
          store.put({ id: chunkId, fileId: this.fileId, offset, data });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        } catch (e) {
          reject(e);
        }
      });
      this.bytesWritten = Math.max(this.bytesWritten, offset + data.byteLength);
    }

    // Persist checkpoint every 2MB
    if (this.bytesWritten % (2 * 1024 * 1024) < data.byteLength) {
      await saveCheckpoint(this.fileId, this.metadata, this.bytesWritten);
    }
  }

  async finalize() {
    this.addLog(`Finalizing and assembling "${this.safeName}"...`, 'info');

    if (this.mode === 'worker-opfs') {
      const rawFile = await new Promise((resolve, reject) => {
        this.worker.onmessage = (e) => {
          if (e.data.status === 'finalized') resolve(e.data.file);
          else reject(new Error(e.data.message || 'Worker finalize error'));
        };
        this.worker.postMessage({ action: 'finalize' });
      });

      this.triggerBrowserDownload(rawFile, this.safeName);
      this.worker.terminate();
      this.worker = null;
      await removeCheckpoint(this.fileId);
      this.addLog(`Transfer complete! Download triggered automatically.`, 'success');
      return { success: true, savedDirectly: false };
    }

    if (this.mode === 'fs-access') {
      if (this.writable) {
        await this.writable.close();
        this.writable = null;
      }
      await removeCheckpoint(this.fileId);
      this.addLog(`File successfully saved to chosen folder!`, 'success');
      return { success: true, savedDirectly: true };
    }

    if (this.mode === 'opfs') {
      if (this.writable) {
        await this.writable.close();
        this.writable = null;
      }
      const rawFile = await this.opfsFileHandle.getFile();
      this.triggerBrowserDownload(rawFile, this.safeName);

      try {
        if (this.opfsRoot) {
          await this.opfsRoot.removeEntry(`noshare_temp_${this.fileId}`);
        }
      } catch {}

      await removeCheckpoint(this.fileId);
      this.addLog(`Transfer complete! Download triggered automatically.`, 'success');
      return { success: true, savedDirectly: false };
    }

    if (this.mode === 'indexeddb') {
      const chunks = await new Promise((resolve, reject) => {
        const tx = this.idbDb.transaction('chunks', 'readonly');
        const store = tx.objectStore('chunks');
        const range = IDBKeyRange.bound(`${this.fileId}_0`, `${this.fileId}_\uffff`);
        const req = store.getAll(range);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });

      chunks.sort((a, b) => a.offset - b.offset);
      const blobParts = chunks.map((c) => c.data);
      const finalBlob = new Blob(blobParts, {
        type: this.metadata.mimeType || 'application/octet-stream'
      });
      this.triggerBrowserDownload(finalBlob, this.safeName);

      await removeCheckpoint(this.fileId);
      this.addLog(`Transfer complete! File downloaded.`, 'success');
      return { success: true, savedDirectly: false };
    }
  }

  triggerBrowserDownload(blobOrFile, fileName) {
    const url = URL.createObjectURL(blobOrFile);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 15000);
  }

  async abort() {
    this.addLog(`Aborting storage stream...`, 'warning');
    if (this.worker) {
      try {
        this.worker.postMessage({ action: 'abort' });
        this.worker.terminate();
      } catch {}
      this.worker = null;
    }
    if (this.writable) {
      try {
        await this.writable.abort();
      } catch {}
      this.writable = null;
    }
  }
}
