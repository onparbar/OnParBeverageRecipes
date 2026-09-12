// Configuration acceptance is not completion. Confirm live tap readiness
// without issuing another configuration write or trusting saved snapshots.
export async function waitForPmbTapReadiness({
  expectedTapNumbers,
  sentAt,
  readLevels,
  onProgress = () => {},
  now = () => Date.now(),
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  intervalMs = 15_000,
  maxWaitMs = Number.POSITIVE_INFINITY,
} = {}) {
  const expected = new Set(expectedTapNumbers);
  const startedAt = Date.parse(sentAt);
  if (expected.size !== 102 || expectedTapNumbers.length !== 102
    || [...expected].some((tap) => !Number.isInteger(tap) || tap < 1 || tap > 102)
    || !Number.isFinite(startedAt) || typeof readLevels !== "function") {
    throw new Error("The complete 102-tap repair check could not be started.");
  }
  const deadline = now() + maxWaitMs;
  let consecutive = 0;
  let previousCapture = 0;
  let nextCheckDelayMs = 60_000;
  onProgress("Repair sent. Waiting one minute before checking all 102 taps, then retrying checks every 15 seconds until they reconnect. PMB will refresh automatically afterward.");
  while (now() < deadline) {
    await wait(Math.min(nextCheckDelayMs, Math.max(0, deadline - now())));
    nextCheckDelayMs = intervalMs;
    if (now() >= deadline) break;
    let result;
    try {
      result = await readLevels(Math.min(90_000, deadline - now()));
    } catch (error) {
      consecutive = 0;
      previousCapture = 0;
      onProgress(["AbortError", "TimeoutError"].includes(error?.name)
        ? "The readiness check timed out. Retrying the check in 15 seconds; the repair will not be repeated."
        : "Waiting for PMB to reconnect. Retrying the check in 15 seconds; the repair will not be repeated.");
      continue;
    }
    const items = Array.isArray(result?.items) ? result.items : [];
    const capturedAt = Date.parse(result?.updatedAt || "");
    const fresh = result?.stale === false && !result?.error && !result?.liveError
      && Number.isFinite(capturedAt) && capturedAt >= startedAt
      && capturedAt <= now() + 60_000;
    const live = items.filter((item) => item.levelAvailable === true
      && item.fillLevelPercent !== null && item.fillLevelPercent !== ""
      && Number.isFinite(Number(item.fillLevelPercent))
      && Number(item.fillLevelPercent) >= 0 && Number(item.fillLevelPercent) <= 100);
    const liveTaps = new Set(live.map((item) => Number(item.tapNumber)).filter((tap) => expected.has(tap)));
    const complete = fresh && !result.partial && !result.degraded
      && result.expectedCount === 102 && result.capturedCount === 102
      && items.length === 102 && live.length === 102 && liveTaps.size === 102;
    consecutive = complete && capturedAt > previousCapture ? consecutive + 1 : 0;
    previousCapture = complete ? capturedAt : 0;
    if (now() >= deadline) break;
    if (consecutive >= 2) return { ready: true, verifiedAt: result.updatedAt };
    onProgress(complete
      ? "All 102 taps are responding. Confirming the connection stays ready before refreshing PMB..."
      : fresh
        ? `Waiting for taps to reconnect: ${liveTaps.size} of 102 responding. No additional repair will be sent.`
        : "Waiting for fresh tap readings after the repair. Saved levels do not count as confirmation.");
  }
  throw new Error("The requested connection-check window ended before all 102 taps were confirmed. The repair was not repeated.");
}
