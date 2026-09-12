import { getSixWeekUsage } from "./six-week-usage.mjs";

export const MINIMUM_KEG_CUSHION = 0.25;
export const KEG_DEMAND_WEEKS = 8;

export function getEightWeekPeakUsage(item = {}, now = new Date(), fullOunces = 0) {
  const history = (item.history || []).map((entry) => {
    const exact = entry.volumeOz;
    const hasExact = exact !== null && exact !== undefined && exact !== ""
      && Number.isFinite(Number(exact)) && Number(exact) >= 0;
    const hasValue = entry.value !== null && entry.value !== undefined && entry.value !== ""
      && Number.isFinite(Number(entry.value)) && Number(entry.value) >= 0;
    const value = hasExact && fullOunces > 0 ? Number(exact) / fullOunces
      : hasValue && item.displayUnit === "oz" ? (fullOunces > 0 ? Number(entry.value) / fullOunces : null)
      : hasValue ? Number(entry.value) : null;
    return { ...entry, value };
  });
  const usage = getSixWeekUsage({ ...item, history }, now, KEG_DEMAND_WEEKS);
  const peak = usage.values.length ? Math.max(...usage.values) : null;
  return { ...usage, peak, targetStock: peak === null ? null : peak * (1 + MINIMUM_KEG_CUSHION) };
}
