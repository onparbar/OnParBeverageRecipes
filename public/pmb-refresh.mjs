const RETRYABLE_PMB_STATUSES = new Set([502, 503, 504, 520, 521, 522, 523, 524]);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

async function withTimeout(promise, timeoutMs, message) {
  const limit = Math.max(1, Number(timeoutMs) || 1);
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), limit);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

export function isRetryablePmbStatus(status) {
  return RETRYABLE_PMB_STATUSES.has(Number(status));
}

export async function fetchPmbJsonWithRetry({
  fetcher,
  parseResponse,
  maxAttempts = 2,
  retryDelayMs = 400,
  timeoutMs = 12_000,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
} = {}) {
  if (typeof fetcher !== "function" || typeof parseResponse !== "function") {
    throw new TypeError("PMB refresh requires fetcher and parseResponse functions.");
  }

  const attemptLimit = Math.max(1, Math.floor(Number(maxAttempts) || 1));
  let response;
  let result;
  let lastError;

  for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
    try {
      response = await withTimeout(
        Promise.resolve().then(fetcher),
        timeoutMs,
        "PMB did not respond in time.",
      );
      result = await parseResponse(response);
      if (response.ok || !isRetryablePmbStatus(response.status) || attempt === attemptLimit) {
        return { response, result, attempts: attempt };
      }
    } catch (error) {
      lastError = error;
      if (attempt === attemptLimit) throw error;
    }
    await sleep(retryDelayMs * attempt);
  }

  if (lastError) throw lastError;
  return { response, result, attempts: attemptLimit };
}

export async function runPmbRefreshTransaction({
  sources = [],
  now = () => new Date(),
} = {}) {
  const tasks = (Array.isArray(sources) ? sources : []).map((source, index) => ({
    key: clean(source?.key) || "source-" + (index + 1),
    label: clean(source?.label) || clean(source?.key) || "PMB source " + (index + 1),
    required: source?.required !== false,
    run: source?.run,
  }));
  if (!tasks.length || tasks.some((task) => typeof task.run !== "function")) {
    throw new TypeError("PMB refresh requires at least one named source.");
  }
  if (new Set(tasks.map((task) => task.key)).size !== tasks.length) {
    throw new TypeError("PMB refresh source keys must be unique.");
  }

  const startedAt = now().toISOString();
  const results = await Promise.all(tasks.map(async (task) => {
    try {
      const value = await task.run();
      if (value?.ok === false) {
        return {
          key: task.key,
          label: task.label,
          required: task.required,
          ok: false,
          message: clean(value.error || value.message) || task.label + " could not refresh.",
        };
      }
      return { key: task.key, label: task.label, required: task.required, ok: true, value };
    } catch (error) {
      return {
        key: task.key,
        label: task.label,
        required: task.required,
        ok: false,
        message: clean(error?.message) || task.label + " could not refresh.",
      };
    }
  }));
  const successCount = results.filter((result) => result.ok).length;
  const requiredFailures = results.filter((result) => result.required && !result.ok);
  const status = successCount === results.length
    ? "ok"
    : successCount === 0 || requiredFailures.length === tasks.filter((task) => task.required).length
      ? "failed"
      : "partial";
  const completedAt = now().toISOString();
  return {
    status,
    startedAt,
    completedAt,
    sourceCount: results.length,
    successCount,
    failureCount: results.length - successCount,
    sources: results,
    message: status === "ok"
      ? "PMB refreshed."
      : status === "partial"
        ? "PMB partially refreshed. Previously verified data remains available for the failed source."
        : "PMB could not refresh. Previously verified data remains unchanged.",
  };
}

export function createPmbRefreshCoordinator(options = {}) {
  let inFlight = null;
  let lastResult = null;
  return {
    refresh(overrides = {}) {
      if (inFlight) return inFlight;
      inFlight = runPmbRefreshTransaction({ ...options, ...overrides })
        .then((result) => {
          lastResult = result;
          return result;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
    getLastResult() {
      return lastResult;
    },
    isRefreshing() {
      return Boolean(inFlight);
    },
  };
}
