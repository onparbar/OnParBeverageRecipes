import { isInventoryCountExcluded, isWeeklyCountOnlyInventoryItem } from "./inventory-count-policy.mjs";

const text = (value) => String(value ?? "").trim();
const isSimpleSyrup = (item) => item.id === "simple-syrup" || /^simple\s+syrup$/i.test(text(item.name));
export const isKorbelBrut = (item) => item.id === "korbel-brut" || /^(?:champagne\s*\(\s*)?korbel\s+brut\b/i.test(text(item.name));

export function buildWeeklyOrderInventoryRows(items, group, overrides = {}) {
  return items.filter((item) => {
    if (isInventoryCountExcluded(item)) return false;
    // Physical count stops do not change the inventory's accounting group.
    if (isSimpleSyrup(item)) return group === "Karaoke Cooler";
    if (isKorbelBrut(item)) return group === "Patio Cooler";
    if (["Karaoke Cooler", "Patio Cooler"].includes(group)) return false;
    return group === "Other" ? !["Liquor Cabinet", "Mixer Cabinet"].includes(item.group) : item.group === group;
  })
    .map((item) => {
      const isBeer = isWeeklyCountOnlyInventoryItem(item);
      const isSyrup = isSimpleSyrup(item);
      const isChampagne = isKorbelBrut(item);
      const unit = isBeer ? "cans" : isSyrup ? "1-gallon containers"
        : isChampagne ? "bottles"
        : item.id === "blue-rasp-powder" ? "packets"
          : item.isCustomInventory ? "individual items" : "bottles";
      const packageDetail = item.casePackaged && Number(item.packSize) > 1
        ? `${Number(item.packSize)} ${unit} per case.` : "";
      return {
        id: item.id,
        kind: "inventory",
        identity: `${item.id}:${item.name}:${item.group}:${unit}`,
        name: isChampagne ? "Champagne (Korbel Brut)" : item.name,
        detail: isBeer ? "Include cans in cases."
          : isSyrup ? "Karaoke cooler."
            : isChampagne ? `Patio cooler. ${packageDetail}`.trim() : packageDetail,
        unit,
        value: text(item.onHandDisplay),
        expectedValue: text(overrides[item.id]),
        allowsDecimal: Boolean(item.allowsDecimal),
      };
    });
}

export function buildWeeklyOrderCoolerRows(items, wall) {
  const walls = wall === "main" ? ["main", "patio"] : ["karaoke"];
  return items.filter((item) => walls.includes(text(item.wall).toLowerCase()))
    .sort((a, b) => Number(a.tapNumber) - Number(b.tapNumber))
    .flatMap((item) => {
      const rows = [];
      const location = `${item.wall} · Tap ${item.tapNumber}`;
      if (!item.isLiquorTap && item.name) rows.push({
        id: `keg:${item.key}`, key: item.key, kind: "keg",
        identity: `${item.key}:${item.name}`,
        name: item.name, detail: location, unit: "full backup kegs",
        value: text(item.onHand) || "0", expectedValue: text(item.onHand), allowsDecimal: false,
      });
      if (item.onDeck) {
        const ounces = text(item.onDeck.kind).toLowerCase() === "liquor";
        rows.push({
          id: `on-deck:${item.key}`, key: item.key, kind: "on-deck",
          identity: `${item.key}:${item.onDeck.comingSoonId || ""}:${item.onDeck.name}:${item.onDeck.kind}`,
          name: item.onDeck.name, detail: `${location} · Next product (On Deck)`,
          unit: ounces ? "ounces" : "full backup kegs", allowsDecimal: ounces,
          value: text(item.onDeck.onHand) || "0", expectedValue: text(item.onDeck.onHand),
        });
      }
      return rows;
    });
}

// A person verifies the products and balances that were shown to them. If a
// delivery, another count, or a product change arrived meanwhile, show it first.
export function weeklyOrderRowsChanged(submitted, current) {
  if (submitted.length !== current.length) return true;
  const byId = new Map(current.map((row) => [row.id, row]));
  return submitted.some((row) => {
    const latest = byId.get(row.id);
    return !latest || row.identity !== latest.identity
      || (text(row.expectedValue) !== text(latest.expectedValue) && text(row.value) !== text(latest.value));
  });
}
