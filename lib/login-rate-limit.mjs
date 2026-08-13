const DEFAULT_MAX_FAILURES = 5;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_LOCK_MS = 15 * 60 * 1000;
const MAX_TRACKED_CLIENTS = 2_000;

function cleanAddress(value) {
  const address = String(value || "").split(",")[0].trim();
  if (!address || address.length > 80 || !/^[a-f0-9:.]+$/i.test(address)) return "";
  return address.toLowerCase();
}

export function getLoginClientKey(request) {
  return cleanAddress(request?.headers?.get?.("cf-connecting-ip"))
    || cleanAddress(request?.headers?.get?.("x-forwarded-for"))
    || cleanAddress(request?.headers?.get?.("x-real-ip"))
    || "unknown-client";
}

export function createLoginThrottle({
  maxFailures = DEFAULT_MAX_FAILURES,
  windowMs = DEFAULT_WINDOW_MS,
  lockMs = DEFAULT_LOCK_MS,
  maxTrackedClients = MAX_TRACKED_CLIENTS,
} = {}) {
  const attempts = new Map();

  function prune(now) {
    for (const [key, entry] of attempts) {
      entry.failures = entry.failures.filter((timestamp) => now - timestamp < windowMs);
      if (!entry.failures.length && entry.lockedUntil <= now) attempts.delete(key);
    }
    while (attempts.size > maxTrackedClients) {
      attempts.delete(attempts.keys().next().value);
    }
  }

  function check(key, now = Date.now()) {
    prune(now);
    const entry = attempts.get(key);
    if (!entry || entry.lockedUntil <= now) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000)),
    };
  }

  function recordFailure(key, now = Date.now()) {
    prune(now);
    const entry = attempts.get(key) || { failures: [], lockedUntil: 0 };
    entry.failures = entry.failures.filter((timestamp) => now - timestamp < windowMs);
    entry.failures.push(now);
    if (entry.failures.length >= maxFailures) entry.lockedUntil = now + lockMs;
    attempts.set(key, entry);
    return check(key, now);
  }

  function reset(key) {
    attempts.delete(key);
  }

  function resetAll() {
    attempts.clear();
  }

  return Object.freeze({ check, recordFailure, reset, resetAll });
}

export const dashboardLoginThrottle = createLoginThrottle();
