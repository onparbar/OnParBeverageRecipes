export function getSixWeekUsage(item, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  const monday = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  const end = monday.getTime();
  const weekMs = 7 * 86400000;
  const weeks = new Map();
  for (const entry of item.history || []) {
    const match = String(entry.label || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (!match || entry.hasValue === false || entry.value == null || entry.value === "") continue;
    const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
    const start = Date.UTC(year, Number(match[1]) - 1, Number(match[2]));
    const value = Number(entry.value);
    if (start < end - 6 * weekMs || start >= end || (end - start) % weekMs !== 0 || !Number.isFinite(value) || value < 0) continue;
    if (!weeks.has(start)) weeks.set(start, { ...entry, value });
  }
  const entries = [...weeks].sort(([a], [b]) => b - a).map(([, entry]) => entry);
  const values = entries.map((entry) => entry.value);
  return { entries, values, sampleWeeks: values.length,
    average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0 };
}
