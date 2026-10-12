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
