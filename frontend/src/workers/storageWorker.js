/**
 * Background Storage Web Worker.
 * Executes zero-RAM disk writes via OPFS (Origin Private File System)
 * using createSyncAccessHandle() or createWritable() off the main UI thread.
 */

let opfsFileHandle = null;
let syncHandle = null;
let writable = null;
let opfsRoot = null;

self.onmessage = async (e) => {
  const { action, fileId, offset, data, resumeOffset } = e.data;

  if (action === 'init') {
    try {
      if (!navigator?.storage?.getDirectory) {
        self.postMessage({ status: 'unsupported' });
        return;
      }

      opfsRoot = await navigator.storage.getDirectory();
      const tempName = `noshare_temp_${fileId}`;
      opfsFileHandle = await opfsRoot.getFileHandle(tempName, { create: true });

      // Fast synchronous NVMe direct write handle
      if (typeof opfsFileHandle.createSyncAccessHandle === 'function') {
        syncHandle = await opfsFileHandle.createSyncAccessHandle();
        if (resumeOffset > 0) {
          syncHandle.truncate(resumeOffset);
        }
        self.postMessage({ status: 'ready', mode: 'sync-handle' });
        return;
      }

      // Asynchronous writable stream fallback in worker
      if (typeof opfsFileHandle.createWritable === 'function') {
        writable = await opfsFileHandle.createWritable({
          keepExistingData: resumeOffset > 0
        });
        if (resumeOffset > 0) {
          await writable.seek(resumeOffset);
        }
        self.postMessage({ status: 'ready', mode: 'writable' });
        return;
      }

      self.postMessage({ status: 'unsupported' });
    } catch (err) {
      self.postMessage({ status: 'error', message: err.message });
    }
  } else if (action === 'write') {
    try {
      if (syncHandle) {
        syncHandle.write(new Uint8Array(data), { at: offset });
        self.postMessage({ status: 'written', offset, length: data.byteLength });
      } else if (writable) {
        await writable.write({ type: 'write', position: offset, data });
        self.postMessage({ status: 'written', offset, length: data.byteLength });
      }
    } catch (err) {
      self.postMessage({ status: 'write-error', message: err.message });
    }
  } else if (action === 'finalize') {
    try {
      if (syncHandle) {
        syncHandle.flush();
        syncHandle.close();
        syncHandle = null;
      }
      if (writable) {
        await writable.close();
        writable = null;
      }
      const rawFile = await opfsFileHandle.getFile();
      self.postMessage({ status: 'finalized', file: rawFile });
    } catch (err) {
      self.postMessage({ status: 'finalize-error', message: err.message });
    }
  } else if (action === 'abort') {
    try {
      if (syncHandle) {
        syncHandle.close();
        syncHandle = null;
      }
      if (writable) {
        await writable.abort();
        writable = null;
      }
    } catch {}
  }
};

