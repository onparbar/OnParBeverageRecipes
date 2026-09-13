import { createHash } from 'node:crypto';
import { pmbLocalMidnight } from './pmb-first-pour-report.mjs';

const DAY = 86400000;
export const REPORT_ZONE = 'America/New_York';
export function dayMillis(day) {
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day)) || !Number.isFinite(ms)
    || new Date(ms).toISOString().slice(0, 10) !== day) throw Object.assign(new Error('Use a valid report date.'), { status: 422 });
  return ms;
}
export function businessDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: REPORT_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}
export function reportDays(start, end) {
  const a = dayMillis(start), b = dayMillis(end);
  if (b < a || b - a > 365 * DAY) throw Object.assign(new Error('Choose up to one year of history.'), { status: 422 });
  return Array.from({ length: (b - a) / DAY + 1 }, (_, i) => new Date(a + i * DAY).toISOString().slice(0, 10));
}
export function dailyWindows(day, now = new Date()) {
  const ms = dayMillis(day);
  if (ms >= dayMillis(businessDate(now))) throw Object.assign(new Error('Import completed days only.'), { status: 422 });
  // Put the requested day inside both reads, not on PMB's unreliable start boundary.
  return [1, 2].map((padding) => ({
    start_time: pmbLocalMidnight(ms - padding * DAY),
    end_time: pmbLocalMidnight(ms + DAY),
  }));
}
function numeric(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const text = String(value).trim();
  return /^-?(?:\d+\.?\d*|\.\d+)$/.test(text) && Number.isFinite(Number(text)) ? Number(text) : null;
}
const integer = (value) => Number.isSafeInteger(numeric(value)) && numeric(value) > 0 ? numeric(value) : null;
function transactionMap(rows, start, end) {
  if (!Array.isArray(rows)) throw new Error('PMB did not return a transaction list. Nothing was saved.');
  const map = new Map();
  for (const raw of rows) {
    const epoch = numeric(raw?.tst_start);
    const at = epoch >= 1e12 ? epoch : epoch * 1000;
    if (!(at > 0) || !Number.isFinite(new Date(at).getTime())) throw new Error('A PMB pour has no usable timestamp. Nothing was saved.');
    if (at < start || at >= end) continue;
    const plu = integer(raw.plu), oz = numeric(raw.volume_amount);
    if (!plu || oz === null || oz < 0) throw new Error('A PMB pour has an invalid product or volume. Nothing was saved.');
    const tap = integer(raw.tapNumber ?? raw.tap_number ?? raw.tap_num ?? raw.tap_no ?? raw.tap);
    const device = integer(raw.deviceId ?? raw.device_id ?? raw.controller_id);
    const line = integer(raw.lineNum ?? raw.line_num ?? raw.line_number);
    const row = { at: new Date(at).toISOString(), plu, oz, moneyRaw: numeric(raw.money_amount), priceRaw: numeric(raw.price_per_unit), tap, device, line };
    // Customer fields distinguish simultaneous pours only in memory. Neither the
    // original fields nor their fingerprint are persisted or sent to the browser.
    const key = createHash('sha256').update(JSON.stringify([raw.tst_start, raw.tst_stop, plu, tap, device, line,
      raw.item_id, raw.external_id, raw.card_id, raw.customer_hash])).digest('hex');
    const list = map.get(key) || [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}
function assignment(row, taps, events) {
  const at = Date.parse(row.at);
  const latest = new Map();
  for (const event of events) {
    if (Date.parse(event.occurred_at) > at) continue;
    const previous = latest.get(event.slot_key);
    if (!previous || Date.parse(previous.occurred_at) < Date.parse(event.occurred_at)) latest.set(event.slot_key, event);
  }
  const historical = [...latest.values()].map(e => e.product).filter(p => Number(p?.plu) === row.plu
    && (!row.tap || Number(p.tapNumber) === row.tap)
    && (!row.device || Number(p.deviceId) === row.device)
    && (!row.line || Number(p.lineNum) === row.line));
  const current = taps.filter(p => Number(p.plu) === row.plu
    && (!row.tap || Number(p.tapNumber) === row.tap)
    && (!row.device || Number(p.deviceId) === row.device)
    && (!row.line || Number(p.lineNum) === row.line));
  const known = historical.length === 1 ? historical[0] : null;
  const suggested = current.length === 1 ? current[0] : null;
  return {
    tapNumber: row.tap || Number(known?.tapNumber) || null,
    suggestedTapNumber: !row.tap && !known ? Number(suggested?.tapNumber) || null : null,
    product: known?.name || suggested?.product || suggested?.name || `PLU ${row.plu}`,
    assignmentEvidence: row.tap ? 'PMB transaction tap' : known ? 'Observed assignment history' : suggested ? 'Current product match; historical tap unverified' : 'Historical tap unknown',
  };
}
export function buildDailyReport({ day, reads, taps = [], events = [], costs = [], previous = null, now = new Date() }) {
  const start = Date.parse(pmbLocalMidnight(dayMillis(day))), end = Date.parse(pmbLocalMidnight(dayMillis(day) + DAY));
  if (!Array.isArray(reads) || reads.length !== 2) throw new Error('Two PMB reads are required.');
  const maps = reads.map(rows => transactionMap(rows, start, end));
  const merged = [];
  let disagreements = 0;
  for (const key of new Set([...maps[0].keys(), ...maps[1].keys()])) {
    const a = maps[0].get(key) || [], b = maps[1].get(key) || [];
    if (JSON.stringify(a) !== JSON.stringify(b)) disagreements += 1;
    // Maximum multiplicity, never sum overlapping reads. Keep identical real
    // pours within one report; two identical records need not be duplicates.
    merged.push(...(b.length >= a.length ? b : a));
  }
  const groups = new Map();
  for (const row of merged) {
    const identity = assignment(row, taps, events);
    const key = `${identity.tapNumber || `suggested-${identity.suggestedTapNumber || 0}`}:${row.plu}:${identity.assignmentEvidence}`;
    const group = groups.get(key) || { ...identity, plu: row.plu, volumeOz: 0, moneyRaw: 0, missingMoney: 0, pours: 0, costPerOz: null, costCapturedAt: null };
    group.volumeOz += row.oz;
    group.pours += 1;
    if (row.moneyRaw === null) group.missingMoney += 1;
    else group.moneyRaw += row.moneyRaw;
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const number = group.tapNumber || group.suggestedTapNumber;
    const matches = c => Number(c.plu) === group.plu && Number(c.tapNumber || c.suggestedTapNumber) === number
      && String(c.product).trim().toLowerCase() === group.product.trim().toLowerCase() && Number(c.costPerOz) > 0;
    const saved = previous?.rows?.find(matches);
    const cost = saved || costs.find(matches);
    if (cost) { group.costPerOz = Number(cost.costPerOz); group.costCapturedAt = saved?.costCapturedAt || now.toISOString(); }
  }
  return {
    day, timeZone: REPORT_ZONE, capturedAt: now.toISOString(),
    coverage: !merged.length ? 'empty-unverified' : disagreements ? 'partial' : 'matching-overlapping-reads',
    disagreements, transactionCount: merged.length,
    rows: [...groups.values()].sort((a, b) => (a.tapNumber || a.suggestedTapNumber || 999) - (b.tapNumber || b.suggestedTapNumber || 999)),
    moneySamples: merged.filter(r => r.moneyRaw !== null && r.priceRaw !== null && r.oz > 0).slice(0, 8)
      .map(({ oz, moneyRaw, priceRaw, plu }) => ({ oz, moneyRaw, priceRaw, plu })),
    note: 'Recorded pours, not POS settlement. Matching reads are not a vendor-certified completeness guarantee. Cost snapshots estimate gross profit, excluding overhead, taxes and fees. Historical tap inference is labeled separately.',
  };
}
export function projectDailyReport(report, units = null) {
  const divisor = [1, 100].includes(units?.divisor) ? units.divisor : null;
  return { ...report, moneyVerified: Boolean(divisor), rows: report.rows.map(row => {
    const revenue = divisor && !row.missingMoney ? row.moneyRaw / divisor : null;
    const estimatedCost = row.costPerOz > 0 ? row.volumeOz * row.costPerOz : null;
    return { ...row, revenue, estimatedCost, estimatedGrossProfit: revenue !== null && estimatedCost !== null ? revenue - estimatedCost : null };
  }) };
}
