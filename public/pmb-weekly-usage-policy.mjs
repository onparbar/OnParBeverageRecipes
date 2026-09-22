// Older PMB captures omitted source but stored exact volumeOz. CSV imports
// stored value only. Never treat an explicitly different source as PMB.
export function isPmbUsageEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  const source = String(entry.source || "").trim().toLowerCase();
  if (source) return source === "pmb";
  return entry.volumeOz !== null && entry.volumeOz !== undefined && String(entry.volumeOz).trim() !== ""
    && Number.isFinite(Number(entry.volumeOz)) && Number(entry.volumeOz) >= 0;
}

export function getWeeklyUsageSource(entry) {
  if (!entry || typeof entry !== "object") return "";
  if (isPmbUsageEntry(entry)) return "PMB";
  const source = String(entry.source || "").trim().toLowerCase();
  // Saved spreadsheet history predates source labels and has value, not volumeOz.
  if (source === "csv" || (!source && entry.value !== undefined && entry.volumeOz == null)) return "CSV";
  return "";
}

export function getPmbWeeklyUsageRange(label) {
  const match = String(label || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s*[-–—]\s*(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return null;
  const dates = [1, 4].map(offset => {
    const month = Number(match[offset]);
    const day = Number(match[offset + 1]);
    const rawYear = Number(match[offset + 2]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
  });
  const [start, end] = dates;
  if (!start || !end || start.getUTCDay() !== 1 || end.getTime() - start.getTime() !== 6 * 86400000) return null;
  // Monday–Sunday periods cannot overlap unless they have the same start.
  // Existing duplicate/conflict handling resolves those exact duplicate weeks.
  return { startTime: start.getTime(), endTime: end.getTime() };
}

export function filterPmbWeeklyUsageHistory(history) {
  return (Array.isArray(history) ? history : []).filter(entry => isPmbUsageEntry(entry) && getPmbWeeklyUsageRange(entry.label));
}
