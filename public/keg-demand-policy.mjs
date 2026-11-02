import { getSixWeekUsage } from "./six-week-usage.mjs";
import { getKegOrderKey } from "./keg-order-defaults.mjs";

export const MINIMUM_KEG_CUSHION = 0.25;
export const KEG_DEMAND_WEEKS = 8;

export function getKegReservePolicy({ kind = "beer", wall = "", productName = "" } = {}) {
  const mainUltra = String(kind).trim().toLowerCase() === "beer"
    && String(wall).trim().toLowerCase() === "main"
    && getKegOrderKey(productName) === "michelob-ultra";
  return mainUltra
    ? { reserveKegs: 1, reserveReason: "1 full unopened backup keg in Main" }
    : { reserveKegs: MINIMUM_KEG_CUSHION, reserveReason: "0.25 keg (25% of a full keg)" };
}

export function getEightWeekPeakUsage(item = {}, now = new Date(), fullOunces = 0, policy = {}) {
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
  const reserve = getKegReservePolicy(policy);
  return { ...usage, peak, ...reserve, targetStock: peak === null ? null : peak + reserve.reserveKegs };
}
