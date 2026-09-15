import { createHash, randomUUID } from "node:crypto";

const TABLES = new Set(["pmb_data_backup", "dashboard_shared_state", "inventory_shared_state", "keg_par_agent_shared_state", "weekly_usage_shared_state", "pmb_level_snapshot", "pmb_tap_product_current", "pmb_tap_product_events", "dashboard_activity_log"]);
const VOLATILE = new Set(["updatedAt", "updated_at", "capturedAt", "captured_at", "observedAt", "observed_at", "lastSeenAt", "lastSyncAt"]);
const SECRET = /^(?:password|secret|token|authtoken|access_token|refresh_token|authorization|cookie|apikey|api_key|service_role_key)$/i;
export function backupSafeData(value) {
  if (Array.isArray(value)) return value.map(backupSafeData);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().filter(key => !SECRET.test(key)).map(key => [key, backupSafeData(value[key])]));
}
function businessData(value) {
  if (Array.isArray(value)) return value.map(businessData);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !VOLATILE.has(key)).map(([key, data]) => [key, businessData(data)]));
}
export const backupHash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function createBackupStore({ env = process.env, fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  function config() {
    const base = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
    const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
    if (!base || !secret) throw new Error("Dashboard backup storage is not configured.");
    const url = new URL(base);
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Dashboard backup storage requires HTTPS.");
    return { base, secret };
  }
  async function rest(table, query = {}, { method = "GET", body, prefer = "return=representation" } = {}) {
    if (!TABLES.has(table)) throw new Error("Unknown dashboard backup table.");
    const { base, secret } = config();
    const url = new URL(`${base}/rest/v1/${table}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    const response = await fetchImpl(url, { method, cache: "no-store", signal: AbortSignal.timeout(20000),
      headers: { apikey: secret, ...(secret.split(".").length === 3 ? { Authorization: `Bearer ${secret}` } : {}), "Content-Type": "application/json", Prefer: prefer },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const rows = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(rows)) throw new Error(`Dashboard backup storage failed for ${table} (${response.status}).`);
    return rows;
  }
  async function read(source) { return (await rest("pmb_data_backup", { source: `eq.${source}`, limit: 1 }))[0] || null; }
  async function save(source, data) {
    const stamp = now().toISOString();
    const rows = await rest("pmb_data_backup", { on_conflict: "source" }, { method: "POST", prefer: "resolution=merge-duplicates,return=representation", body: { source, data: backupSafeData(data), captured_at: stamp, updated_at: stamp } });
    if (rows.length !== 1) throw new Error("Dashboard backup status was not saved.");
    return rows[0];
  }
  async function archive(records, heads = {}) {
    const next = { ...heads }; const inserts = []; const stamp = now().toISOString();
    for (const { kind, identity = "current", payload } of records) {
      if (!/^[a-z][a-z0-9-]{0,27}$/.test(kind)) throw new Error("Invalid backup record kind.");
      const safe = backupSafeData(payload);
      const fingerprint = backupHash(businessData(safe));
      const key = `${kind}:${identity}`;
      if (heads[key]?.fingerprint === fingerprint) continue;
      // Chaining the prior version preserves A -> B -> A transitions and makes
      // retries idempotent if archives saved but the status write was interrupted.
      const source = `history-${kind}-${backupHash([key, fingerprint, heads[key]?.source || ""]).slice(0, 32)}`;
      const data = { schemaVersion: 1, kind, identity: String(identity), observedAt: stamp, checksum: backupHash(safe), payload: safe };
      inserts.push({ source, data, captured_at: stamp, updated_at: stamp });
      next[key] = { fingerprint, source, observedAt: stamp };
    }
    for (let i = 0; i < inserts.length; i += 20) {
      await rest("pmb_data_backup", { on_conflict: "source" }, { method: "POST", body: inserts.slice(i, i + 20), prefer: "resolution=ignore-duplicates,return=representation" });
    }
    return { heads: next, added: inserts.length };
  }
  async function acquire() {
    const source = "dashboard-backup-lease", previous = await read(source);
    const at = now(), owner = randomUUID();
    if (Date.parse(previous?.data?.expiresAt) > at.getTime()) return null;
    const body = { source, data: { owner, expiresAt: new Date(at.getTime() + 10 * 60000).toISOString() }, captured_at: at.toISOString(), updated_at: at.toISOString() };
    const rows = await rest("pmb_data_backup", previous ? { source: `eq.${source}`, updated_at: `eq.${previous.updated_at}` } : { on_conflict: "source" }, {
      method: previous ? "PATCH" : "POST", body, prefer: previous ? "return=representation" : "resolution=ignore-duplicates,return=representation" });
    return rows.length === 1 && rows[0].data?.owner === owner ? owner : null;
  }
  async function release(owner) {
    return rest("pmb_data_backup", { source: "eq.dashboard-backup-lease", "data->>owner": `eq.${owner}` }, { method: "PATCH", body: { data: { owner, expiresAt: now().toISOString() }, updated_at: now().toISOString() } });
  }
  return { rest, read, save, archive, acquire, release };
}
