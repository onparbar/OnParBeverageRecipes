const STAFF_READ_PATHS = new Set([
  "/api/recipe-data",
  "/api/staff-prep-plan",
  "/api/staff-tap-sheets",
  "/api/weekly-order-tracking",
]);

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function requestMethod(input, init = {}) {
  return String(init.method || input?.method || "GET").toUpperCase();
}

function requestUrl(input, baseUrl) {
  try {
    return new URL(typeof input === "string" ? input : input?.url, baseUrl);
  } catch {
    return null;
  }
}

async function responseSnapshot(response) {
  const clone = response.clone();
  return {
    body: await clone.text(),
    status: response.status,
    statusText: response.statusText,
    headers: [...clone.headers.entries()],
  };
}

function fallbackResponse(snapshot, ResponseCtor) {
  const headers = new Headers(snapshot.headers);
  headers.set("x-onpar-data-source", "last-known");
  headers.set("cache-control", "private, no-store, max-age=0");
  return new ResponseCtor(snapshot.body, {
    status: snapshot.status,
    statusText: snapshot.statusText,
    headers,
  });
}

async function fetchWithDeadline(fetcher, input, init, timeoutMs) {
  const controller = new AbortController();
  const callerSignal = init?.signal;
  if (callerSignal?.aborted) controller.abort(callerSignal.reason);
  const abort = () => controller.abort(callerSignal?.reason);
  callerSignal?.addEventListener?.("abort", abort, { once: true });
  const timeoutId = setTimeout(() => controller.abort("staff-read-timeout"), timeoutMs);
  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener?.("abort", abort);
  }
}

export function createResilientStaffFetch({
  fetcher,
  baseUrl = "https://onparbev.com",
  timeoutMs = 8_000,
  maxAttempts = 2,
  retryDelayMs = 250,
  sleep = wait,
  ResponseCtor = globalThis.Response,
} = {}) {
  if (typeof fetcher !== "function" || typeof ResponseCtor !== "function") {
    throw new TypeError("Staff resilience requires fetch and Response implementations.");
  }
  const snapshots = new Map();
  const inFlight = new Map();

  return function resilientStaffFetch(input, init = {}) {
    const url = requestUrl(input, baseUrl);
    const isProtectedRead = requestMethod(input, init) === "GET"
      && url
      && url.origin === new URL(baseUrl).origin
      && STAFF_READ_PATHS.has(url.pathname);
    if (!isProtectedRead) return fetcher(input, init);
    const key = url.pathname + url.search;
    if (inFlight.has(key)) return inFlight.get(key);

    const operation = (async () => {
      let lastError;
      const attempts = Math.max(1, Math.floor(Number(maxAttempts) || 1));
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          const response = await fetchWithDeadline(fetcher, input, init, timeoutMs);
          if (response.ok) {
            snapshots.set(key, await responseSnapshot(response));
            return response;
          }
          if (response.status < 500) return response;
          lastError = new Error("Staff data returned " + response.status + ".");
        } catch (error) {
          lastError = error;
        }
        if (attempt < attempts) await sleep(retryDelayMs * attempt);
      }
      if (snapshots.has(key)) return fallbackResponse(snapshots.get(key), ResponseCtor);
      return new ResponseCtor(JSON.stringify({
        error: "This week's plan could not load. Check the connection and retry.",
        code: "STAFF_READ_UNAVAILABLE",
      }), {
        status: 503,
        headers: { "content-type": "application/json", "cache-control": "private, no-store, max-age=0" },
      });
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, operation);
    return operation;
  };
}

export function createStaffMutationBatch({ send, maxItems = 100 } = {}) {
  if (typeof send !== "function") throw new TypeError("Staff mutation batching requires a send function.");
  const pending = new Map();
  return {
    enqueue(key, value) {
      const normalizedKey = String(key || "").trim();
      if (!normalizedKey) return;
      pending.set(normalizedKey, value);
      while (pending.size > maxItems) pending.delete(pending.keys().next().value);
    },
    size() {
      return pending.size;
    },
    async flush(context = {}) {
      const entries = [...pending.entries()].map(([key, value]) => ({ key, value }));
      if (!entries.length) return { ok: true, count: 0 };
      const result = await send(entries, context);
      entries.forEach(({ key }) => pending.delete(key));
      return { ok: true, count: entries.length, result };
    },
  };
}

export function installStaffLoadingWatchdog({
  documentRef = globalThis.document,
  locationRef = globalThis.location,
  timeoutMs = 15_000,
} = {}) {
  if (!documentRef?.body) return () => {};
  const timeoutId = setTimeout(() => {
    const loading = [...documentRef.querySelectorAll("main *")].some((element) => (
      /loading this week(?:'|’)s plan/i.test(element.textContent || "")
    ));
    if (!loading || documentRef.querySelector("#staff-loading-recovery")) return;
    const banner = documentRef.createElement("section");
    banner.id = "staff-loading-recovery";
    banner.className = "staff-loading-recovery";
    const message = documentRef.createElement("strong");
    message.textContent = "This week's plan is taking too long to load.";
    const button = documentRef.createElement("button");
    button.type = "button";
    button.textContent = "Retry";
    button.addEventListener("click", () => locationRef?.reload?.());
    banner.append(message, button);
    (documentRef.querySelector("main") || documentRef.body).prepend(banner);
  }, Math.max(1, Number(timeoutMs) || 15_000));
  return () => clearTimeout(timeoutId);
}

export function installStaffResilience(windowRef = globalThis.window) {
  if (!windowRef?.fetch || windowRef.__onParStaffResilienceInstalled) return;
  windowRef.__onParStaffResilienceInstalled = true;
  windowRef.fetch = createResilientStaffFetch({
    fetcher: windowRef.fetch.bind(windowRef),
    baseUrl: windowRef.location?.origin || "https://onparbev.com",
    ResponseCtor: windowRef.Response,
  });
  const startWatchdog = () => installStaffLoadingWatchdog({
    documentRef: windowRef.document,
    locationRef: windowRef.location,
  });
  if (windowRef.document?.readyState === "loading") {
    windowRef.document.addEventListener("DOMContentLoaded", startWatchdog, { once: true });
  } else startWatchdog();
}

if (typeof window !== "undefined") installStaffResilience(window);
