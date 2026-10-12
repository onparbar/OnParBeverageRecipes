import { isPricingPlaceholder } from "./pricing-placeholders.mjs";

// A PMB placeholder does not replace the last saved product on a physical tap.
// An explicit On Deck selection or a real live product takes precedence.
export function getTapOrderProductName(tap, savedProduct = null, onDeck = null) {
  const name = String(onDeck?.name || "").trim();
  if (name && !isPricingPlaceholder(name)) return name;
  const currentName = String(tap?.orderProductName || tap?.name || "").trim();
  if (currentName && !isPricingPlaceholder(currentName)) return currentName;
  const savedName = String(savedProduct?.name || "").trim();
  if (Number(tap?.tapNumber) > 0 && Number(tap.tapNumber) === Number(savedProduct?.tapNumber)
    && savedName && !isPricingPlaceholder(savedName)) return savedName;
  return "";
}

// Weekly Usage archives the previous product when PMB switches to Coming Soon.
// Only that most recent changeover can supply a retained product and its usage.
export function getSavedTapOrderProduct(tap, activeItems = [], archivedItems = []) {
  const tapNumber = Number(tap?.tapNumber);
  if (!(tapNumber > 0)) return null;
  const active = activeItems.find((item) => Number(item.tapNumber) === tapNumber) || null;
  if (!isPricingPlaceholder(tap?.name || tap?.brand)
    || (active?.name && !isPricingPlaceholder(active.name))) return active;
  const archived = archivedItems
    .filter((item) => Number(item.tapNumber) === tapNumber && Number.isFinite(Date.parse(item.replacedAt)))
    .sort((a, b) => Date.parse(b.replacedAt) - Date.parse(a.replacedAt));
  const latest = archived[0];
  if (!latest || !latest.name || isPricingPlaceholder(latest.name)
    || !isPricingPlaceholder(latest.replacedBy)) return active;
  if (archived[1] && Date.parse(archived[1].replacedAt) === Date.parse(latest.replacedAt)
    && archived[1].name !== latest.name) return active;
  return latest;
}
