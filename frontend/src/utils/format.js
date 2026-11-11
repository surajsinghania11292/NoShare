export const formatBytes = (bytes) => {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Sanitize incoming file names to prevent path traversal or script injection.
 */
export const sanitizeFileName = (fileName) => {
  if (!fileName || typeof fileName !== 'string') return 'downloaded_file';
  // Strip control chars and non-printables
  let clean = fileName.replace(/[\x00-\x1f\x80-\x9f]/g, '');
  // Strip path traversal sequences (../, ..\, /, \)
  clean = clean.replace(/^.*[\\\/]/, '').replace(/\.\.+/g, '.');
  // Trim spaces and dots
  clean = clean.trim().replace(/^\.+/, '');
  return clean || 'downloaded_file';
};

/**
 * Format remaining time in a human-friendly format (e.g. 1m 24s).
 */
export const formatEta = (seconds) => {
  if (!isFinite(seconds) || seconds <= 0) return '--';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.ceil(seconds % 60);
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
};

