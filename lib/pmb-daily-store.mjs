import { readLatestPmbDataBackup } from './pmb-data-backup-store.mjs';

export async function dailyRest(path, options = {}) {
  const base = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !secret) throw new Error('Daily report storage is not configured.');
  const response = await fetch(`${base.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...options, cache: 'no-store', signal: AbortSignal.timeout(15000),
    headers: { apikey: secret, ...(secret.split('.').length === 3 ? { Authorization: `Bearer ${secret}` } : {}),
      'Content-Type': 'application/json', Prefer: 'return=representation', ...options.headers },
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(result)) throw new Error(`Daily report storage failed (${response.status}).`);
  return result;
}
export async function readDaily(day) { return readLatestPmbDataBackup(`pmb-daily-${day}`); }
export async function readDailyRange(start, end) {
  return dailyRest(`pmb_data_backup?select=data&source=gte.pmb-daily-${start}&source=lte.pmb-daily-${end}&order=source&limit=366`);
}
export async function readAssignmentEvents() {
  const events = [];
  for (let offset = 0; offset < 10000; offset += 1000) {
    const batch = await dailyRest(`pmb_tap_product_events?select=slot_key,occurred_at,product&order=id&limit=1000&offset=${offset}`);
    events.push(...batch);
    if (batch.length < 1000) return events;
  }
  throw new Error('Assignment history requires a larger paginated import. No daily report was saved.');
}
export async function saveDaily(report, previous) {
  const source = `pmb-daily-${report.day}`;
  const payload = { source, data: report, captured_at: report.capturedAt, updated_at: new Date().toISOString() };
  const path = previous
    ? `pmb_data_backup?source=eq.${source}&updated_at=eq.${encodeURIComponent(previous.updatedAt)}`
    : 'pmb_data_backup?on_conflict=source';
  const saved = await dailyRest(path, { method: previous ? 'PATCH' : 'POST',
    headers: { Prefer: previous ? 'return=representation' : 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify(payload) });
  if (saved.length !== 1) throw new Error('Another daily import finished first. Reload before retrying.');
}
export async function readMoneyUnits() { return (await readLatestPmbDataBackup('pmb-daily-money-units'))?.data || null; }
