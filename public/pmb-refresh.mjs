const RETRYABLE_PMB_STATUSES = new Set([502, 503, 504, 520, 521, 522, 523, 524]);

export function isRetryablePmbStatus(status) {
  return RETRYABLE_PMB_STATUSES.has(Number(status));
}

export async function fetchPmbJsonWithRetry({
  fetcher,
  parseResponse,
  maxAttempts = 2,
  retryDelayMs = 400,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
} = {}) {
  if (typeof fetcher !== "function" || typeof parseResponse !== "function") {
    throw new TypeError("PMB refresh requires fetcher and parseResponse functions.");
  }

  const attemptLimit = Math.max(1, Math.floor(Number(maxAttempts) || 1));
  let response;
  let result;

  for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
    response = await fetcher();
    result = await parseResponse(response);
    if (response.ok || !isRetryablePmbStatus(response.status) || attempt === attemptLimit) {
      return { response, result, attempts: attempt };
    }
    await sleep(retryDelayMs * attempt);
  }

  return { response, result, attempts: attemptLimit };
}
