function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function finiteUsageValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function round(value, places = 3) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** places;
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function buildWeeklyUsageTrend(history = [], labelsNewestFirst = [], options = {}) {
  const width = Math.max(40, Number(options.width) || 144);
  const height = Math.max(24, Number(options.height) || 42);
  const padding = Math.max(2, Math.min(width / 4, height / 4, Number(options.padding) || 4));
  const labels = [...new Set((labelsNewestFirst || []).map(clean).filter(Boolean))].reverse();
  const historyByLabel = new Map();

  (Array.isArray(history) ? history : []).forEach((entry) => {
    const label = clean(entry?.label);
    if (!label || historyByLabel.has(label)) return;
    historyByLabel.set(label, finiteUsageValue(entry?.value));
  });

  const values = labels
    .map((label) => historyByLabel.get(label))
    .filter(Number.isFinite);
  const maximum = values.length ? Math.max(...values) : 0;
  const plotWidth = Math.max(1, width - (padding * 2));
  const plotHeight = Math.max(1, height - (padding * 2));
  const lastIndex = Math.max(1, labels.length - 1);
  const points = labels.map((label, index) => {
    const value = historyByLabel.get(label);
    const hasValue = Number.isFinite(value);
    return {
      label,
      value: hasValue ? value : null,
      hasValue,
      x: round(padding + ((index / lastIndex) * plotWidth)),
      y: hasValue
        ? round(padding + (maximum > 0 ? (1 - (value / maximum)) * plotHeight : plotHeight))
        : null,
    };
  });

  const segments = [];
  let segment = [];
  points.forEach((point) => {
    if (point.hasValue) {
      segment.push(point);
      return;
    }
    if (segment.length) segments.push(segment);
    segment = [];
  });
  if (segment.length) segments.push(segment);

  const recorded = points.filter((point) => point.hasValue);
  const firstValue = recorded[0]?.value ?? null;
  const lastValue = recorded.at(-1)?.value ?? null;
  const previousValue = recorded.at(-2)?.value ?? null;
  const change = Number.isFinite(previousValue) && Number.isFinite(lastValue)
    ? round(lastValue - previousValue)
    : null;
  const direction = recorded.length < 2
    ? "unavailable"
    : Math.abs(change) < 0.0005
      ? "flat"
      : change > 0
        ? "up"
        : "down";

  return {
    width,
    height,
    padding,
    points,
    segments,
    recordedCount: recorded.length,
    missingCount: points.length - recorded.length,
    maximum: round(maximum),
    firstValue,
    previousValue,
    lastValue,
    change,
    direction,
  };
}
