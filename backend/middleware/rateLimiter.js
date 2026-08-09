const ipRateLimiters = new Map(); // IP -> Array of timestamps

export const checkJoinRateLimit = (ip) => {
  const now = Date.now();
  const windowMs = 60 * 1000;
  
  if (!ipRateLimiters.has(ip)) {
    ipRateLimiters.set(ip, [now]);
    return true;
  }

  let timestamps = ipRateLimiters.get(ip);
  // Filter out timestamps older than the 1-minute window
  timestamps = timestamps.filter((t) => now - t < windowMs);
  timestamps.push(now);
  ipRateLimiters.set(ip, timestamps);

  return timestamps.length <= 10;
};
