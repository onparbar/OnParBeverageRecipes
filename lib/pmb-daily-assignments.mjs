const positiveInteger = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const productKey = (value) => String(value || '').normalize('NFKC').replace(/\u2019/g, "'").trim().replace(/\s+/g, ' ').toLowerCase();
const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', timeZoneName: 'longOffset',
});

function midnight(day) {
  const base = Date.parse(`${day}T00:00:00Z`);
  let result = base;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset = offsetFormatter.formatToParts(new Date(result)).find(part => part.type === 'timeZoneName')?.value;
    const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offset || '');
    if (!match) return NaN;
    const minutes = (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '-' ? -1 : 1);
    const next = base - minutes * 60000;
    if (next === result) break;
    result = next;
  }
  return result;
}

function dailyBounds(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return null;
  const date = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return null;
  date.setUTCDate(date.getUTCDate() + 1);
  return [midnight(day), midnight(date.toISOString().slice(0, 10))];
}

function assignmentTimeline(events, snapshots) {
  const byTap = new Map();
  function add({ tapNumber, name, plu, at, source, reference }) {
    const timestamp = Date.parse(at || '');
    if (!positiveInteger(tapNumber) || !Number.isFinite(timestamp)) return;
    const entry = {
      tapNumber: Number(tapNumber), name: productKey(name),
      plu: positiveInteger(plu) ? Number(plu) : null,
      timestamp, source, reference,
    };
    const entries = byTap.get(entry.tapNumber) || [];
    entries.push(entry);
    byTap.set(entry.tapNumber, entries);
  }

  for (const event of events) {
    add({ tapNumber: event.product?.tapNumber, name: event.product?.name,
      plu: event.product?.plu, at: event.occurred_at,
      source: 'tap-product-history', reference: event.slot_key });
  }

  for (const snapshot of snapshots) {
    const plan = snapshot.kegPlanSnapshot;
    const metadata = snapshot.captureMetadata;
    const at = metadata?.sourceTimestamps?.pmb || snapshot.summary?.pmbUpdatedAt;
    const timestamp = Date.parse(at || '');
    const savedAt = Date.parse(snapshot.savedAt || '');
    const generatedAt = Date.parse(plan?.generatedAt || '');
    // Use when PMB was actually read, never the snapshot's week label or today's lineup.
    if (!['current', 'verified'].includes(metadata?.sourceFreshness?.pmb)
      || !Number.isFinite(timestamp) || !Number.isFinite(savedAt) || !Number.isFinite(generatedAt)
      || timestamp > generatedAt || generatedAt > savedAt
      || !positiveInteger(snapshot.summary?.tapCount)
      || Number(snapshot.summary.liveTapCount) !== Number(snapshot.summary.tapCount)
      || !Array.isArray(plan?.tapInputs)) continue;

    const inputs = plan.tapInputs;
    if (inputs.length !== Number(snapshot.summary.tapCount)
      || inputs.some(item => !positiveInteger(item.tapNumber))
      || new Set(inputs.map(item => Number(item.tapNumber))).size !== inputs.length) continue;

    for (const item of inputs) {
      const savedProducts = (Array.isArray(plan.items) ? plan.items : []).filter(candidate => (
        Number(candidate.tapNumber) === Number(item.tapNumber)
        && productKey(candidate.name) === productKey(item.name)
        && positiveInteger(candidate.plu)
      ));
      const plus = new Set(savedProducts.map(candidate => Number(candidate.plu)));
      if (positiveInteger(item.plu)) plus.add(Number(item.plu));
      add({ tapNumber: item.tapNumber, name: plus.size > 1 ? '' : item.name,
        plu: plus.size === 1 ? [...plus][0] : null, at,
        source: 'verified-inventory-snapshot', reference: snapshot.id });
    }
  }

  for (const entries of byTap.values()) entries.sort((a, b) => a.timestamp - b.timestamp);
  return byTap;
}

function assignmentAt(byTap, row, timestamp) {
  const name = productKey(row.product);
  if (!name || !positiveInteger(row.plu)) return null;
  const matches = [];
  for (const entries of byTap.values()) {
    let latest = -1;
    for (let index = 0; index < entries.length && entries[index].timestamp <= timestamp; index += 1) latest = index;
    if (latest < 0) continue;
    const at = entries[latest].timestamp;
    const contemporaneous = [];
    for (let index = latest; index >= 0 && entries[index].timestamp === at; index -= 1) contemporaneous.push(entries[index]);
    const names = new Set(contemporaneous.map(entry => entry.name));
    const plus = new Set(contemporaneous.map(entry => entry.plu).filter(Boolean));
    if (names.size !== 1 || plus.size > 1) {
      if (names.has(name) || plus.has(Number(row.plu))) return null;
      continue;
    }
    if (!names.has(name) || (plus.size && !plus.has(Number(row.plu)))) continue;
    matches.push({ tapNumber: entries[latest].tapNumber, sources: contemporaneous });
  }
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Resolve saved aggregates from contemporaneous evidence without rewriting PMB totals.
 * Old aggregates have no pour timestamps, so an assignment must hold for the entire
 * Eastern day. A later observation alone must never be backdated to cover earlier pours.
 * Exact product names retain wall suffixes; a suggested tap is not historical evidence.
 */
export function reconcileDailyReportAssignments(report, { events = [], snapshots = [] } = {}) {
  const bounds = dailyBounds(report?.day);
  if (!bounds || !bounds.every(Number.isFinite) || !Array.isArray(report.rows)) return report;
  const [start, end] = bounds;
  const byTap = assignmentTimeline(events, snapshots);
  const points = [...new Set([start, ...[...byTap.values()].flatMap(entries => entries
    .filter(entry => entry.timestamp > start && entry.timestamp < end)
    .map(entry => entry.timestamp))])].sort((a, b) => a - b);

  return { ...report, rows: report.rows.map(row => {
    if (positiveInteger(row.tapNumber)) return row;
    let tapNumber = null;
    const evidence = new Map();
    for (const point of points) {
      const assignment = assignmentAt(byTap, row, point);
      if (!assignment || (tapNumber && tapNumber !== assignment.tapNumber)) return row;
      tapNumber = assignment.tapNumber;
      for (const entry of assignment.sources) {
        const key = JSON.stringify([entry.source, entry.reference, entry.timestamp, entry.tapNumber]);
        evidence.set(key, { source: entry.source, reference: entry.reference,
          observedAt: new Date(entry.timestamp).toISOString(), tapNumber: entry.tapNumber });
      }
    }
    return { ...row, tapNumber, suggestedTapNumber: null,
      assignmentEvidence: 'Saved historical tap assignment',
      assignmentResolution: { method: 'whole-day-historical-assignment',
        originalEvidence: row.assignmentEvidence, originalSuggestedTapNumber: row.suggestedTapNumber,
        sources: [...evidence.values()] } };
  }) };
}
