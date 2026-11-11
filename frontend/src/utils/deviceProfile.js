/**
 * Device capability profiler for adaptive, fail-safe P2P file transfers.
 * Dynamically scales channels, chunk sizing, and backpressure thresholds
 * based on device memory, CPU core concurrency, and platform architecture.
 */

export function getDeviceProfile() {
  const isMobile =
    typeof navigator !== 'undefined' &&
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
  const memory = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 2; // in GB

  // Classify as low-end if mobile, <= 4 cores, or <= 4GB RAM
  const isLowEnd = isMobile || cores <= 4 || memory <= 4;

  return {
    isLowEnd,
    isMobile,
    cores,
    memory,
    // Parallel channels: 1 on low-end (safe fail-safe), 4 on high-end desktop
    channelCount: isLowEnd ? 1 : 4,
    // Dynamic chunk sizing (AIMD scaling)
    initialChunkSize: isLowEnd ? 32 * 1024 : 64 * 1024, // 32KB vs 64KB
    minChunkSize: 16 * 1024, // 16KB
    maxChunkSize: isLowEnd ? 64 * 1024 : 256 * 1024, // 64KB vs 256KB
    // Backpressure thresholds
    highBufferThreshold: isLowEnd ? 512 * 1024 : 1.5 * 1024 * 1024, // 512KB vs 1.5MB
    lowBufferThreshold: isLowEnd ? 128 * 1024 : 384 * 1024 // 128KB vs 384KB
  };
}

