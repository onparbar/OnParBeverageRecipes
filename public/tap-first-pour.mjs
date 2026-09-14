import { firstPourSnapshot } from "./pmb-first-pour-snapshot.mjs";

const normalizeName = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
const easternDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short", day: "numeric", year: "numeric",
  hour: "numeric", minute: "2-digit", timeZoneName: "short",
});
const badgeDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric",
});
const calendarDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});

function dateParts(date) {
  return Object.fromEntries(calendarDate.formatToParts(date).map(({ type, value }) => [type, value]));
}

function dateKey(parts) {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function findFirstPourRecord(current, snapshot) {
  if (!current || !(Number(current.plu) > 0)) return null;
  const name = normalizeName(current.name || current.tapProduct);
  if (!name) return null;
  return (snapshot?.rows || []).find((row) => (
    Number(row.tapNumber) === Number(current.tapNumber)
    && Number(row.plu) === Number(current.plu)
    && normalizeName(row.product) === name
  )) || null;
}

// History stays available to search regardless of the badge's display window.
export function getTapHistoryContext(current, snapshot = firstPourSnapshot) {
  const record = findFirstPourRecord(current, snapshot);
  const timestamp = Date.parse(record?.firstRecordedPourAt || "");
  const history = current?.productHistory;
  return {
    firstRecordedPourAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
    firstPourHistoryScope: record ? "Earliest product pour found in searched PMB reports; not proof of its first pour on this physical tap." : null,
    firstPourSearchedThrough: record ? snapshot.searchedEndDate || null : null,
    firstPourHasCoverageGaps: record ? Boolean(snapshot.hasCoverageGaps) : null,
    productChangedAt: history?.changedAt || null,
    productChangeSource: history?.source || null,
    previousProduct: history?.previousName || null,
  };
}

export function getTapNewBadge(current, { now = new Date(), snapshot = firstPourSnapshot } = {}) {
  const record = findFirstPourRecord(current, snapshot);
  const timestamp = Date.parse(record?.firstRecordedPourAt || "");
  const today = new Date(now);
  if (!Number.isFinite(timestamp) || !Number.isFinite(today.getTime()) || timestamp > today.getTime()) return null;
  const parts = dateParts(today);
  const cutoff = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 4, 1));
  const lastDay = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)).getUTCDate();
  cutoff.setUTCDate(Math.min(Number(parts.day), lastDay));
  const cutoffKey = cutoff.toISOString().slice(0, 10);
  if (dateKey(dateParts(new Date(timestamp))) < cutoffKey) return null;
  return { date: badgeDate.format(timestamp), firstRecordedPourAt: new Date(timestamp).toISOString() };
}

// Display evidence only: never use product-wide first pours as assignment dates
// or as the starting point for demand calculations.
export function getTapFirstPour(current, snapshot = firstPourSnapshot) {
  const record = findFirstPourRecord(current, snapshot);
  const timestamp = Date.parse(record?.firstRecordedPourAt || "");
  if (!Number.isFinite(timestamp) || timestamp < Date.parse("2026-01-01T00:00:00-05:00")) return null;
  return {
    label: "Earliest PMB pour found",
    date: easternDate.format(timestamp),
    note: `Product history through ${snapshot.searchedEndDate}; not a verified first pour on this tap.${snapshot.hasCoverageGaps ? " Some historical reports were unavailable." : ""}`,
  };
}
