function nonNegativeNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

// A stored zero or a PMB source label does not establish historical coverage.
// This is a read-time policy: retain the original record for later review.
export function isUsableWeeklyUsageEntry(entry) {
  if (!entry || entry.hasValue === false || entry.usageUnknownReason) return false;
  const value = nonNegativeNumber(entry.volumeOz) ?? nonNegativeNumber(entry.value);
  if (value === null) return false;
  if (value > 0) return true;
  // zeroUsageVerified is an explicit reviewed-zero assertion, not inferred
  // from today's assignment, price capture, or the absence of transactions.
  return entry.zeroUsageVerified === true
    || (entry.reportComplete === true && entry.historicalAssignmentVerified === true);
}
