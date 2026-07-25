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
