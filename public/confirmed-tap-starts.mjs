// Product introductions confirmed by the operator on September 12, 2026.
// These dates are not inferred from keg refill dates or first sync timestamps.
const confirmedStarts = [
  { tapNumber: 42, plu: 72521, name: "psychopathy", startDate: "2026-09-10" },
  { tapNumber: 70, plu: 55422, name: "whiskey smash jim beam", startDate: "2026-09-10" },
];

export function getConfirmedTapUsageStart(item = {}) {
  const name = String(item.name || "").toLowerCase().replace(/\s+[123]\s*$/, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
  return confirmedStarts.find((entry) => Number(item.tapNumber) === entry.tapNumber
    && Number(item.plu) === entry.plu && name === entry.name)?.startDate || "";
}

// A baseline observation or a refill is not an installation. Only this slot's
// recorded product transition can provide an automatic reporting boundary.
export function getTapAssignmentUsageStart(item = {}) {
  const confirmed = getConfirmedTapUsageStart(item);
  const history = item.productHistory;
  if (!["detected", "confirmed"].includes(history?.source) || !history.changedAt) return confirmed;
  const changed = new Date(history.changedAt);
  if (!Number.isFinite(changed.getTime())) return confirmed;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(changed).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
