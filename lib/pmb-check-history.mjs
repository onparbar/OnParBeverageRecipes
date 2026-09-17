import { randomUUID } from "node:crypto";
import { createBackupStore } from "./dashboard-backup-store.mjs";

// Stored only in server-side Supabase backup storage; no dashboard presentation.
export function createPmbCheckHistory(request, { store = createBackupStore(), now = () => new Date() } = {}) {
  const id = randomUUID();
  let trigger = "dashboard";
  try {
    const requested = new URL(request?.url).searchParams.get("checkSource");
    if (["automatic", "repair-verification"].includes(requested)) trigger = requested;
  } catch { /* Requests without a URL retain the dashboard attribution. */ }
  const record = { schemaVersion: 1, id, trigger, startedAt: now().toISOString(),
    status: "running", stage: "authentication", expectedCount: null, attempts: [] };
  const safeError = (error) => ({
    code: String(error?.code || error?.name || "PMB_READ_FAILED").slice(0, 100),
    // Do not persist arbitrary upstream response bodies, URLs, or credentials.
    kind: /timeout|timed out|abort/i.test(`${error?.name} ${error?.message}`) ? "timeout"
      : /auth|401|403/i.test(`${error?.code} ${error?.message}`) ? "authentication"
        : /fetch|network|socket|connect/i.test(`${error?.code} ${error?.message}`) ? "connection"
          : "invalid-or-unavailable-response",
  });
  async function save() {
    try { await store.save(`pmb-check-${id}`, record); }
    catch { console.error(`PMB check history could not be saved (${id}, ${record.status}).`); }
  }
  return {
    start: save,
    stage(value) { record.stage = value; },
    expect(slots) { record.expectedCount = slots.length; },
    attempt(slot, attempt, startedAt, error = null) {
      record.attempts.push({ tapNumber: slot.tapNumber, deviceId: slot.deviceId,
        lineNum: slot.lineNum, plu: slot.plu, attempt, startedAt,
        finishedAt: now().toISOString(), success: !error, ...(error ? { error: safeError(error) } : {}) });
    },
    async finish({ items, error } = {}) {
      record.finishedAt = now().toISOString();
      record.durationMs = Date.parse(record.finishedAt) - Date.parse(record.startedAt);
      record.status = error ? "failed" : items?.some((item) => !item.levelAvailable) ? "partial" : "complete";
      record.capturedCount = error ? null : (items || []).filter((item) => item.levelAvailable).length;
      if (error) record.error = safeError(error);
      record.taps = (items || []).map((item) => ({ tapNumber: item.tapNumber,
        deviceId: item.deviceId, lineNum: item.lineNum, plu: item.plu,
        available: item.levelAvailable === true, lastKnownAt: item.lastKnownAt || null }));
      await save();
    },
  };
}
