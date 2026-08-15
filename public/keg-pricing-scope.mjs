function tapNumberOf(item) {
  return Number(item?.tapNumber ?? item?.tapPosition) || 0;
}

export function filterCurrentTapPricingItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => (
      item?.isCurrentTap === true
      && String(item?.tapMatchSource || "").trim() === "pmb-tap-config"
      && tapNumberOf(item) > 0
    ))
    .slice()
    .sort((a, b) => tapNumberOf(a) - tapNumberOf(b)
      || String(a?.name || "").localeCompare(String(b?.name || "")));
}

export function buildVerifiedCurrentBeerTapItems({
  wallItems = [],
  weeklyUsageItems = [],
  liveLevelItems = [],
  tapPriceItems = [],
  isBeerTapPosition = () => false,
} = {}) {
  const beerWallByTap = new Map(
    wallItems
      .filter((item) => isBeerTapPosition(item))
      .map((item) => [tapNumberOf(item), item]),
  );
  const currentItemsByTap = new Map();

  weeklyUsageItems.forEach((item) => {
    const tapNumber = tapNumberOf(item);
    const wallItem = beerWallByTap.get(tapNumber);
    const name = String(item?.name || item?.tapProduct || "").trim();
    if (!tapNumber || !wallItem || !name || currentItemsByTap.has(tapNumber)) return;
    currentItemsByTap.set(tapNumber, {
      ...item,
      tapNumber,
      tapPosition: tapNumber,
      wall: item.wall || wallItem.wall,
      type: item.type || wallItem.type || "Beer",
      matchedBrand: name,
      templateBrand: wallItem.brand || "",
      isCurrentTap: true,
      tapMatchSource: "saved-weekly-usage",
    });
  });

  tapPriceItems.forEach((item) => {
    const tapNumber = tapNumberOf(item);
    const wallItem = beerWallByTap.get(tapNumber);
    const name = String(item?.name || item?.tapProduct || "").trim();
    if (item?.isCurrentTap !== true || !tapNumber || !wallItem || !name) return;
    currentItemsByTap.set(tapNumber, {
      ...item,
      tapNumber,
      tapPosition: tapNumber,
      wall: item.wall || wallItem.wall,
      type: item.type || wallItem.type || "Beer",
      matchedBrand: name,
      templateBrand: wallItem.brand || "",
    });
  });

  liveLevelItems.forEach((item) => {
    const tapNumber = tapNumberOf(item);
    const wallItem = beerWallByTap.get(tapNumber);
    const name = String(item?.tapProduct || item?.name || "").trim();
    if (!tapNumber || !wallItem || !name) return;
    currentItemsByTap.set(tapNumber, {
      ...item,
      tapNumber,
      tapPosition: tapNumber,
      wall: wallItem.wall,
      type: wallItem.type || "Beer",
      matchedBrand: name,
      templateBrand: wallItem.brand || "",
      isCurrentTap: true,
      tapMatchSource: "pmb-keg-levels",
    });
  });

  return [...currentItemsByTap.values()]
    .sort((a, b) => tapNumberOf(a) - tapNumberOf(b));
}

export function buildAssignedOnDeckBeerItems({
  wallItems = [],
  isBeerTapPosition = () => false,
  resolveOnDeck = () => null,
} = {}) {
  return wallItems.flatMap((item) => {
    if (!isBeerTapPosition(item)) return [];
    const onDeck = resolveOnDeck(item);
    if (!onDeck || String(onDeck.kind || "").toLowerCase() !== "beer") return [];
    const tapNumber = tapNumberOf(item);
    return [{
      ...onDeck,
      tapNumber,
      wall: item.wall || "",
      type: "Beer",
      sourceTapLabel: `On Deck for ${item.wall || "wall"} ${tapNumber}`,
      isOnDeckProduct: true,
    }];
  });
}

export function buildActiveComingSoonBeerItems({
  comingSoonItems = [],
} = {}) {
  return comingSoonItems.flatMap((item) => {
    const name = String(item?.name || "").trim();
    if (!name || String(item?.kind || "").toLowerCase() !== "beer" || item?.replacedAt) return [];
    return [{
      ...item,
      tapNumber: 0,
      wall: "Coming Soon",
      type: "Beer",
      sourceTapLabel: "Coming Soon",
      isComingSoonProduct: true,
    }];
  });
}
