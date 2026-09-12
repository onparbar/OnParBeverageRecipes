// These assignments were explicitly confirmed by the owner for these weeks.
const confirmedAssignments = [
  { tapNumber: 83, plu: 196542, name: "Grey Goose Vodka 2", startDate: "2026-08-24", endDate: "2026-08-30" },
  { tapNumber: 88, plu: 35417, name: "Crown Royal Peach Whiskey 2", startDate: "2026-08-31", endDate: "2026-09-06" },
];

const nameKey = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const sameProduct = (a, b) => Number(a.tapNumber) === Number(b.tapNumber)
  && Number(a.plu) > 0 && Number(a.plu) === Number(b.plu)
  && nameKey(a.name) === nameKey(b.name);

export async function readWeeklyAssignmentHistory({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env.SUPABASE_URL || !secret) return [];
  const url = new URL("/rest/v1/pmb_tap_product_current", env.SUPABASE_URL);
  url.searchParams.set("select", "data");
  const headers = { apikey: secret };
  if (secret.startsWith("eyJ")) headers.Authorization = `Bearer ${secret}`;
  try {
    const response = await fetchImpl(url, {
      headers, cache: "no-store", signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return [];
    const rows = await response.json();
    return Array.isArray(rows) ? rows.map((row) => row.data).filter(Boolean) : [];
  } catch {
    // Unavailable assignment evidence must never turn an unknown into a zero.
    return [];
  }
}

// Call only after the complete PMB report has passed the route's validation.
export function verifyWeeklyReportZeros(report, { currentTaps = [], assignments = [], startTime, endTime, reportDigest = "" } = {}) {
  return {
    ...report,
    items: report.items.map((item) => {
      if (item.volumeOz !== 0 || item.transactionCount !== 0 || !item.isCurrentTap) return item;
      const confirmation = confirmedAssignments.find((entry) => sameProduct(entry, item)
        && entry.startDate === report.startDate && entry.endDate === report.endDate);
      const currentTap = currentTaps.find((tap) => sameProduct(tap, item));
      const assignment = currentTap && assignments.find((entry) => sameProduct(entry, item)
        && entry.deviceId != null && currentTap.deviceId != null
        && String(entry.deviceId) === String(currentTap.deviceId)
        && entry.lineNum != null && currentTap.lineNum != null
        && String(entry.lineNum) === String(currentTap.lineNum)
        && Number.isFinite(startTime) && Number.isFinite(endTime)
        && Date.parse(entry.firstSeenAt) <= startTime
        && Date.parse(entry.lastSeenAt) >= endTime);
      if (!confirmation && !assignment) return item;
      return {
        ...item,
        hasValue: true,
        usageUnknownReason: "",
        reportComplete: true,
        historicalAssignmentVerified: true,
        zeroUsageVerified: true,
        zeroUsageEvidence: {
          source: confirmation ? "owner-confirmed-assignment" : "supabase-assignment-history",
          tapNumber: item.tapNumber,
          plu: item.plu,
          name: item.name,
          startDate: report.startDate,
          endDate: report.endDate,
          reportTransactionCount: report.transactionCount,
          reportDigest,
          firstSeenAt: assignment?.firstSeenAt || null,
          lastSeenAt: assignment?.lastSeenAt || null,
        },
      };
    }),
  };
}
