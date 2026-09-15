import { getTapConfigRows } from "./pmb-tap-config.mjs";
import { buildVerifiedKegSlotMap } from "./pmb-keg-safety.mjs";
import { parsePmbJson } from "./pmb-json.mjs";
import { buildDailyReport, dailyWindows } from "./pmb-daily-report.mjs";
import { readDaily, readAssignmentEvents, saveDaily } from "./pmb-daily-store.mjs";
import { createBackupStore } from "./dashboard-backup-store.mjs";

let importing = false;
export async function importPmbDailyReport(input, { signal, now = new Date(), env = process.env, fetchImpl = globalThis.fetch,
  readPrevious = readDaily, readEvents = readAssignmentEvents, saveReport = saveDaily, readTaps = getTapConfigRows,
  archiveStore = createBackupStore({ env, fetchImpl }),
} = {}) {
  const windows = dailyWindows(input.day, now);
  if (input.costs && (!Array.isArray(input.costs) || input.costs.length > 250)) throw Object.assign(new Error("Invalid cost snapshot."), { status: 422 });
  const costs = (input.costs || []).filter(c => c && Number.isFinite(Number(c.costPerOz)) && Number(c.costPerOz) > 0 && Number(c.costPerOz) < 1000);
  if (importing) throw Object.assign(new Error("A daily PMB import is already running. Try again shortly."), { status: 429 });
  importing = true;
  try {
    const previous = await readPrevious(input.day);
    const events = await readEvents();
    const config = { baseUrl: String(env.PMB_API_BASE_URL || "").trim().replace(/\/$/, ""), username: env.PMB_API_USERNAME, password: env.PMB_API_PASSWORD,
      clientId: Number(env.PMB_API_CLIENT_ID || "910423"), clientName: env.PMB_API_CLIENT_NAME || "PourMyBeer API" };
    if (!config.baseUrl || !config.username || !config.password) throw new Error("PMB daily connection is not configured.");
    const deadline = AbortSignal.timeout(75000);
    async function post(path, body, token = "") {
      const response = await fetchImpl(`${config.baseUrl}${path}`, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body), signal: AbortSignal.any([deadline, ...(signal ? [signal] : []), AbortSignal.timeout(18000)]) });
      if (!response.ok) throw new Error(`PMB daily read failed (${response.status}). Previous saved data was kept.`);
      const result = parsePmbJson(await response.text());
      if (!result) throw new Error("PMB returned an unreadable report.");
      return result;
    }
    const auth = await post("/api/authtoken", { username: config.username, password: config.password, id: config.clientId, name: config.clientName, type: "json-server-control", version: 1 });
    if (!auth.authtoken) throw new Error("PMB daily authentication failed.");
    const taps = [...buildVerifiedKegSlotMap(await readTaps(config, { timeoutMs: 5000 })).values()];
    const reads = [];
    for (const range of windows) reads.push((await post("/api/transactions", { id: config.clientId, ...range }, auth.authtoken)).taptransactions);
    const report = buildDailyReport({ day: input.day, reads, taps, events, costs, previous: previous?.data, now });
    if (previous?.data?.coverage === "matching-overlapping-reads" && report.coverage !== "matching-overlapping-reads") throw new Error("The new reads are less complete than the saved report. The saved report was kept.");
    // Keep both versions before replacing the current report. These archives
    // contain aggregate operational data, not customer/card identifiers.
    const oldHeads = previous ? (await archiveStore.archive([{ kind: "daily-report", identity: input.day, payload: previous.data }])).heads : {};
    await archiveStore.archive([{ kind: "daily-report", identity: input.day, payload: report }], oldHeads);
    await saveReport(report, previous);
    return report;
  } finally { importing = false; }
}
