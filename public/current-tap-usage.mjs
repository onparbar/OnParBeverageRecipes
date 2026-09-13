import { normalizeProductIdentity } from "./canonical-tap-resolution.mjs";
import { getConfirmedTapUsageStart } from "./confirmed-tap-starts.mjs";

// Usage belongs to a product assignment, not just the physical tap number.
// Return a filtered copy so past assignments remain available in Weekly Usage.
export function getCurrentTapUsage(source, current = {}) {
  if (!source) return null;
  if (Number(source.tapNumber) !== Number(current.tapNumber)) return null;
  const sourceName = normalizeProductIdentity(source.name || source.brand);
  const currentName = normalizeProductIdentity(current.name || current.brand);
  if (!sourceName || !currentName || sourceName !== currentName) return null;
  if (Number(source.plu) > 0 && Number(current.plu) > 0
    && Number(source.plu) !== Number(current.plu)) return null;

  const history = current.productHistory;
  const confirmedStart = getConfirmedTapUsageStart(current);
  // Product-wide introduction dates can belong to another wall or an earlier
  // assignment. Use this slot's latest transition, or its operator-confirmed start.
  const introducedAt = (["detected", "confirmed"].includes(history?.source)
    ? history.changedAt : "") || confirmedStart;
  if (!introducedAt) return source;
  const introduction = new Date(introducedAt);
  if (!Number.isFinite(introduction.getTime())) return { ...source, history: [] };
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(introduction).map(({ type, value }) => [type, value]));
  // Date-only confirmations are already business-local dates, not UTC instants.
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(introducedAt)
    ? introducedAt : `${parts.year}-${parts.month}-${parts.day}`;
  const cutoff = Date.parse(`${startDate}T00:00:00Z`);
  return {
    ...source,
    history: (source.history || []).filter((entry) => {
      const match = String(entry.label || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
      if (!match) return false;
      const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
      // A week that spans a swap cannot establish a full week for the new product.
      return Date.UTC(year, Number(match[1]) - 1, Number(match[2])) >= cutoff;
    }),
  };
}
