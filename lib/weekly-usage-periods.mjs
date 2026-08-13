function startOfLocalDay(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

export function getThisMonday(referenceDate = new Date()) {
  const today = startOfLocalDay(referenceDate);
  if (!today) return null;
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  return monday;
}

export function isCompletedMondayWeekStart(value, referenceDate = new Date()) {
  const start = startOfLocalDay(value);
  const thisMonday = getThisMonday(referenceDate);
  return Boolean(start && thisMonday && start.getDay() === 1 && start < thisMonday);
}

export function getCompletedMondayWeekStarts(referenceDate = new Date(), lookbackWeeks = 12) {
  const thisMonday = getThisMonday(referenceDate);
  if (!thisMonday) return [];
  const count = Math.max(1, Math.min(12, Math.round(Number(lookbackWeeks) || 12)));
  const latestCompletedMonday = new Date(thisMonday);
  latestCompletedMonday.setDate(thisMonday.getDate() - 7);
  return Array.from({ length: count }, (_, index) => {
    const start = new Date(latestCompletedMonday);
    start.setDate(latestCompletedMonday.getDate() - ((count - 1 - index) * 7));
    return start;
  });
}

export function getWeeklyUsageLabelStartTime(label) {
  const match = String(label || "").trim().match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!match) return 0;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const rawYear = Number(match[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) return 0;
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function getMissingLatestCompletedUsageTaps(items = [], referenceDate = new Date()) {
  const latest = getCompletedMondayWeekStarts(referenceDate, 1)[0];
  if (!latest) return [];
  const latestTime = latest.getTime();
  return items
    .filter((item) => !Array.isArray(item?.history) || !item.history.some(
      (entry) => getWeeklyUsageLabelStartTime(entry?.label) === latestTime,
    ))
    .map((item) => Number(item?.tapNumber))
    .filter((tapNumber) => Number.isFinite(tapNumber) && tapNumber > 0);
}
